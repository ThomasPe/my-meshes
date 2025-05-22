import React from "react";
import { Outlet, createRootRoute } from "@tanstack/react-router";
import DragWindowRegion from "@/components/DragWindowRegion";

export const RootRoute = createRootRoute({
  component: Root,
});

function Root() {
  return (
    <div>
      <DragWindowRegion title="My Meshes" />
      <div className="pt-12">
        <Outlet />
      </div>
    </div>
  );
}
