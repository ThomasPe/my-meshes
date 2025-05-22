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
        className="border-r border-border bg-card overflow-auto"
        style={{ width, transition: isDragging ? 'none' : 'width 0.1s ease' }}
      >
        {sidebar}
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
      <div className="flex-1 overflow-auto p-4">
        {children}
      </div>
    </div>
  );
}