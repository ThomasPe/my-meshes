import fs from 'node:fs/promises';
import path from 'node:path';

export interface ScannedLibraryItem {
  fileName: string;
  relativePath: string;
  extension: string;
  projectFolder: string;
}

export interface RootScanResult {
  status: 'online' | 'offline';
  items: ScannedLibraryItem[];
}

const modelExtensions = new Set(['.stl', '.obj', '.3mf']);
const ignoredDirectories = new Set(['.git', '__MACOSX']);

const walkDirectory = async (
  rootPath: string,
  currentPath: string,
  items: ScannedLibraryItem[],
): Promise<void> => {
  const directoryEntries = await fs.readdir(currentPath, { withFileTypes: true });

  for (const entry of directoryEntries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
      continue;
    }

    const absolutePath = path.join(currentPath, entry.name);

    if (entry.isDirectory()) {
      await walkDirectory(rootPath, absolutePath, items);
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();

    if (!modelExtensions.has(extension)) {
      continue;
    }

    const relativePath = path.relative(rootPath, absolutePath).split(path.sep).join('/');
    const pathSegments = relativePath.split('/');
    const projectFolder =
      pathSegments.length > 1
        ? (pathSegments[0] ?? path.basename(rootPath))
        : path.basename(rootPath);

    items.push({
      fileName: entry.name,
      relativePath,
      extension,
      projectFolder,
    });
  }
};

export const scanLibraryRoot = async (rootPath: string): Promise<RootScanResult> => {
  const stats = await fs.stat(rootPath).catch(() => null);

  if (!stats || !stats.isDirectory()) {
    return {
      status: 'offline',
      items: [],
    };
  }

  const items: ScannedLibraryItem[] = [];
  await walkDirectory(rootPath, rootPath, items);

  items.sort((left, right) => left.relativePath.localeCompare(right.relativePath));

  return {
    status: 'online',
    items,
  };
};