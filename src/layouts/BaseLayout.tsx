import React from "react";
import DragWindowRegion from "@/components/DragWindowRegion";
import NavigationMenu from "@/components/template/NavigationMenu";
import StatusBar from "@/components/StatusBar";

export default function BaseLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <DragWindowRegion title="My Meshes" />
      <NavigationMenu />
      <main className="h-screen pb-10 p-2">{children}</main>
      <StatusBar />
    </>
  );
}
