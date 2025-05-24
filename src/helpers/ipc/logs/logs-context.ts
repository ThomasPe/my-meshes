import {
  LOGS_ADD_CHANNEL,
  LOGS_GET_ALL_CHANNEL,
  LOGS_CLEAR_CHANNEL,
} from "./logs-channels";

export interface LogMessage {
  id: string;
  timestamp: number;
  message: string;
  type: 'info' | 'warning' | 'error' | 'success';
}

export function exposeLogsContext() {
  const { contextBridge, ipcRenderer } = window.require("electron");
  
  contextBridge.exposeInMainWorld("logs", {
    add: (message: string, type: 'info' | 'warning' | 'error' | 'success' = 'info') => 
      ipcRenderer.invoke(LOGS_ADD_CHANNEL, message, type),
    getAll: () => ipcRenderer.invoke(LOGS_GET_ALL_CHANNEL),
    clear: () => ipcRenderer.invoke(LOGS_CLEAR_CHANNEL),
    onNewLog: (callback: (log: LogMessage) => void) => {
      const listener = (_event: any, log: LogMessage) => callback(log);
      ipcRenderer.on(LOGS_ADD_CHANNEL, listener);
      return () => {
        ipcRenderer.removeListener(LOGS_ADD_CHANNEL, listener);
      };
    }
  });
}