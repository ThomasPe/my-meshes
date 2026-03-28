import fs from 'node:fs';
import path from 'node:path';
import { ipcMain, shell, dialog, BrowserWindow } from 'electron';
import log from 'electron-log/main';
import JSZip from 'jszip';
import { getDatabase } from '../database';

const MODEL_EXTENSIONS = new Set(['.stl', '.obj', '.3mf']);
const IGNORED_ARCHIVE_ENTRIES = ['__MACOSX', '.DS_Store', 'Thumbs.db', '.git'];

interface ArchiveEntry {
  path: string;
  name: string;
  size: number;
  isDirectory: boolean;
  isModelFile: boolean;
}

interface InspectedArchive {
  archivePath: string;
  archiveName: string;
  entries: ArchiveEntry[];
  modelFileCount: number;
  totalSize: number;
  suggestedProjectName: string;
}

function shouldIgnoreArchiveEntry(entryPath: string): boolean {
  const parts = entryPath.split('/');
  return parts.some((part) => IGNORED_ARCHIVE_ENTRIES.includes(part));
}

function suggestProjectName(archivePath: string, entries: ArchiveEntry[]): string {
  const archiveName = path.basename(archivePath, path.extname(archivePath));

  // Check if all files share a common top-level directory
  const topDirs = new Set<string>();
  for (const entry of entries) {
    if (!entry.isDirectory) {
      const firstPart = entry.path.split('/')[0];
      topDirs.add(firstPart);
    }
  }

  // If there's a single top-level dir containing everything, use it as project name
  if (topDirs.size === 1) {
    const singleDir = [...topDirs][0];
    // Check it's actually a directory (not a root-level file)
    const hasSubfiles = entries.some(
      (e) => !e.isDirectory && e.path.includes('/') && e.path.startsWith(singleDir + '/'),
    );
    if (hasSubfiles) return singleDir;
  }

  return archiveName;
}

async function inspectArchive(archivePath: string): Promise<InspectedArchive> {
  const data = fs.readFileSync(archivePath);
  const zip = await JSZip.loadAsync(data);

  const entries: ArchiveEntry[] = [];
  let modelFileCount = 0;
  let totalSize = 0;

  for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
    if (shouldIgnoreArchiveEntry(relativePath)) continue;
    // Skip pure directory entries
    if (zipEntry.dir) continue;

    const ext = path.extname(relativePath).toLowerCase();
    const isModel = MODEL_EXTENSIONS.has(ext);
    if (isModel) modelFileCount++;

    // Use JSZip internal metadata for size instead of decompressing every entry
    const fileSize =
      (zipEntry as unknown as { _data?: { uncompressedSize?: number } })._data
        ?.uncompressedSize ?? 0;
    totalSize += fileSize;

    entries.push({
      path: relativePath,
      name: path.basename(relativePath),
      size: fileSize,
      isDirectory: false,
      isModelFile: isModel,
    });
  }

  const suggestedName = suggestProjectName(archivePath, entries);

  return {
    archivePath,
    archiveName: path.basename(archivePath),
    entries,
    modelFileCount,
    totalSize,
    suggestedProjectName: suggestedName,
  };
}

