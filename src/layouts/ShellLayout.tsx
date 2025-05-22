import React, { ReactNode, useState } from "react";
import DragWindowRegion from "@/components/DragWindowRegion";
import NavigationMenu from "@/components/template/NavigationMenu";

interface ShellLayoutProps {
  children: ReactNode;
  sidebar: ReactNode;
  sidebarWidth?: string;
}

export default function ShellLayout({
  children,
  sidebar,
  sidebarWidth = "250px"
}: ShellLayoutProps) {
  return (
    <>
      <DragWindowRegion title="My Meshes" />
      <NavigationMenu />
      <div className="flex h-screen pt-12">
        {/* Sidebar (Master View) */}
        <div 
          className="border-r border-border bg-card overflow-auto"
          style={{ width: sidebarWidth }}
        >
          {sidebar}
        </div>
        
        {/* Main Content (Detail View) */}
        <div className="flex-1 overflow-auto p-4">
          {children}
        </div>
      </div>
    </>
  );
}