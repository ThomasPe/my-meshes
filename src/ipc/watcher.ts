import path from 'node:path';
import fs from 'node:fs';
import { ipcMain, BrowserWindow } from 'electron';
import type { FSWatcher } from 'chokidar';
import chokidar from 'chokidar';
import log from 'electron-log/main';
import { getDatabase } from '../database';

const MODEL_EXTENSIONS = new Set(['.stl', '.obj', '.3mf']);

interface WatcherState {
  watcher: FSWatcher;
  rootId: number;
  rootPath: string;
}

const watchers = new Map<number, WatcherState>();

function notifyRenderer(channel: string, data: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, data);
  }
}

function findProjectForFile(
  filePath: string,
  _rootId: number,
): { projectPath: string; projectName: string } {
  const dir = path.dirname(filePath);
  return {
    projectPath: dir,
    projectName: path.basename(dir),
  };
}

function ensureProjectExists(rootId: number, projectPath: string, projectName: string): number {
  const db = getDatabase();
  const existing = db
    .prepare('SELECT id FROM projects WHERE path = ? AND root_id = ?')
    .get(projectPath, rootId) as { id: number } | undefined;

  if (existing) return existing.id;

  const hasYaml = fs.existsSync(path.join(projectPath, 'project.yaml')) ? 1 : 0;
  const info = db
    .prepare(
      "INSERT INTO projects (root_id, path, name, has_yaml, updated_at) VALUES (?, ?, ?, ?, datetime('now'))",
    )
    .run(rootId, projectPath, projectName, hasYaml);
  return Number(info.lastInsertRowid);
}

function handleFileAdd(filePath: string, rootId: number): void {
  const ext = path.extname(filePath).toLowerCase();
  if (!MODEL_EXTENSIONS.has(ext)) return;

  const { projectPath, projectName } = findProjectForFile(filePath, rootId);

  try {
    const projectId = ensureProjectExists(rootId, projectPath, projectName);
    const db = getDatabase();
    const stats = fs.statSync(filePath);

    db.prepare(
      'INSERT OR REPLACE INTO files (project_id, path, name, extension, size_bytes) VALUES (?, ?, ?, ?, ?)',
    ).run(projectId, filePath, path.basename(filePath), ext, stats.size);

    log.info('Watcher: file added', filePath);
    notifyRenderer('app:watcher-change', { type: 'add', filePath, rootId });
  } catch (error) {
    log.error('Watcher: error handling file add', filePath, error);
  }
}

function handleFileRemove(filePath: string, rootId: number): void {
  const ext = path.extname(filePath).toLowerCase();
  if (!MODEL_EXTENSIONS.has(ext)) return;

  try {
    const db = getDatabase();
    db.prepare('DELETE FROM files WHERE path = ?').run(filePath);

    // Clean up empty projects
    const projectPath = path.dirname(filePath);
    const project = db.prepare('SELECT id FROM projects WHERE path = ?').get(projectPath) as
      | { id: number }
      | undefined;

    if (project) {
      const remaining = db
        .prepare('SELECT COUNT(*) as count FROM files WHERE project_id = ?')
        .get(project.id) as { count: number };

      if (remaining.count === 0) {
        db.prepare('DELETE FROM projects WHERE id = ?').run(project.id);
      }
    }

    log.info('Watcher: file removed', filePath);
    notifyRenderer('app:watcher-change', { type: 'remove', filePath, rootId });
  } catch (error) {
    log.error('Watcher: error handling file remove', filePath, error);
  }
}

export function startWatcher(rootId: number, rootPath: string): boolean {
  if (watchers.has(rootId)) {
    log.info('Watcher already running for root:', rootId);
    return true;
  }

  if (!fs.existsSync(rootPath)) {
    log.warn('Cannot watch non-existent path:', rootPath);
    return false;
  }

  const watcher = chokidar.watch(rootPath, {
    persistent: true,
    ignoreInitial: true,
    ignored: [/(^|[/\\])\.git/, /(^|[/\\])__MACOSX/, /(^|[/\\])node_modules/],
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
  });

  watcher
    .on('add', (fp) => handleFileAdd(fp, rootId))
    .on('unlink', (fp) => handleFileRemove(fp, rootId))
    .on('error', (error) => log.error('Watcher error for root', rootId, error));

  watchers.set(rootId, { watcher, rootId, rootPath });
  log.info('Watcher started for root:', rootId, rootPath);
  notifyRenderer('app:watcher-status', { rootId, watching: true });
  return true;
}

export function stopWatcher(rootId: number): void {
  const state = watchers.get(rootId);
  if (state) {
    state.watcher.close();
    watchers.delete(rootId);
    log.info('Watcher stopped for root:', rootId);
    notifyRenderer('app:watcher-status', { rootId, watching: false });
  }
}

export function stopAllWatchers(): void {
  for (const [rootId] of watchers) {
    stopWatcher(rootId);
  }
}

export function registerWatcherHandlers(): void {
  ipcMain.handle('app:watcher-start', (_event, rootId: number) => {
    const db = getDatabase();
    const root = db.prepare('SELECT * FROM library_roots WHERE id = ?').get(rootId) as
      | { id: number; path: string }
      | undefined;

    if (!root) return { success: false, error: 'Root not found' };
    return { success: startWatcher(root.id, root.path) };
  });

  ipcMain.handle('app:watcher-stop', (_event, rootId: number) => {
    stopWatcher(rootId);
    return { success: true };
  });

  ipcMain.handle('app:watcher-status', () => {
    const status: Array<{ rootId: number; watching: boolean }> = [];
    const db = getDatabase();
    const roots = db.prepare('SELECT id FROM library_roots').all() as Array<{ id: number }>;

    for (const root of roots) {
      status.push({ rootId: root.id, watching: watchers.has(root.id) });
    }
    return status;
  });
}
