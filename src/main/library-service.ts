import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { LibraryRoot, LibraryRootsSnapshot } from '@/shared/api';
import type { DatabaseConnection } from './db';
import { logger } from './logging';
import { scanLibraryRoot } from './scanner';
import { environment } from './app-paths';

interface RootRow {
  id: number;
  name: string;
  path: string;
  status: 'online' | 'offline';
  sync_state: 'idle' | 'syncing' | 'error';
  error_message: string | null;
  last_sync_at: string | null;
  item_count: number;
}

export class LibraryService {
  private readonly events = new EventEmitter();

  public constructor(private readonly database: DatabaseConnection) {}

  public async initialize(): Promise<void> {
    this.seedRootsFromEnvironment();
    await this.rescanAllLibraryRoots();
  }

  public subscribe(listener: (snapshot: LibraryRootsSnapshot) => void): () => void {
    this.events.on('changed', listener);

    return () => {
      this.events.off('changed', listener);
    };
  }

  public listLibraryRoots(): LibraryRootsSnapshot {
    return {
      roots: this.readLibraryRoots(),
    };
  }

  public async addLibraryRoot(rootPath: string): Promise<LibraryRootsSnapshot> {
    const trimmedPath = rootPath.trim();

    if (!trimmedPath) {
      throw new Error('Library root path is required.');
    }

    const resolvedPath = path.resolve(trimmedPath);
    const stats = await fs.stat(resolvedPath).catch(() => null);

    if (!stats || !stats.isDirectory()) {
      throw new Error('Library root must point to an existing folder.');
    }

    this.database
      .prepare(
        `
          INSERT INTO library_roots (name, path, status, sync_state)
          VALUES (?, ?, 'online', 'idle')
          ON CONFLICT(path) DO UPDATE SET name = excluded.name
        `,
      )
      .run(path.basename(resolvedPath), resolvedPath);

    const root = this.database
      .prepare('SELECT id FROM library_roots WHERE path = ?')
      .get(resolvedPath) as { id: number } | undefined;

    if (!root) {
      throw new Error('Failed to persist the library root.');
    }

    await this.rescanLibraryRoot(root.id);

    return this.listLibraryRoots();
  }

  public async removeLibraryRoot(rootId: number): Promise<LibraryRootsSnapshot> {
    this.database.prepare('DELETE FROM library_roots WHERE id = ?').run(rootId);
    this.emitChange();

    return this.listLibraryRoots();
  }

