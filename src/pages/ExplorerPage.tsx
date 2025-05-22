import React, { useState } from "react";
import ShellLayout from "@/layouts/ShellLayout";
import ExplorerSidebar from "@/components/explorer/ExplorerSidebar";
import DetailView from "@/components/explorer/DetailView";
import { ExplorerItem, FileItem } from "@/components/explorer/ExplorerTypes";
import SettingsPage from "./SettingsPage";
import FileInfoPanel from "@/components/explorer/FileInfoPanel";

export default function ExplorerPage() {
  const [selectedItem, setSelectedItem] = useState<ExplorerItem | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  // Track the selected file separately for the info panel
  const [selectedFileForInfoPanel, setSelectedFileForInfoPanel] = useState<FileItem | null>(null);

  const handleItemSelect = (item: ExplorerItem) => {
    setSelectedItem(item);
    
    // If the selected item is a file, update the file for info panel
    if (item.type === "file") {
      setSelectedFileForInfoPanel(item as FileItem);
    } else {
      // If it's a folder, don't clear the selected file yet
      // This will be handled by DetailView component when necessary
    }
    
    setShowSettings(false);
  };

  const handleSettingsClick = () => {
    setShowSettings(true);
    setSelectedItem(null);
    setSelectedFileForInfoPanel(null);
  };

  // Handler for when a file is selected within the DetailView
  const handleFileSelect = (file: FileItem | null) => {
    setSelectedFileForInfoPanel(file);
  };

  return (
    <ShellLayout 
      sidebar={
        <ExplorerSidebar 
          onSelectItem={handleItemSelect} 
          onSettingsClick={handleSettingsClick} 
        />
      }
      infoPanel={selectedFileForInfoPanel && <FileInfoPanel fileItem={selectedFileForInfoPanel} />}
    >
      {showSettings ? (
        <SettingsPage />
      ) : (
        <div className="h-full">
          <DetailView 
            selectedItem={selectedItem}
            onFileSelect={handleFileSelect}
          />
        </div>
      )}
    </ShellLayout>
  );
}