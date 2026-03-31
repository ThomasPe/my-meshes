export type LibraryRootStatus = 'online' | 'offline';

export type LibraryRootSyncState = 'idle' | 'syncing' | 'error';

export type WindowAction = 'minimize' | 'toggle-maximize' | 'close';

export interface WindowState {
  isMaximized: boolean;
  isMinimized: boolean;
}

export interface AppBootstrap {
  appName: string;
  version: string;
  platform: NodeJS.Platform;
  isTestMode: boolean;
  database: {
    isReady: boolean;
    path: string;
  };
}

export interface LibraryItem {
  id: number;
  rootId: number;
  fileName: string;
  relativePath: string;
  extension: string;
  projectFolder: string;
  status: 'online' | 'offline';
}

export interface LibraryRoot {
  id: number;
  name: string;
  path: string;
  status: LibraryRootStatus;
  syncState: LibraryRootSyncState;
  errorMessage: string | null;
  lastSyncAt: string | null;
  itemCount: number;
  sampleItems: LibraryItem[];
}

export interface LibraryRootsSnapshot {
  roots: LibraryRoot[];
}

export interface AppApi {
  getBootstrap: () => Promise<AppBootstrap>;
  getWindowState: () => Promise<WindowState>;
  invokeWindowAction: (action: WindowAction) => Promise<WindowState>;
  listLibraryRoots: () => Promise<LibraryRootsSnapshot>;
  addLibraryRoot: (rootPath: string) => Promise<LibraryRootsSnapshot>;
  removeLibraryRoot: (rootId: number) => Promise<LibraryRootsSnapshot>;
  rescanLibraryRoot: (rootId: number) => Promise<LibraryRootsSnapshot>;
  onLibraryRootsChanged: (
    listener: (snapshot: LibraryRootsSnapshot) => void,
  ) => () => void;
}