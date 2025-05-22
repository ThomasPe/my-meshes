import { dialog, ipcMain } from "electron";
import * as fs from "fs";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import {
  FILESYSTEM_SELECT_DIRECTORY_CHANNEL,
  FILESYSTEM_READ_DIRECTORY_CHANNEL,
  FILESYSTEM_READ_SUBDIRECTORY_CHANNEL
} from "./filesystem-channels";

// Function to get file stats in a format compatible with our UI types
const getStats = (filePath: string) => {
  const stats = fs.statSync(filePath);
  const isDirectory = stats.isDirectory();
  
  return {
    size: isDirectory ? "" : `${Math.round(stats.size / 1024)} KB`,
    modifiedDate: stats.mtime.toISOString().split("T")[0],
    isDirectory,
  };
};

// Helper to get file extension
const getFileExtension = (filename: string): string => {
  const ext = path.extname(filename).toUpperCase();
  return ext ? ext.substring(1) : "";
};

export function addFileSystemEventListeners() {
  // Handler for selecting a root folder
  ipcMain.handle(FILESYSTEM_SELECT_DIRECTORY_CHANNEL, async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
    });

    if (result.canceled) {
      return null;
    }

    const dirPath = result.filePaths[0];
    return dirPath;
  });

  // Handler for reading directory contents
  ipcMain.handle(FILESYSTEM_READ_DIRECTORY_CHANNEL, async (_event, dirPath: string) => {
    try {
      const items = fs.readdirSync(dirPath);
      
      const processedItems = items
        .filter(item => !item.startsWith(".")) // Filter out hidden files/folders
        .map(item => {
          const fullPath = path.join(dirPath, item);
          const { size, modifiedDate, isDirectory } = getStats(fullPath);
          const id = uuidv4();
          
          if (isDirectory) {
            return {
              id,
              name: item,
              type: "folder" as const,
              expanded: false,
              path: fullPath,
              items: [] // Empty initially, will be loaded on demand
            };
          } else {
            return {
              id,
              name: item,
              type: "file" as const,
              size,
              modifiedDate,
              fileType: getFileExtension(item),
              path: fullPath
            };
          }
        });
      
      return processedItems;
    } catch (error) {
      console.error("Error reading directory:", error);
      throw error;
    }
  });

  // Handler for reading subdirectory contents
  ipcMain.handle(FILESYSTEM_READ_SUBDIRECTORY_CHANNEL, async (_event, dirPath: string) => {
    try {
      const items = fs.readdirSync(dirPath);
      
      const processedItems = items
        .filter(item => !item.startsWith(".")) // Filter out hidden files/folders
        .map(item => {
          const fullPath = path.join(dirPath, item);
          const { size, modifiedDate, isDirectory } = getStats(fullPath);
          const id = uuidv4();
          
          if (isDirectory) {
            return {
              id,
              name: item,
              type: "folder" as const,
              expanded: false,
              path: fullPath,
              items: [] // Empty initially, will be loaded on demand
            };
          } else {
            return {
              id,
              name: item,
              type: "file" as const,
              size,
              modifiedDate,
              fileType: getFileExtension(item),
              path: fullPath
            };
          }
        });
      
      return processedItems;
    } catch (error) {
      console.error("Error reading subdirectory:", error);
      throw error;
    }
  });
}