import React, { useState, useEffect } from "react";
import {
  ChevronRight,
  ChevronDown,
  Settings,
  FolderPlus,
  Folder,
} from "lucide-react";
import { FolderItem, ExplorerItem } from "./ExplorerTypes";
import { useTranslation } from "react-i18next";
import { saveRootFolder, getRootFolder } from "@/helpers/folder_helpers";
import * as ScrollArea from "@radix-ui/react-scroll-area";
import StatusBar from "@/components/StatusBar";

interface ExplorerSidebarProps {
  onSelectItem: (item: ExplorerItem) => void;
  onSettingsClick?: () => void;
}

export default function ExplorerSidebar({
  onSelectItem,
  onSettingsClick,
}: ExplorerSidebarProps) {
  const { t } = useTranslation();
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [rootFolder, setRootFolder] = useState<string | null>(null);
  // Helper function to load folder contents one level deep
  const loadFolderContentsOneLevel = async (folders: FolderItem[]): Promise<FolderItem[]> => {
    const loadedFolders = await Promise.all(
      folders.map(async (folder) => {
        if (folder.path && folder.items.length === 0) {
          try {
            const contents = await window.filesystem.readSubdirectory(folder.path);
            return {
              ...folder,
              items: contents as ExplorerItem[],
              _contentsLoaded: true,
            };
          } catch (error) {
            console.error(`Error loading contents for folder ${folder.name}:`, error);
            return {
              ...folder,
              _contentsLoaded: true, // Mark as loaded even if failed, to prevent repeated attempts
            };
          }
        }
        return folder;
      })
    );
    return loadedFolders;
  };

  // Handle root folder selection
  const handleSelectRootFolder = async () => {
    try {
      const selectedDir = await window.filesystem.selectDirectory();
      if (selectedDir) {
        setRootFolder(selectedDir);
        // Save the selected root folder for next app launch
        saveRootFolder(selectedDir);

        // Create root folder item from the selected directory path
        const pathParts = selectedDir.split(/[/\\]/);
        const rootName = pathParts[pathParts.length - 1] || selectedDir;        // Load folder contents
        const contents = await window.filesystem.readDirectory(selectedDir);        const rootItem: FolderItem = {
          id: "root",
          name: rootName,
          type: "folder",
          expanded: true,
          items: contents as ExplorerItem[],
          path: selectedDir,
        };

        // Instead of showing the root folder, show its children
        const childFolders = rootItem.items.filter(item => item.type === "folder") as FolderItem[];
        
        // Load contents of all child folders one level deep
        const loadedChildFolders = await loadFolderContentsOneLevel(childFolders);
        setFolders(loadedChildFolders);

        // Select the root folder
        setSelectedItemId("root");
        onSelectItem(rootItem);
      }
    } catch (error) {
      console.error("Error selecting root folder:", error);
    }
  };

  const toggleFolderInItems = (
    items: ExplorerItem[],
    folderId: string,
    folderPath?: string,
  ): ExplorerItem[] => {
    return items.map((item) => {
      if (item.type === "folder") {
        if (item.id === folderId) {
          return { ...item, expanded: !item.expanded };
        } else {
          return {
            ...item,
            items: toggleFolderInItems(item.items, folderId, folderPath),
          };
        }
      }
      return item;
    });
  };

  // State to track when a folder is toggled
  const [expandedFolder, setExpandedFolder] = useState<string | null>(null);

  // Function to toggle folder expanded state and trigger the loading effect
  const toggleFolder = async (folderId: string, folderPath?: string) => {
    // Set the expanded folder ID to trigger the effect
    setExpandedFolder(folderId);

    setFolders((prevFolders) =>
      prevFolders.map((folder) => {
        if (folder.id === folderId) {
          // If we're expanding a folder that doesn't have items loaded yet
          if (!folder.expanded && folder.items.length === 0 && folderPath) {
            // We'll load the items later in the useEffect
            return { ...folder, expanded: !folder.expanded };
          }
          return { ...folder, expanded: !folder.expanded };
        } else if (folder.type === "folder") {
          return {
            ...folder,
            items: toggleFolderInItems(folder.items, folderId, folderPath),
          };
        }
        return folder;
      }),
    );
  };

  // Load saved root folder on component mount
  useEffect(() => {
    const loadSavedRootFolder = async () => {
      try {
        const savedRootFolder = getRootFolder();
        if (savedRootFolder) {
          setRootFolder(savedRootFolder);

          // Check if the folder still exists and is accessible
          try {
            // Create root folder item from the saved directory path
            const pathParts = savedRootFolder.split(/[/\\]/);
            const rootName = pathParts[pathParts.length - 1] || savedRootFolder;            // Load folder contents
            const contents = await window.filesystem.readDirectory(savedRootFolder);            const rootItem: FolderItem = {
              id: "root",
              name: rootName,
              type: "folder",
              expanded: true,
              items: contents as ExplorerItem[],
              path: savedRootFolder,
            };            // Instead of showing the root folder, show its children
            const childFolders = rootItem.items.filter(item => item.type === "folder") as FolderItem[];
            
            // Load contents of all child folders one level deep
            const loadedChildFolders = await loadFolderContentsOneLevel(childFolders);
            setFolders(loadedChildFolders);

            // Select the root folder
            setSelectedItemId("root");
            onSelectItem(rootItem);
          } catch (error) {
            console.error("Error loading saved root folder:", error);
            // If there's an error (e.g., folder was deleted or moved), remove it from storage
            localStorage.removeItem("rootFolder");
          }
        }
      } catch (error) {
        console.error("Error in loadSavedRootFolder:", error);
      }
    };

    loadSavedRootFolder();
  }, [onSelectItem]);

  // Load subdirectory contents when a folder is expanded
  useEffect(() => {
    if (!expandedFolder) return;

    const loadFolderContents = async () => {
      try {
        // Find folders that are expanded but have empty items
        setFolders((prevFolders) => {
          const updateFolders = async (
            items: ExplorerItem[],
          ): Promise<ExplorerItem[]> => {
            const updatedItems = [...items];

            for (let i = 0; i < updatedItems.length; i++) {
              const item = updatedItems[i];              if (
                item.type === "folder" &&
                item.expanded &&
                item.items.length === 0 &&
                item.path
              ) {
                try {                  const contents = await window.filesystem.readSubdirectory(
                    item.path,
                  );
                    // Load contents of child folders one level deep
                  const childFolders = contents.filter((child: ExplorerItem) => child.type === "folder") as FolderItem[];
                  const loadedChildFolders = await loadFolderContentsOneLevel(childFolders);
                  const otherItems = contents.filter((child: ExplorerItem) => child.type !== "folder");
                  
                  updatedItems[i] = {
                    ...item,
                    items: [...loadedChildFolders, ...otherItems] as ExplorerItem[],
                    _contentsLoaded: true, // Mark as loaded
                  };
                } catch (error) {
                  console.error(
                    `Error loading contents for folder ${item.name}:`,
                    error,
                  );
                }
              } else if (item.type === "folder" && item.items.length > 0) {
                updatedItems[i] = {
                  ...item,
                  items: await updateFolders(item.items),
                };
              }
            }

            return updatedItems;
          };          const processFolder = async (
            folder: FolderItem,
          ): Promise<FolderItem> => {
            if (folder.expanded && folder.items.length === 0 && folder.path) {
              try {                const contents = await window.filesystem.readSubdirectory(
                  folder.path,
                );
                  // Load contents of child folders one level deep
                const childFolders = contents.filter((item: ExplorerItem) => item.type === "folder") as FolderItem[];
                const loadedChildFolders = await loadFolderContentsOneLevel(childFolders);
                const otherItems = contents.filter((item: ExplorerItem) => item.type !== "folder");
                
                return {
                  ...folder,
                  items: [...loadedChildFolders, ...otherItems] as ExplorerItem[],
                  _contentsLoaded: true, // Mark as loaded
                };
              } catch (error) {
                console.error(
                  `Error loading contents for folder ${folder.name}:`,
                  error,
                );
                return folder;
              }
            } else {
              return {
                ...folder,
                items: await updateFolders(folder.items),
              };
            }
          };

          const updateRootFolders = async (): Promise<FolderItem[]> => {
            const updatedFolders = [...prevFolders];

            for (let i = 0; i < updatedFolders.length; i++) {
              updatedFolders[i] = await processFolder(updatedFolders[i]);
            }

            return updatedFolders;
          };

          // This will execute the updates
          updateRootFolders().then((updatedFolders) => {
            setFolders(updatedFolders);
          });

          return prevFolders; // Return unchanged for now, the async update will happen later
        });
      } catch (error) {
        console.error("Error loading folder contents:", error);
      }
    };

    loadFolderContents();
  }, [expandedFolder]);

  const handleItemClick = (item: ExplorerItem) => {
    setSelectedItemId(item.id);
    onSelectItem(item);
  };  const renderItems = (items: ExplorerItem[], level = 0) => {
    return items.map((item) => {
      // Only render folders
      if (item.type === "folder") {
        const paddingLeft = `${level * 16 + 8}px`;
          // Show chevron logic:
        // - If contents not loaded yet: show chevron (we don't know if there are child folders)
        // - If contents loaded: only show chevron if there are actual child folders
        const hasChildFolders = !item._contentsLoaded || item.items.some(child => child.type === "folder");
        
        return (
          <div key={item.id}>
            <div
              className={`hover:bg-muted/50 flex cursor-pointer items-center px-2 py-1 ${selectedItemId === item.id ? "bg-muted text-accent-foreground" : ""}`}
              style={{ paddingLeft }}              onClick={() => {
                // If folder is not expanded, expand it; otherwise toggle as before
                if (!item.expanded) {
                  // Force expand the folder on first click
                  const updatedItem = { ...item, expanded: true };
                  setFolders((prevFolders) =>
                    prevFolders.map((folder) => {
                      if (folder.id === item.id) {
                        return { ...folder, expanded: true };
                      } else if (folder.type === "folder") {
                        return {
                          ...folder,
                          items: toggleFolderInItems(folder.items, item.id, item.path),
                        };
                      }
                      return folder;
                    })
                  );
                  // Trigger loading of folder contents if needed
                  if (item.items.length === 0) {
                    setExpandedFolder(item.id);
                  }
                  handleItemClick(updatedItem);
                } else {
                  toggleFolder(item.id, item.path);
                  handleItemClick(item);
                }
              }}
            >              {/* Show chevron only if folder has or might have child folders */}
              {hasChildFolders ? (
                item.expanded ? (
                  <ChevronDown size={16} />
                ) : (
                  <ChevronRight size={16} />
                )
              ) : (
                <div className="w-4" />
              )}
              
              {/* Folder icon */}
              <Folder size={16} className="mx-2 text-blue-500 flex-shrink-0" />
              
              <span className="text-sm whitespace-nowrap overflow-hidden text-ellipsis">
                {item.name}
              </span>
            </div>
            {item.expanded && renderItems(item.items, level + 1)}
          </div>
        );
      }
      return null; // Skip file items
    }).filter(Boolean); // Remove null entries
  };

  return (
    <div className="grid grid-cols-1 grid-rows-[auto_1fr_auto_auto] h-full">
      <div className="border-border border-b p-2">
        <div
          className="hover:bg-muted/50 flex cursor-pointer items-center rounded px-2 py-2"
          onClick={handleSelectRootFolder}
        >
          <FolderPlus size={16} className="mr-2 text-blue-500" />
          <span className="text-sm">
            {rootFolder
              ? t("explorer.changeRootFolder")
              : t("explorer.selectRootFolder")}
          </span>
        </div>
      </div>
      <div className="overflow-hidden">
        <ScrollArea.Root className="h-full w-full flex-grow" scrollHideDelay={400}>
          <ScrollArea.Viewport className="h-full w-full">
            {folders.length > 0 ? (
              renderItems(folders)
            ) : (
              <div className="text-muted-foreground flex h-full items-center justify-center">
                <span className="text-sm">{t("explorer.noRootFolder")}</span>
              </div>
            )}
          </ScrollArea.Viewport>
          <ScrollArea.Scrollbar
            className="flex w-2 touch-none select-none bg-muted/10 p-0.5 transition-colors duration-150 hover:bg-muted/20"
            orientation="vertical"
          >
            <ScrollArea.Thumb className="relative flex-1 rounded-full bg-border" />
          </ScrollArea.Scrollbar>
        </ScrollArea.Root>
      </div>
      <div className="border-border border-t p-2">
        <div
          className="hover:bg-muted/50 flex cursor-pointer items-center rounded px-2 py-2"
          onClick={onSettingsClick}
        >
          <Settings size={16} className="mr-2 text-gray-500" />
          <span className="text-sm">{t("titleSettingsPage")}</span>
        </div>
      </div>
      <StatusBar />
    </div>
  );
}
