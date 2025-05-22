import React, { ReactNode, useState, useRef, useCallback, useEffect } from "react";

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
  const [width, setWidth] = useState(sidebarWidth);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Start resize when mouse down on the resize handle
  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);
  
  // Handle dragging
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging || !containerRef.current) return;
    
    const containerRect = containerRef.current.getBoundingClientRect();
    // Calculate width from left edge of container to current mouse position
    const newWidth = Math.max(100, Math.min(e.clientX - containerRect.left, containerRect.width * 0.8));
    
    setWidth(`${newWidth}px`);
  }, [isDragging]);
  
  // Stop resize when mouse is up
  const stopResize = useCallback(() => {
    setIsDragging(false);
  }, []);
  
  // Add and remove event listeners
  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', stopResize);
    }
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', stopResize);
    };
  }, [isDragging, handleMouseMove, stopResize]);
  
  return (
    <div className="flex h-full" ref={containerRef}>
      {/* Sidebar (Master View) */}
      <div 
        className="border-r border-border bg-card overflow-auto"
        style={{ width }}
      >
        {sidebar}
      </div>
      
      {/* Resize Handle */}
      <div 
        className="relative w-1 cursor-col-resize"
        onMouseDown={startResize}
      >
        <div className={`absolute h-full w-1 ${isDragging ? 'bg-primary' : 'hover:bg-border'}`}></div>
      </div>
      
      {/* Main Content (Detail View) */}
      <div className="flex-1 overflow-auto p-4">
        {children}
      </div>
    </div>
  );
}