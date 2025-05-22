import { contextBridge, ipcRenderer } from "electron";

export function exposeFilesystemContext() {
  contextBridge.exposeInMainWorld("filesystem", {
    selectDirectory: async () => {
      return ipcRenderer.invoke("select-directory");
    },
    readDirectory: async (dirPath: string) => {
      return ipcRenderer.invoke("read-directory", dirPath);
    },
    readSubdirectory: async (dirPath: string) => {
      return ipcRenderer.invoke("read-subdirectory", dirPath);
    }
  });
}