// Explorer type definitions
export interface FileItem {
  id: string;
  name: string;
  type: "file";
  size: string;
  modifiedDate: string;
  fileType: string;
}

export interface FolderItem {
  id: string;
  name: string;
  type: "folder";
  items: (FileItem | FolderItem)[];
  expanded?: boolean;
}

export type ExplorerItem = FileItem | FolderItem;