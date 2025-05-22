import React, { useState, useEffect } from "react";
import {
  Folder,
  File,
  ChevronRight,
  ChevronDown,
  Settings,
  FolderPlus,
} from "lucide-react";
import { FolderItem, ExplorerItem } from "./ExplorerTypes";
import { useTranslation } from "react-i18next";
import * as ScrollArea from "@radix-ui/react-scroll-area";

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

  // Handle root folder selection
  const handleSelectRootFolder = async () => {
    try {
      const selectedDir = await window.filesystem.selectDirectory();
      if (selectedDir) {
        setRootFolder(selectedDir);

        // Create root folder item from the selected directory path
        const pathParts = selectedDir.split(/[/\\]/);
        const rootName = pathParts[pathParts.length - 1] || selectedDir;

        // Load folder contents
        const contents = await window.filesystem.readDirectory(selectedDir);

        const rootItem: FolderItem = {
          id: "root",
          name: rootName,
          type: "folder",
          expanded: true,
          items: contents as ExplorerItem[],
          path: selectedDir,
        };

        setFolders([rootItem]);

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
              const item = updatedItems[i];

              if (
                item.type === "folder" &&
                item.expanded &&
                item.items.length === 0 &&
                item.path
              ) {
                try {
                  const contents = await window.filesystem.readSubdirectory(
                    item.path,
                  );
                  updatedItems[i] = {
                    ...item,
                    items: contents as ExplorerItem[],
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
          };

          const processFolder = async (
            folder: FolderItem,
          ): Promise<FolderItem> => {
            if (folder.expanded && folder.items.length === 0 && folder.path) {
              try {
                const contents = await window.filesystem.readSubdirectory(
                  folder.path,
                );
                return {
                  ...folder,
                  items: contents as ExplorerItem[],
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
  };

  const renderItems = (items: ExplorerItem[], level = 0) => {
    return items.map((item) => {
      const paddingLeft = `${level * 16 + 8}px`;

      if (item.type === "folder") {
        return (
          <div key={item.id}>
            <div
              className={`hover:bg-muted/50 flex cursor-pointer items-center px-2 py-1 ${selectedItemId === item.id ? "bg-muted text-accent-foreground" : ""}`}
              style={{ paddingLeft }}
              onClick={() => {
                toggleFolder(item.id, item.path);
                handleItemClick(item);
              }}
            >
              {item.expanded ? (
                <ChevronDown size={16} />
              ) : (
                <ChevronRight size={16} />
              )}
              <Folder size={16} className="mr-2 ml-1 text-blue-500" />
              <span className="text-sm">{item.name}</span>
            </div>
            {item.expanded && renderItems(item.items, level + 1)}
          </div>
        );
      } else {
        return (
          <div
            key={item.id}
            className={`hover:bg-muted/50 flex cursor-pointer items-center px-2 py-1 ${selectedItemId === item.id ? "bg-muted text-accent-foreground" : ""}`}
            style={{ paddingLeft }}
            onClick={() => handleItemClick(item)}
          >
            <div className="ml-6"></div>
            <File size={16} className="mr-2 text-gray-500" />
            <span className="text-sm">{item.name}</span>
          </div>
        );
      }
    });
  };

  return (
    <div className="flex h-full flex-col">
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
      <div className="flex-grow">
        <ScrollArea.Root type="hover" scrollHideDelay={400}>
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
            className="flex select-none touch-none p-0.5 transition-colors duration-150 ease-out hover:bg-muted/10" 
            orientation="vertical"
          >
            <ScrollArea.Thumb className="relative flex-1 rounded-full bg-muted-foreground/30 before:absolute before:left-1/2 before:top-1/2 before:h-full before:min-h-[44px] before:w-full before:min-w-[44px] before:-translate-x-1/2 before:-translate-y-1/2 before:content-[''] hover:bg-muted-foreground/50" />
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
    </div>
  );
}
