import fs from 'node:fs';
import path from 'node:path';
import { ipcMain } from 'electron';
import log from 'electron-log/main';
import { getDatabase } from '../database';

const MODEL_EXTENSIONS = new Set(['.stl', '.obj', '.3mf']);
const ARCHIVE_EXTENSIONS = new Set(['.zip']);
const ALL_TRACKED_EXTENSIONS = new Set([...MODEL_EXTENSIONS, ...ARCHIVE_EXTENSIONS]);
const IGNORED_PATTERNS = ['.git', '__MACOSX', 'node_modules', '.DS_Store', 'Thumbs.db'];

interface ScannedFile {
  path: string;
  name: string;
  extension: string;
  size: number;
}

interface ScannedProject {
  path: string;
  name: string;
  hasYaml: boolean;
  files: ScannedFile[];
}

function shouldIgnore(name: string): boolean {
  return IGNORED_PATTERNS.some((pattern) => name === pattern || name.startsWith(pattern));
}

function scanDirectory(dirPath: string): ScannedProject[] {
  const projects: ScannedProject[] = [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    log.warn('Cannot read directory:', dirPath);
    return projects;
  }

  const files: ScannedFile[] = [];
  let hasYaml = false;

  for (const entry of entries) {
    if (shouldIgnore(entry.name)) continue;

    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      const subProjects = scanDirectory(fullPath);
      projects.push(...subProjects);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();

      if (entry.name === 'project.yaml') {
        hasYaml = true;
      }

      if (ALL_TRACKED_EXTENSIONS.has(ext)) {
        try {
          const stats = fs.statSync(fullPath);
          files.push({
            path: fullPath,
            name: entry.name,
            extension: ext,
            size: stats.size,
          });
        } catch {
          log.warn('Cannot stat file:', fullPath);
        }
      }
    }
  }

  // A directory is a project if it contains model files.
  // Archives (.zip) alone don't make a project, but are included if models are present.
  const hasModelFiles = files.some((f) => MODEL_EXTENSIONS.has(f.extension));
  if (hasModelFiles) {
    projects.push({
      path: dirPath,
      name: path.basename(dirPath),
      hasYaml,
      files,
    });
  }

  return projects;
}

export function registerScannerHandlers(): void {
  ipcMain.handle('app:scan-library-root', (_event, rootId: number) => {
    const db = getDatabase();
    const root = db.prepare('SELECT * FROM library_roots WHERE id = ?').get(rootId) as
      | {
          id: number;
          path: string;
        }
      | undefined;

    if (!root) {
      log.error('Library root not found:', rootId);
      return { success: false, error: 'Library root not found' };
    }

    if (!fs.existsSync(root.path)) {
      db.prepare('UPDATE library_roots SET is_online = 0 WHERE id = ?').run(rootId);
      log.warn('Library root offline:', root.path);
      return { success: false, error: 'Library root is offline' };
    }

    db.prepare('UPDATE library_roots SET is_online = 1 WHERE id = ?').run(rootId);

    log.info('Scanning library root:', root.path);
    const projects = scanDirectory(root.path);

    const insertProject = db.prepare(
      "INSERT OR REPLACE INTO projects (root_id, path, name, has_yaml, updated_at) VALUES (?, ?, ?, ?, datetime('now'))",
    );
    const insertFile = db.prepare(
      'INSERT OR REPLACE INTO files (project_id, path, name, extension, size_bytes) VALUES (?, ?, ?, ?, ?)',
    );

    const scanTransaction = db.transaction(() => {
      db.prepare(
        'DELETE FROM files WHERE project_id IN (SELECT id FROM projects WHERE root_id = ?)',
      ).run(rootId);
      db.prepare(
        'DELETE FROM projects_fts WHERE rowid IN (SELECT id FROM projects WHERE root_id = ?)',
      ).run(rootId);
      db.prepare('DELETE FROM projects WHERE root_id = ?').run(rootId);

      for (const project of projects) {
        const projectInfo = insertProject.run(
          rootId,
          project.path,
          project.name,
          project.hasYaml ? 1 : 0,
        );
        const projectId = projectInfo.lastInsertRowid;

        // Populate FTS index
        db.prepare('INSERT INTO projects_fts (rowid, name, path) VALUES (?, ?, ?)').run(
          projectId,
          project.name,
          project.path,
        );

        for (const file of project.files) {
          insertFile.run(projectId, file.path, file.name, file.extension, file.size);
        }
      }
    });

    scanTransaction();

    db.prepare("UPDATE library_roots SET last_scan_at = datetime('now') WHERE id = ?").run(rootId);

    log.info(`Scan complete: ${projects.length} projects found`);
    return { success: true, projectCount: projects.length };
  });

  ipcMain.handle('app:get-projects', (_event, rootId?: number) => {
    const db = getDatabase();
    if (rootId) {
      return db
        .prepare(
          'SELECT p.*, lr.path as root_path FROM projects p JOIN library_roots lr ON p.root_id = lr.id WHERE p.root_id = ? ORDER BY p.name',
        )
        .all(rootId);
    }
    return db
      .prepare(
        'SELECT p.*, lr.path as root_path FROM projects p JOIN library_roots lr ON p.root_id = lr.id ORDER BY p.name',
      )
      .all();
  });

  ipcMain.handle('app:get-project-files', (_event, projectId: number) => {
    const db = getDatabase();
    return db.prepare('SELECT * FROM files WHERE project_id = ? ORDER BY name').all(projectId);
  });

  ipcMain.handle('app:search-projects', (_event, query: string) => {
    const db = getDatabase();
    if (!query || query.trim().length === 0) {
      return db
        .prepare(
          'SELECT p.*, lr.path as root_path FROM projects p JOIN library_roots lr ON p.root_id = lr.id ORDER BY p.name',
        )
        .all();
    }

    // Use FTS5 for fast text search
    const ftsQuery = query
      .trim()
      .split(/\s+/)
      .map((term) => `"${term}"*`)
      .join(' ');

    try {
      return db
        .prepare(
          `SELECT p.*, lr.path as root_path
           FROM projects_fts fts
           JOIN projects p ON fts.rowid = p.id
           JOIN library_roots lr ON p.root_id = lr.id
           WHERE projects_fts MATCH ?
           ORDER BY rank`,
        )
        .all(ftsQuery);
    } catch {
      // Fallback to LIKE search if FTS fails
      return db
        .prepare(
          `SELECT p.*, lr.path as root_path FROM projects p
           JOIN library_roots lr ON p.root_id = lr.id
           WHERE p.name LIKE ? ORDER BY p.name`,
        )
        .all(`%${query}%`);
    }
  });
}
