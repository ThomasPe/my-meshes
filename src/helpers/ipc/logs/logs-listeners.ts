import { ipcMain, BrowserWindow } from "electron";
import { v4 as uuidv4 } from "uuid";
import {
  LOGS_ADD_CHANNEL,
  LOGS_GET_ALL_CHANNEL,
  LOGS_CLEAR_CHANNEL,
} from "./logs-channels";
import { LogMessage } from "./logs-context";

// Store logs in memory
const logs: LogMessage[] = [];
let mainWindow: BrowserWindow | null = null;

export function addLogsEventListeners(window: BrowserWindow) {
  mainWindow = window;
  
  ipcMain.handle(LOGS_ADD_CHANNEL, (_event, message: string, type: 'info' | 'warning' | 'error' | 'success' = 'info') => {
    const newLog: LogMessage = {
      id: uuidv4(),
      timestamp: Date.now(),
      message,
      type,
    };
    
    logs.push(newLog);
    
    // Limit log storage to prevent memory issues (keep last 1000 logs)
    if (logs.length > 1000) {
      logs.shift();
    }
    
    // Send the new log to the renderer
    mainWindow?.webContents.send(LOGS_ADD_CHANNEL, newLog);
    
    return newLog;
  });
  
  ipcMain.handle(LOGS_GET_ALL_CHANNEL, () => {
    return logs;
  });
  
  ipcMain.handle(LOGS_CLEAR_CHANNEL, () => {
    logs.length = 0;
    return true;
  });
}

// Utility function to add logs from anywhere in the main process
export function addLog(message: string, type: 'info' | 'warning' | 'error' | 'success' = 'info') {
  const newLog: LogMessage = {
    id: uuidv4(),
    timestamp: Date.now(),
    message,
    type,
  };
  
  logs.push(newLog);
  
  // Limit log storage to prevent memory issues
  if (logs.length > 1000) {
    logs.shift();
  }
  
  // Send the new log to the renderer if window is available
  if (mainWindow) {
    mainWindow.webContents.send(LOGS_ADD_CHANNEL, newLog);
  }
  
  return newLog;
}