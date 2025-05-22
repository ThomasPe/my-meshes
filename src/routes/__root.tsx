import React from "react";
import { Outlet, createRootRoute } from "@tanstack/react-router";
import DragWindowRegion from "@/components/DragWindowRegion";

export const RootRoute = createRootRoute({
  component: Root,
});

function Root() {
  return (
    <div className="h-screen flex flex-col">
      <DragWindowRegion title="My Meshes" />
      <div className="flex-1 overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}
