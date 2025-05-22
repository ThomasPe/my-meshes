import React, { useState } from "react";
import ShellLayout from "@/layouts/ShellLayout";
import ExplorerSidebar from "@/components/explorer/ExplorerSidebar";
import DetailView from "@/components/explorer/DetailView";
import { ExplorerItem } from "@/components/explorer/ExplorerTypes";
import SettingsPage from "./SettingsPage";

export default function ExplorerPage() {
  const [selectedItem, setSelectedItem] = useState<ExplorerItem | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const handleItemSelect = (item: ExplorerItem) => {
    setSelectedItem(item);
    setShowSettings(false);
  };

  const handleSettingsClick = () => {
    setShowSettings(true);
    setSelectedItem(null);
  };

  return (
    <ShellLayout 
      sidebar={
        <ExplorerSidebar 
          onSelectItem={handleItemSelect} 
          onSettingsClick={handleSettingsClick} 
        />
      }
    >
      {showSettings ? (
        <SettingsPage />
      ) : (
        <DetailView selectedItem={selectedItem} />
      )}
    </ShellLayout>
  );
}