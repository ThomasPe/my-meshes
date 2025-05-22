import React, { useState } from "react";
import ShellLayout from "@/layouts/ShellLayout";
import ExplorerSidebar from "@/components/explorer/ExplorerSidebar";
import DetailView from "@/components/explorer/DetailView";
import { ExplorerItem } from "@/components/explorer/ExplorerTypes";
import { useTranslation } from "react-i18next";

export default function ExplorerPage() {
  const { t } = useTranslation();
  const [selectedItem, setSelectedItem] = useState<ExplorerItem | null>(null);

  const handleItemSelect = (item: ExplorerItem) => {
    setSelectedItem(item);
  };

  return (
    <ShellLayout 
      sidebar={<ExplorerSidebar onSelectItem={handleItemSelect} />}
    >
      <DetailView selectedItem={selectedItem} />
    </ShellLayout>
  );
}