async function extractArchiveToProject(
  archivePath: string,
  targetRootPath: string,
  projectName: string,
): Promise<{ success: boolean; projectPath?: string; error?: string }> {
  try {
    const data = fs.readFileSync(archivePath);
    const zip = await JSZip.loadAsync(data);

    // Create the target project directory
    const projectDir = path.join(targetRootPath, projectName);

    // Check if the directory already exists
    if (fs.existsSync(projectDir)) {
      return { success: false, error: `Directory already exists: ${projectDir}` };
    }

    fs.mkdirSync(projectDir, { recursive: true });

    // Determine if we should strip a common top-level directory
    const topDirs = new Set<string>();
    const rootFiles: string[] = [];
    for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
      if (zipEntry.dir || shouldIgnoreArchiveEntry(relativePath)) continue;
      const parts = relativePath.split('/');
      if (parts.length > 1) {
        topDirs.add(parts[0]);
      } else {
        rootFiles.push(relativePath);
      }
    }

    // Strip the common prefix if there's exactly one top-level dir and no root-level files
    const stripPrefix =
      topDirs.size === 1 && rootFiles.length === 0 ? [...topDirs][0] + '/' : '';

    for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
      if (zipEntry.dir || shouldIgnoreArchiveEntry(relativePath)) continue;

      let targetRelPath = relativePath;
      if (stripPrefix && targetRelPath.startsWith(stripPrefix)) {
        targetRelPath = targetRelPath.slice(stripPrefix.length);
      }

      // Prevent path traversal
      const resolved = path.resolve(projectDir, targetRelPath);
      if (!resolved.startsWith(projectDir)) {
        log.warn('Skipping path traversal attempt in archive:', relativePath);
        continue;
      }

      const targetDir = path.dirname(resolved);
      fs.mkdirSync(targetDir, { recursive: true });

      const content = await zipEntry.async('nodebuffer');
      fs.writeFileSync(resolved, content);
    }

    log.info('Extracted archive to project:', projectDir);
    return { success: true, projectPath: projectDir };
  } catch (error) {
    log.error('Failed to extract archive:', archivePath, error);
    return { success: false, error: String(error) };
  }
}

async function importLooseFiles(
  filePaths: string[],
  targetRootPath: string,
): Promise<{ success: boolean; projectPath?: string; error?: string }> {
  try {
    const inboxDir = path.join(targetRootPath, 'Unsorted');
    fs.mkdirSync(inboxDir, { recursive: true });

    for (const filePath of filePaths) {
      const fileName = path.basename(filePath);
      const targetPath = path.join(inboxDir, fileName);

      // Prevent overwriting - add suffix if needed
      let finalPath = targetPath;
      let counter = 1;
      while (fs.existsSync(finalPath)) {
        const ext = path.extname(fileName);
        const base = path.basename(fileName, ext);
        finalPath = path.join(inboxDir, `${base}_${counter}${ext}`);
        counter++;
      }

      fs.copyFileSync(filePath, finalPath);
    }

    log.info('Imported loose files to Unsorted:', inboxDir);
    return { success: true, projectPath: inboxDir };
  } catch (error) {
    log.error('Failed to import loose files:', error);
    return { success: false, error: String(error) };
  }
}

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

  // Inspect one or more archives and return their contents for the staging area
  ipcMain.handle('app:import-inspect-archives', async (_event, archivePaths: string[]) => {
    const results: InspectedArchive[] = [];
    for (const archivePath of archivePaths) {
      try {
        const result = await inspectArchive(archivePath);
        results.push(result);
      } catch (error) {
        log.error('Failed to inspect archive:', archivePath, error);
      }
    }
    return results;
  });

  // Extract archives into project folders
  ipcMain.handle(
    'app:import-extract-archives',
    async (
      _event,
      items: Array<{ archivePath: string; projectName: string }>,
      targetRootPath: string,
    ) => {
      const results: Array<{ archivePath: string; success: boolean; projectPath?: string; error?: string }> = [];
      for (const item of items) {
        const result = await extractArchiveToProject(
          item.archivePath,
          targetRootPath,
          item.projectName,
        );
        results.push({ archivePath: item.archivePath, ...result });
      }
      return results;
    },
  );

  // Import loose (non-archive) files into an Unsorted project
  ipcMain.handle(
    'app:import-loose-files',
    async (_event, filePaths: string[], targetRootPath: string) => {
      return importLooseFiles(filePaths, targetRootPath);
    },
  );

  // Show an open-file dialog for selecting archives to import
  ipcMain.handle('app:import-select-files', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return [];

    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Archives', extensions: ['zip'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (result.canceled) return [];
    return result.filePaths;
  });
}
