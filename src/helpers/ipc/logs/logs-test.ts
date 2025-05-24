import { addLog } from "./logs-listeners";

// Utility function to generate test logs in the main process
export function generateTestLogs() {
  addLog("Application started", "info");
  addLog("Loading configuration file", "info");
  
  setTimeout(() => {
    addLog("Configuration loaded successfully", "success");
  }, 2000);
  
  setTimeout(() => {
    addLog("Scanning for available 3D models", "info");
  }, 4000);
  
  setTimeout(() => {
    addLog("Found 128 models in library", "success");
  }, 6000);
  
  setTimeout(() => {
    addLog("Warning: Some thumbnail generation tasks failed", "warning");
  }, 8000);
  
  setTimeout(() => {
    addLog("Failed to load model 'dragon.stl' - file corrupted", "error");
  }, 10000);
}