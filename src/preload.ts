import { contextBridge, ipcRenderer } from 'electron';

const electronApi = {
  windowMinimize: (): Promise<void> => ipcRenderer.invoke('app:window-minimize'),
  windowMaximize: (): Promise<void> => ipcRenderer.invoke('app:window-maximize'),
  windowClose: (): Promise<void> => ipcRenderer.invoke('app:window-close'),
  windowIsMaximized: (): Promise<boolean> => ipcRenderer.invoke('app:window-is-maximized'),
  getAppInfo: (): Promise<{ version: string; name: string; isTestMode: boolean }> =>
    ipcRenderer.invoke('app:get-app-info'),
  dbHealth: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('app:db-health'),
};

contextBridge.exposeInMainWorld('electronApi', electronApi);

export type ElectronApi = typeof electronApi;