  public async rescanLibraryRoot(rootId: number): Promise<LibraryRootsSnapshot> {
    const root = this.database
      .prepare('SELECT id, path FROM library_roots WHERE id = ?')
      .get(rootId) as { id: number; path: string } | undefined;

    if (!root) {
      throw new Error('Library root was not found.');
    }

    this.database
      .prepare(
        `
          UPDATE library_roots
          SET sync_state = 'syncing', error_message = NULL
          WHERE id = ?
        `,
      )
      .run(root.id);

    this.emitChange();

    try {
      const scanResult = await scanLibraryRoot(root.path);

      if (scanResult.status === 'offline') {
        this.database
          .prepare(
            `
              UPDATE library_roots
              SET status = 'offline', sync_state = 'idle', error_message = NULL, last_sync_at = ?
              WHERE id = ?
            `,
          )
          .run(new Date().toISOString(), root.id);

        this.database
          .prepare('UPDATE library_items SET status = ? WHERE root_id = ?')
          .run('offline', root.id);

        logger.warn({ rootId: root.id, rootPath: root.path }, 'Library root is offline');
      } else {
        const replaceItems = this.database.transaction(() => {
          this.database
            .prepare('DELETE FROM library_items WHERE root_id = ?')
            .run(root.id);

          const insertItem = this.database.prepare(
            `
              INSERT INTO library_items (
                root_id,
                file_name,
                relative_path,
                extension,
                project_folder,
                status
              ) VALUES (?, ?, ?, ?, ?, ?)
            `,
          );

          for (const item of scanResult.items) {
            insertItem.run(
              root.id,
              item.fileName,
              item.relativePath,
              item.extension,
              item.projectFolder,
              'online',
            );
          }
        });

        replaceItems();

        this.database
          .prepare(
            `
              UPDATE library_roots
              SET status = 'online', sync_state = 'idle', error_message = NULL, last_sync_at = ?
              WHERE id = ?
            `,
          )
          .run(new Date().toISOString(), root.id);

        logger.info(
          { rootId: root.id, itemCount: scanResult.items.length, rootPath: root.path },
          'Library root scan completed',
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown scan error';

      this.database
        .prepare(
          `
            UPDATE library_roots
            SET sync_state = 'error', error_message = ?
            WHERE id = ?
          `,
        )
        .run(message, root.id);

      logger.error({ error: message, rootId: root.id, rootPath: root.path }, 'Scan failed');
    }

    this.emitChange();

    return this.listLibraryRoots();
  }

  private seedRootsFromEnvironment(): void {
    if (!environment.isTestMode || !process.env.MY_MESHES_TEST_LIBRARY_ROOTS) {
      return;
    }

    const parsedRoots = JSON.parse(process.env.MY_MESHES_TEST_LIBRARY_ROOTS) as Array<
      string | { path: string }
    >;

    const seedPaths = parsedRoots
      .map((entry) => (typeof entry === 'string' ? entry : entry.path))
      .filter((entry): entry is string => Boolean(entry))
      .map((entry) => path.resolve(entry));

    const replaceRoots = this.database.transaction((roots: string[]) => {
      this.database.prepare('DELETE FROM library_items').run();
      this.database.prepare('DELETE FROM library_roots').run();

      const insertRoot = this.database.prepare(
        `
          INSERT INTO library_roots (name, path, status, sync_state)
          VALUES (?, ?, 'online', 'idle')
        `,
      );

      for (const rootPath of roots) {
        insertRoot.run(path.basename(rootPath), rootPath);
      }
    });

    replaceRoots(seedPaths);
  }

  private async rescanAllLibraryRoots(): Promise<void> {
    const rows = this.database
      .prepare('SELECT id FROM library_roots ORDER BY name ASC')
      .all() as Array<{ id: number }>;

    for (const row of rows) {
      await this.rescanLibraryRoot(row.id);
    }
  }

  private emitChange(): void {
    this.events.emit('changed', this.listLibraryRoots());
  }

  private readLibraryRoots(): LibraryRoot[] {
    const rows = this.database
      .prepare(
        `
          SELECT
            r.id,
            r.name,
            r.path,
            r.status,
            r.sync_state,
            r.error_message,
            r.last_sync_at,
            COUNT(i.id) AS item_count
          FROM library_roots r
          LEFT JOIN library_items i ON i.root_id = r.id
          GROUP BY r.id
          ORDER BY r.name COLLATE NOCASE ASC
        `,
      )
      .all() as RootRow[];

    const selectSampleItems = this.database.prepare(
      `
        SELECT id, root_id, file_name, relative_path, extension, project_folder, status
        FROM library_items
        WHERE root_id = ?
        ORDER BY relative_path COLLATE NOCASE ASC
        LIMIT 5
      `,
    );

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      path: row.path,
      status: row.status,
      syncState: row.sync_state,
      errorMessage: row.error_message,
      lastSyncAt: row.last_sync_at,
      itemCount: row.item_count,
      sampleItems: (selectSampleItems.all(row.id) as Array<{
        id: number;
        root_id: number;
        file_name: string;
        relative_path: string;
        extension: string;
        project_folder: string;
        status: 'online' | 'offline';
      }>).map((item) => ({
        id: item.id,
        rootId: item.root_id,
        fileName: item.file_name,
        relativePath: item.relative_path,
        extension: item.extension,
        projectFolder: item.project_folder,
        status: item.status,
      })),
    }));
  }
}