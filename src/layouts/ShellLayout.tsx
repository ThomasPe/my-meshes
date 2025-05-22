import React, { ReactNode, useState, useRef, useCallback, useEffect } from "react";
import * as ScrollArea from "@radix-ui/react-scroll-area";

interface ShellLayoutProps {
  children: ReactNode;
  sidebar: ReactNode;
  sidebarWidth?: string;
}

// Storage key for saving sidebar width preferences
const SIDEBAR_WIDTH_STORAGE_KEY = 'app-sidebar-width';

export default function ShellLayout({
  children,
  sidebar,
  sidebarWidth = "250px"
}: ShellLayoutProps) {
  // Initialize width from localStorage if available, otherwise use the prop value
  const [width, setWidth] = useState(() => {
    try {
      const savedWidth = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
      return savedWidth || sidebarWidth;
    } catch (e) {
      return sidebarWidth;
    }
  });
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Save width to localStorage when it changes
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, width);
    } catch (e) {
      // Ignore localStorage errors
    }
  }, [width]);
  
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
      
      // Change cursor for the entire document during drag
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none'; // Prevent text selection during resize
    } else {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', stopResize);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDragging, handleMouseMove, stopResize]);
  
  return (
    <div className="flex h-full" ref={containerRef}>
      {/* Sidebar (Master View) */}
      <div 
        className="border-r border-border bg-card"
        style={{ width, transition: isDragging ? 'none' : 'width 0.1s ease' }}
      >
        <ScrollArea.Root type="hover" scrollHideDelay={400}>
          <ScrollArea.Viewport className="h-full w-full">
            {sidebar}
          </ScrollArea.Viewport>
          <ScrollArea.Scrollbar 
            className="flex select-none touch-none p-0.5 transition-colors duration-150 ease-out hover:bg-muted/10" 
            orientation="vertical"
          >
            <ScrollArea.Thumb className="relative flex-1 rounded-full bg-muted-foreground/30 before:absolute before:left-1/2 before:top-1/2 before:h-full before:min-h-[44px] before:w-full before:min-w-[44px] before:-translate-x-1/2 before:-translate-y-1/2 before:content-[''] hover:bg-muted-foreground/50" />
          </ScrollArea.Scrollbar>
        </ScrollArea.Root>
      </div>
      
      {/* Resize Handle */}
      <div 
        className="relative w-1 cursor-col-resize flex items-center justify-center"
        onMouseDown={startResize}
      >
        <div className={`absolute h-full w-1 ${isDragging ? 'bg-primary' : 'hover:bg-border'}`}></div>
        
        {/* Visual indicator for resize handle */}
        <div className={`absolute h-8 w-4 rounded-sm flex items-center justify-center ${isDragging ? 'bg-primary' : 'hover:bg-muted'}`}>
          <div className="w-[2px] h-4 bg-border mx-[1px]"></div>
        </div>
      </div>
      
      {/* Main Content (Detail View) */}
      <div className="flex-1 p-4">
        <ScrollArea.Root type="hover" scrollHideDelay={400}>
          <ScrollArea.Viewport className="h-full w-full">
            {children}
          </ScrollArea.Viewport>
          <ScrollArea.Scrollbar 
            className="flex select-none touch-none p-0.5 transition-colors duration-150 ease-out hover:bg-muted/10" 
            orientation="vertical"
          >
            <ScrollArea.Thumb className="relative flex-1 rounded-full bg-muted-foreground/30 before:absolute before:left-1/2 before:top-1/2 before:h-full before:min-h-[44px] before:w-full before:min-w-[44px] before:-translate-x-1/2 before:-translate-y-1/2 before:content-[''] hover:bg-muted-foreground/50" />
          </ScrollArea.Scrollbar>
          <ScrollArea.Scrollbar 
            className="flex select-none touch-none p-0.5 transition-colors duration-150 ease-out hover:bg-muted/10" 
            orientation="horizontal"
          >
            <ScrollArea.Thumb className="relative flex-1 rounded-full bg-muted-foreground/30 before:absolute before:left-1/2 before:top-1/2 before:h-full before:min-h-[44px] before:w-full before:min-w-[44px] before:-translate-x-1/2 before:-translate-y-1/2 before:content-[''] hover:bg-muted-foreground/50" />
          </ScrollArea.Scrollbar>
          <ScrollArea.Corner className="bg-muted" />
        </ScrollArea.Root>
      </div>
    </div>
  );
}