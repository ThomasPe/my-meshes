import type { AppInfo, BatchReport, BatchUpdate, Collection, Facets, ThumbLocation, UpdateInfo, FolderNode, ImportItem, ImportProgress, ImportReport, ImportRequest, InboxFile, LibraryChanged, LibraryRoot, LibraryStats, ListQuery, Project, ProjectSummary, ScanProgress, ScanReport, SmartCollection, SyncMode, TagCount, ThumbJob, ThumbStats, UpdateMetadata } from '@/lib/types';

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
  facets(rootId?: string | null): Promise<Facets>;
  batchUpdateMetadata(projectIds: string[], update: BatchUpdate): Promise<BatchReport>;
  getThumbLocation(): Promise<ThumbLocation>;
  setThumbLocation(location: ThumbLocation): Promise<ThumbLocation>;
  /** OS notification; asks for permission on first use. Resolves false when not shown. */
  notify(title: string, body: string): Promise<boolean>;
  folderTree(rootId: string): Promise<FolderNode[]>;
  libraryStats(rootId?: string | null): Promise<LibraryStats>;
  /** Last lines of the app log with the home directory shortened, for a bug report. */
  logTail(lines: number): Promise<string>;
  /** Opens an http(s) link in the default browser. */
  openUrl(url: string): Promise<void>;
  readProjectFile(projectId: string, relPath: string): Promise<ArrayBuffer>;
  updateMetadata(projectId: string, update: UpdateMetadata): Promise<Project>;
  revealProject(projectId: string): Promise<void>;
  /** Opens a folder of a root (tree node, inbox) in the file manager. */
  revealFolder(rootId: string, relPath: string): Promise<void>;
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
  pickImportFiles(): Promise<string[]>;
  analyzeImport(paths: string[]): Promise<ImportItem[]>;
  executeImport(request: ImportRequest): Promise<ImportReport>;
  listInbox(rootId: string): Promise<InboxFile[]>;
  promoteInbox(rootId: string, files: string[], name: string): Promise<Project>;
  deleteInboxFile(rootId: string, name: string): Promise<void>;
  getCollections(): Promise<Collection[]>;
  createCollection(name: string): Promise<Collection>;
  renameCollection(id: string, name: string): Promise<Collection>;
  deleteCollection(id: string): Promise<void>;
  addToCollection(id: string, projectIds: string[]): Promise<Collection>;
  removeFromCollection(id: string, projectIds: string[]): Promise<Collection>;
  reorderCollection(id: string, order: string[]): Promise<Collection>;
  getSmartCollections(): Promise<SmartCollection[]>;
  createSmartCollection(name: string, query: ListQuery): Promise<SmartCollection>;
  updateSmartCollection(id: string, name?: string, query?: ListQuery): Promise<SmartCollection>;
  deleteSmartCollection(id: string): Promise<void>;
  listSmartCollection(id: string, overrides?: ListQuery): Promise<ProjectSummary[]>;
  onImportProgress(cb: (p: ImportProgress) => void): Promise<Unlisten>;
  onCollectionsChanged(cb: () => void): Promise<Unlisten>;
  onInboxChanged(cb: (e: { rootId: string }) => void): Promise<Unlisten>;
  onWatchError(cb: (e: { rootId: string; message: string }) => void): Promise<Unlisten>;
  /** Native file drops (paths). Resolves to a no-op unlistener where unsupported (browser). */
  checkUpdate(): Promise<UpdateInfo>;
  installUpdate(): Promise<void>;
  onFileDrop(cb: (e: { type: 'enter' | 'drop' | 'leave'; paths: string[] }) => void): Promise<Unlisten>;
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
