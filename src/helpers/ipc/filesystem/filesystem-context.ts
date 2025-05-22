import {
  FILESYSTEM_SELECT_DIRECTORY_CHANNEL,
  FILESYSTEM_READ_DIRECTORY_CHANNEL,
  FILESYSTEM_READ_SUBDIRECTORY_CHANNEL
} from "./filesystem-channels";

export function exposeFilesystemContext() {
  const { contextBridge, ipcRenderer } = window.require("electron");
  
  contextBridge.exposeInMainWorld("filesystem", {
    selectDirectory: () => ipcRenderer.invoke(FILESYSTEM_SELECT_DIRECTORY_CHANNEL),
    readDirectory: (dirPath: string) => ipcRenderer.invoke(FILESYSTEM_READ_DIRECTORY_CHANNEL, dirPath),
    readSubdirectory: (dirPath: string) => ipcRenderer.invoke(FILESYSTEM_READ_SUBDIRECTORY_CHANNEL, dirPath)
  });
}