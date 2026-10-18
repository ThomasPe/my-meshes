import type { AppInfo, FolderNode, LibraryChanged, LibraryRoot, LibraryStats, ListQuery, Project, ProjectSummary, ScanProgress, ScanReport, SyncMode, TagCount, ThumbJob, ThumbStats, UpdateMetadata } from '@/lib/types';

export type Unlisten = () => void;

/** Everything the UI needs from the shell. Implemented by Tauri commands and by an in-memory mock. */
export interface Backend {
  readonly kind: 'tauri' | 'mock';
  appInfo(): Promise<AppInfo>;
  getRoots(): Promise<LibraryRoot[]>;
  addRoot(path: string, mode?: SyncMode): Promise<LibraryRoot>;
  removeRoot(id: string): Promise<LibraryRoot>;
  setRootMode(id: string, mode: SyncMode, pollIntervalSecs?: number): Promise<LibraryRoot>;
  scanRoot(id: string): Promise<ScanReport>;
  listProjects(query: ListQuery): Promise<ProjectSummary[]>;
  getProject(id: string): Promise<Project>;
  tagCounts(rootId?: string | null): Promise<TagCount[]>;
  folderTree(rootId: string): Promise<FolderNode[]>;
  libraryStats(rootId?: string | null): Promise<LibraryStats>;
  readProjectFile(projectId: string, relPath: string): Promise<ArrayBuffer>;
  updateMetadata(projectId: string, update: UpdateMetadata): Promise<Project>;
  revealProject(projectId: string): Promise<void>;
  openProjectFile(projectId: string, relPath: string): Promise<void>;
  pickFolder(): Promise<string | null>;
  getIgnorePatterns(): Promise<string[]>;
  setIgnorePatterns(patterns: string[]): Promise<string[]>;
  getContainerDirs(): Promise<string[]>;
  setContainerDirs(names: string[]): Promise<string[]>;
  setFavorite(projectId: string, favorite: boolean): Promise<Project>;
  renameProject(projectId: string, newName: string): Promise<Project>;
  deleteProject(projectId: string): Promise<void>;
  deleteFile(projectId: string, relPath: string): Promise<Project | null>;
  thumbQueue(limit?: number): Promise<ThumbJob[]>;
  thumbStats(): Promise<ThumbStats>;
  storeThumbnail(projectId: string, png: ArrayBuffer): Promise<string>;
  storeEmbeddedThumbnail(projectId: string): Promise<string>;
  thumbnailFailed(projectId: string, reason: string): Promise<void>;
  readThumbnail(key: string): Promise<ArrayBuffer>;
  clearThumbnails(): Promise<void>;
  onScanProgress(cb: (p: ScanProgress) => void): Promise<Unlisten>;
  onLibraryChanged(cb: (e: LibraryChanged) => void): Promise<Unlisten>;
  onProjectChanged(cb: (e: { projectId: string }) => void): Promise<Unlisten>;
}

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
export const forceMock = typeof location !== 'undefined' && new URLSearchParams(location.search).has('mock');

let instance: Promise<Backend> | null = null;
export function getBackend(): Promise<Backend> {
  if (!instance) {
    instance = isTauri && !forceMock ? import('./tauri').then((m) => m.createTauriBackend()) : import('./mock').then((m) => m.createMockBackend());
  }
  return instance;
}
