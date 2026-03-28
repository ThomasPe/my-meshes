import fs from 'node:fs';
import path from 'node:path';
import { ipcMain, shell } from 'electron';
import log from 'electron-log/main';
import { getDatabase } from '../database';

export function registerImportHandlers(): void {
  // Open a file in the default system app
  ipcMain.handle('app:open-file-external', (_event, filePath: string) => {
    try {
      shell.openPath(filePath);
      return { success: true };
    } catch (error) {
      log.error('Failed to open file externally:', filePath, error);
      return { success: false, error: String(error) };
    }
  });

  // Move file to OS trash (safe delete)
  ipcMain.handle('app:safe-delete', async (_event, filePaths: string[]) => {
    const results: Array<{ path: string; success: boolean; error?: string }> = [];

    for (const fp of filePaths) {
      try {
        await shell.trashItem(fp);
        // Remove from DB
        const db = getDatabase();
        db.prepare('DELETE FROM files WHERE path = ?').run(fp);
        results.push({ path: fp, success: true });
        log.info('Moved to trash:', fp);
      } catch (error) {
        results.push({ path: fp, success: false, error: String(error) });
        log.error('Failed to trash:', fp, error);
      }
    }

    // Clean up empty projects
    const db = getDatabase();
    db.prepare(
      'DELETE FROM projects WHERE id NOT IN (SELECT DISTINCT project_id FROM files)',
    ).run();

    return results;
  });

  // Safe delete a project (moves entire folder to trash)
  ipcMain.handle('app:safe-delete-project', async (_event, projectId: number) => {
    const db = getDatabase();
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as
      | { id: number; path: string }
      | undefined;

    if (!project) {
      return { success: false, error: 'Project not found' };
    }

    try {
      await shell.trashItem(project.path);
      db.prepare('DELETE FROM files WHERE project_id = ?').run(projectId);
      db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
      log.info('Project trashed:', project.path);
      return { success: true };
    } catch (error) {
      log.error('Failed to trash project:', project.path, error);
      return { success: false, error: String(error) };
    }
  });

  // Read file as base64 for renderer (for 3D viewer file:// protocol workaround)
  ipcMain.handle('app:read-file-base64', (_event, filePath: string) => {
    try {
      const buffer = fs.readFileSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      return { success: true, data: buffer.toString('base64'), extension: ext };
    } catch (error) {
      log.error('Failed to read file:', filePath, error);
      return { success: false, error: String(error) };
    }
  });

  // Drag start handler for exporting files
  ipcMain.handle('app:drag-start', (event, filePath: string) => {
    try {
      event.sender.startDrag({
        file: filePath,
        icon: path.join(__dirname, '..', 'renderer', 'main_window', 'favicon.ico'),
      });
      return { success: true };
    } catch (error) {
      log.error('Failed to start drag:', error);
      return { success: false, error: String(error) };
    }
  });
}
