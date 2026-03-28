import { ipcMain, dialog, BrowserWindow } from 'electron';
import log from 'electron-log/main';
import { getDatabase } from '../database';

export interface LibraryRoot {
  id: number;
  path: string;
  label: string | null;
  last_scan_at: string | null;
  is_online: number;
}

export function registerLibraryHandlers(): void {
  ipcMain.handle('app:library-roots-list', () => {
    const db = getDatabase();
    return db.prepare('SELECT * FROM library_roots ORDER BY path').all() as LibraryRoot[];
  });

  ipcMain.handle('app:library-root-add', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;

    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: 'Select Library Root Folder',
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const folderPath = result.filePaths[0];

    try {
      const db = getDatabase();
      const stmt = db.prepare('INSERT INTO library_roots (path, label) VALUES (?, ?)');
      const info = stmt.run(folderPath, folderPath.split(/[\\/]/).pop() ?? folderPath);
      const root = db
        .prepare('SELECT * FROM library_roots WHERE id = ?')
        .get(info.lastInsertRowid) as LibraryRoot;
      log.info('Library root added:', folderPath);
      return root;
    } catch (error) {
      log.error('Failed to add library root:', error);
      return null;
    }
  });

  ipcMain.handle('app:library-root-add-path', (_event, folderPath: string) => {
    try {
      const db = getDatabase();
      const stmt = db.prepare('INSERT INTO library_roots (path, label) VALUES (?, ?)');
      const info = stmt.run(folderPath, folderPath.split(/[\\/]/).pop() ?? folderPath);
      const root = db
        .prepare('SELECT * FROM library_roots WHERE id = ?')
        .get(info.lastInsertRowid) as LibraryRoot;
      log.info('Library root added via path:', folderPath);
      return root;
    } catch (error) {
      log.error('Failed to add library root:', error);
      return null;
    }
  });

  ipcMain.handle('app:library-root-remove', (_event, id: number) => {
    try {
      const db = getDatabase();
      db.prepare('DELETE FROM library_roots WHERE id = ?').run(id);
      log.info('Library root removed:', id);
      return true;
    } catch (error) {
      log.error('Failed to remove library root:', error);
      return false;
    }
  });
}
