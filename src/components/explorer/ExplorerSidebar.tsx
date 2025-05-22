import React, { useState } from "react";
import { Folder, File, ChevronRight, ChevronDown, Settings } from "lucide-react";
import { FolderItem, ExplorerItem } from "./ExplorerTypes";
import { useTranslation } from "react-i18next";

// Mock data for demonstration purposes

const mockData: FolderItem[] = [
  {
    id: "folder-1",
    name: "3D Prints",
    type: "folder",
    expanded: true,
    items: [
      {
        id: "file-1",
        name: "Benchy.stl",
        type: "file",
        size: "4.8 MB",
        modifiedDate: "2023-05-10",
        fileType: "STL"
      },
      {
        id: "file-2",
        name: "Calibration_Cube.stl",
        type: "file",
        size: "1.2 MB",
        modifiedDate: "2023-05-12",
        fileType: "STL"
      }
    ]
  },
  {
    id: "folder-2",
    name: "Character Models",
    type: "folder",
    expanded: false,
    items: [
      {
        id: "file-3",
        name: "Dragon.obj",
        type: "file",
        size: "15.6 MB",
        modifiedDate: "2023-04-22",
        fileType: "OBJ"
      },
      {
        id: "folder-3",
        name: "DnD Minis",
        type: "folder",
        items: [
          {
            id: "file-4",
            name: "Wizard.stl",
            type: "file",
            size: "8.3 MB",
            modifiedDate: "2023-03-15",
            fileType: "STL"
          },
          {
            id: "file-5",
            name: "Rogue.stl",
            type: "file",
            size: "7.9 MB",
            modifiedDate: "2023-03-15",
            fileType: "STL"
          }
        ]
      }
    ]
  }
];

interface ExplorerSidebarProps {
  onSelectItem: (item: ExplorerItem) => void;
  onSettingsClick?: () => void;
}

export default function ExplorerSidebar({ onSelectItem, onSettingsClick }: ExplorerSidebarProps) {
  const { t } = useTranslation();
  const [folders, setFolders] = useState<FolderItem[]>(mockData);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  const toggleFolder = (folderId: string) => {
    setFolders(prevFolders => 
      prevFolders.map(folder => {
        if (folder.id === folderId) {
          return { ...folder, expanded: !folder.expanded };
        } else if (folder.type === 'folder') {
          return {
            ...folder,
            items: toggleFolderInItems(folder.items, folderId)
          };
        }
        return folder;
      })
    );
  };

  const toggleFolderInItems = (items: ExplorerItem[], folderId: string): ExplorerItem[] => {
    return items.map(item => {
      if (item.type === 'folder') {
        if (item.id === folderId) {
          return { ...item, expanded: !item.expanded };
        } else {
          return {
            ...item,
            items: toggleFolderInItems(item.items, folderId)
          };
        }
      }
      return item;
    });
  };

  const handleItemClick = (item: ExplorerItem) => {
    setSelectedItemId(item.id);
    onSelectItem(item);
  };

  const renderItems = (items: ExplorerItem[], level = 0) => {
    return items.map(item => {
      const paddingLeft = `${level * 16 + 8}px`;
      
      if (item.type === 'folder') {
        return (
          <div key={item.id}>
            <div 
              className={`flex items-center py-1 px-2 hover:bg-muted/50 cursor-pointer ${selectedItemId === item.id ? 'bg-muted text-accent-foreground' : ''}`}
              style={{ paddingLeft }}
              onClick={() => {
                toggleFolder(item.id);
                handleItemClick(item);
              }}
            >
              {item.expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <Folder size={16} className="ml-1 mr-2 text-blue-500" />
              <span className="text-sm">{item.name}</span>
            </div>
            {item.expanded && renderItems(item.items, level + 1)}
          </div>
        );
      } else {
        return (
          <div 
            key={item.id}
            className={`flex items-center py-1 px-2 hover:bg-muted/50 cursor-pointer ${selectedItemId === item.id ? 'bg-muted text-accent-foreground' : ''}`}
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
    <div className="flex flex-col h-full">
      <div className="flex-grow overflow-auto">
        {renderItems(folders)}
      </div>
      <div className="border-t border-border p-2">
        <div
          className="flex items-center py-2 px-2 rounded hover:bg-muted/50 cursor-pointer"
          onClick={onSettingsClick}
        >
          <Settings size={16} className="mr-2 text-gray-500" />
          <span className="text-sm">{t("titleSettingsPage")}</span>
        </div>
      </div>
    </div>
  );
}