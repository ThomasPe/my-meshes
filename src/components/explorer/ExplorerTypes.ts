// Explorer type definitions
export interface FileItem {
  id: string;
  name: string;
  type: "file";
  size: string;
  modifiedDate: string;
  fileType: string;
  path?: string; // Path to the actual file
}

export interface FolderItem {
  id: string;
  name: string;
  type: "folder";
  items: (FileItem | FolderItem)[];
  expanded?: boolean;
  path?: string; // Path to the actual folder
}

export type ExplorerItem = FileItem | FolderItem;