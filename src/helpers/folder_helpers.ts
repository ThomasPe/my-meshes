const ROOT_FOLDER_KEY = "rootFolder";

/**
 * Save the root folder path to localStorage
 * @param path The path to save
 */
export function saveRootFolder(path: string) {
  localStorage.setItem(ROOT_FOLDER_KEY, path);
}

/**
 * Get the saved root folder path from localStorage
 * @returns The saved root folder path, or null if none exists
 */
export function getRootFolder(): string | null {
  return localStorage.getItem(ROOT_FOLDER_KEY);
}