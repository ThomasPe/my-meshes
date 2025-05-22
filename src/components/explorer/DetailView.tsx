import React, { useState } from "react";
import { Info, Calendar, HardDrive } from "lucide-react";
import { FileItem, FolderItem, ExplorerItem } from "./ExplorerTypes";
import { useTranslation } from "react-i18next";
import * as ScrollArea from "@radix-ui/react-scroll-area";
import FileInfoPanel from "./FileInfoPanel";

interface DetailViewProps {
  selectedItem: ExplorerItem | null;
}

export default function DetailView({ selectedItem }: DetailViewProps) {
  const { t } = useTranslation();
  const [selectedFileItem, setSelectedFileItem] = useState<FileItem | null>(null);
  
  // If the selectedItem changes to a file, update the selectedFileItem
  React.useEffect(() => {
    if (selectedItem && selectedItem.type === "file") {
      setSelectedFileItem(selectedItem as FileItem);
    } else {
      setSelectedFileItem(null);
    }
  }, [selectedItem]);
  
  const renderContent = () => {
    if (!selectedItem) {
      return (
        <div className="flex h-full items-center justify-center text-muted-foreground">
          <div className="text-center">
            <Info className="mx-auto h-16 w-16 opacity-20" />
            <p className="mt-2">{t("explorer.selectItem")}</p>
          </div>
        </div>
      );
    }

    if (selectedItem.type === "folder") {
      const folderItem = selectedItem as FolderItem;
      const fileCount = countFiles(folderItem);
      const folderCount = countFolders(folderItem);
      
      return (
        <ScrollArea.Root className="h-full w-full">
          <ScrollArea.Viewport className="h-full w-full">
            <div className="space-y-4">
              <h2 className="text-2xl font-bold">{folderItem.name}</h2>
              <div className="rounded-lg border border-border p-4">
                <h3 className="mb-3 text-lg font-medium">{t("explorer.folderInfo")}</h3>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <HardDrive className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      {t("explorer.contains")} {fileCount} {fileCount !== 1 
                        ? t("explorer.files") 
                        : t("explorer.file")
                      } {t("explorer.and")} {folderCount} {folderCount !== 1 
                        ? t("explorer.folders") 
                        : t("explorer.folder")
                      }
                    </span>
                  </div>
                </div>
              </div>
              
              {folderItem.items.length > 0 && (
                <div className="rounded-lg border border-border p-4">
                  <h3 className="mb-3 text-lg font-medium">{t("explorer.contents")}</h3>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
                    {folderItem.items.map(item => (
                      <div 
                        key={item.id} 
                        className={`rounded-md border border-border p-2 ${
                          item.type === 'file' && selectedFileItem?.id === item.id ? 'bg-muted' : ''
                        } ${
                          item.type === 'file' ? 'cursor-pointer hover:bg-muted/50' : ''
                        }`}
                        onClick={() => {
                          if (item.type === 'file') {
                            setSelectedFileItem(item as FileItem);
                          }
                        }}
                      >
                        {item.type === "folder" ? (
                          <span className="flex items-center gap-2">
                            <HardDrive className="h-4 w-4" />
                            {item.name}
                          </span>
                        ) : (
                          <span className="flex items-center gap-2">
                            <Info className="h-4 w-4" />
                            {item.name}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </ScrollArea.Viewport>
          <ScrollArea.Scrollbar 
            className="flex w-2 touch-none select-none bg-muted/10 p-0.5 transition-colors duration-150 hover:bg-muted/20" 
            orientation="vertical"
          >
            <ScrollArea.Thumb className="relative flex-1 rounded-full bg-border" />
          </ScrollArea.Scrollbar>
          <ScrollArea.Scrollbar 
            className="flex h-2 touch-none select-none bg-muted/10 p-0.5 transition-colors duration-150 hover:bg-muted/20" 
            orientation="horizontal"
          >
            <ScrollArea.Thumb className="relative flex-1 rounded-full bg-border" />
          </ScrollArea.Scrollbar>
          <ScrollArea.Corner className="bg-muted" />
        </ScrollArea.Root>
      );
    } else {
      // If the main selected item is a file, show an empty content area
      return (
        <div className="flex h-full items-center justify-center text-muted-foreground">
          <div className="text-center">
            <Info className="mx-auto h-16 w-16 opacity-20" />
            <p className="mt-2">{t("explorer.fileSelected")}</p>
          </div>
        </div>
      );
    }
  };

  // The file item to display in the info panel - either the selected file from folder view
  // or the main selected item if it's a file
  const fileToDisplay = selectedFileItem || 
    (selectedItem?.type === "file" ? selectedItem as FileItem : null);
  
  return (
    <>
      {renderContent()}
      {fileToDisplay && <FileInfoPanel fileItem={fileToDisplay} />}
    </>
  );
}

// Helper functions to count files and folders recursively
function countFiles(folder: FolderItem): number {
  return folder.items.reduce((count, item) => {
    if (item.type === "file") {
      return count + 1;
    } else {
      return count + countFiles(item as FolderItem);
    }
  }, 0);
}

function countFolders(folder: FolderItem): number {
  return folder.items.reduce((count, item) => {
    if (item.type === "folder") {
      return count + 1 + countFolders(item as FolderItem);
    } else {
      return count;
    }
  }, 0);
}