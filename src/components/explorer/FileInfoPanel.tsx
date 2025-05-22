import React from "react";
import { FileItem } from "./ExplorerTypes";
import { Info, Calendar, HardDrive } from "lucide-react";
import { useTranslation } from "react-i18next";
import * as ScrollArea from "@radix-ui/react-scroll-area";

interface FileInfoPanelProps {
  fileItem: FileItem | null;
}

export default function FileInfoPanel({ fileItem }: FileInfoPanelProps) {
  const { t } = useTranslation();
  
  if (!fileItem) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="text-center">
          <Info className="mx-auto h-10 w-10 opacity-20" />
          <p className="mt-2">{t("explorer.noFileSelected")}</p>
        </div>
      </div>
    );
  }
  
  return (
    <ScrollArea.Root className="h-full w-full">
      <ScrollArea.Viewport className="h-full w-full">
        <div className="p-4 space-y-4">
          <h2 className="text-xl font-bold">{fileItem.name}</h2>
          
          <div className="rounded-lg border border-border p-4">
            <h3 className="mb-3 text-lg font-medium">{t("explorer.fileInfo")}</h3>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Info className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">{t("explorer.type")}: {fileItem.fileType}</span>
              </div>
              <div className="flex items-center gap-2">
                <HardDrive className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">{t("explorer.size")}: {fileItem.size}</span>
              </div>
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">{t("explorer.modified")}: {fileItem.modifiedDate}</span>
              </div>
            </div>
          </div>
          
          <div className="rounded-lg border border-border p-4">
            <h3 className="mb-3 text-lg font-medium">{t("explorer.preview")}</h3>
            <div className="flex h-64 items-center justify-center bg-muted/30 rounded-md">
              <p className="text-muted-foreground">{t("explorer.previewPlaceholder")}</p>
            </div>
          </div>
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
}