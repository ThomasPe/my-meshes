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
};

contextBridge.exposeInMainWorld('electronApi', electronApi);

export type ElectronApi = typeof electronApi;
