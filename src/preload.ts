import { contextBridge, ipcRenderer } from 'electron';

const electronApi = {
  windowMinimize: (): Promise<void> => ipcRenderer.invoke('app:window-minimize'),
  windowMaximize: (): Promise<void> => ipcRenderer.invoke('app:window-maximize'),
  windowClose: (): Promise<void> => ipcRenderer.invoke('app:window-close'),
  windowIsMaximized: (): Promise<boolean> => ipcRenderer.invoke('app:window-is-maximized'),
  getAppInfo: (): Promise<{ version: string; name: string; isTestMode: boolean }> =>
    ipcRenderer.invoke('app:get-app-info'),
  dbHealth: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('app:db-health'),

  // Library roots
  listLibraryRoots: (): Promise<
    Array<{
      id: number;
      path: string;
      label: string | null;
      last_scan_at: string | null;
      is_online: number;
    }>
  > => ipcRenderer.invoke('app:library-roots-list'),
  addLibraryRoot: (): Promise<{
    id: number;
    path: string;
    label: string | null;
  } | null> => ipcRenderer.invoke('app:library-root-add'),
  addLibraryRootPath: (
    folderPath: string,
  ): Promise<{ id: number; path: string; label: string | null } | null> =>
    ipcRenderer.invoke('app:library-root-add-path', folderPath),
  removeLibraryRoot: (id: number): Promise<boolean> =>
    ipcRenderer.invoke('app:library-root-remove', id),

  // Scanner
  scanLibraryRoot: (
    rootId: number,
  ): Promise<{ success: boolean; projectCount?: number; error?: string }> =>
    ipcRenderer.invoke('app:scan-library-root', rootId),
  getProjects: (
    rootId?: number,
  ): Promise<
    Array<{
      id: number;
      root_id: number;
      path: string;
      name: string;
      has_yaml: number;
      root_path: string;
    }>
  > => ipcRenderer.invoke('app:get-projects', rootId),
  getProjectFiles: (
    projectId: number,
  ): Promise<
    Array<{
      id: number;
      project_id: number;
      path: string;
      name: string;
      extension: string;
      size_bytes: number | null;
    }>
  > => ipcRenderer.invoke('app:get-project-files', projectId),
  searchProjects: (
    query: string,
  ): Promise<
    Array<{
      id: number;
      root_id: number;
      path: string;
      name: string;
      has_yaml: number;
      root_path: string;
    }>
  > => ipcRenderer.invoke('app:search-projects', query),

  // YAML metadata
  getProjectMetadata: (
    projectPath: string,
  ): Promise<{
    metadata?: {
      title?: string;
      creator?: string;
      license?: string;
      source_url?: string;
      tags?: string[];
    };
  } | null> => ipcRenderer.invoke('app:get-project-metadata', projectPath),
  updateProjectMetadata: (
    projectId: number,
    projectPath: string,
    updates: Record<string, unknown>,
  ): Promise<boolean> =>
    ipcRenderer.invoke('app:update-project-metadata', projectId, projectPath, updates),

  // Watcher
  watcherStart: (rootId: number): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('app:watcher-start', rootId),
  watcherStop: (rootId: number): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('app:watcher-stop', rootId),
  watcherStatus: (): Promise<Array<{ rootId: number; watching: boolean }>> =>
    ipcRenderer.invoke('app:watcher-status'),
  onWatcherChange: (
    callback: (data: { type: string; filePath: string; rootId: number }) => void,
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: { type: string; filePath: string; rootId: number },
    ) => callback(data);
    ipcRenderer.on('app:watcher-change', handler);
    return () => ipcRenderer.removeListener('app:watcher-change', handler);
  },
  onWatcherStatus: (callback: (data: { rootId: number; watching: boolean }) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: { rootId: number; watching: boolean },
    ) => callback(data);
    ipcRenderer.on('app:watcher-status', handler);
    return () => ipcRenderer.removeListener('app:watcher-status', handler);
  },

  // Import & File operations
  openFileExternal: (filePath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('app:open-file-external', filePath),
  safeDelete: (
    filePaths: string[],
  ): Promise<Array<{ path: string; success: boolean; error?: string }>> =>
    ipcRenderer.invoke('app:safe-delete', filePaths),
  safeDeleteProject: (projectId: number): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('app:safe-delete-project', projectId),
  readFileBase64: (
    filePath: string,
  ): Promise<{ success: boolean; data?: string; extension?: string; error?: string }> =>
    ipcRenderer.invoke('app:read-file-base64', filePath),
  dragStart: (filePath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('app:drag-start', filePath),
};

contextBridge.exposeInMainWorld('electronApi', electronApi);

export type ElectronApi = typeof electronApi;
