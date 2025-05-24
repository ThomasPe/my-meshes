import React, { ReactNode, useState, useRef, useCallback, useEffect } from "react";

interface ShellLayoutProps {
  children: ReactNode;
  sidebar: ReactNode;
  infoPanel?: ReactNode;
  sidebarWidth?: string;
  infoPanelWidth?: string;
}

// Storage key for saving sidebar width preferences
const SIDEBAR_WIDTH_STORAGE_KEY = 'app-sidebar-width';
const INFO_PANEL_WIDTH_STORAGE_KEY = 'app-infopanel-width';

export default function ShellLayout({
  children,
  sidebar,
  infoPanel,
  sidebarWidth = "250px",
  infoPanelWidth = "350px"
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
  const [infoPanelWidthState, setInfoPanelWidthState] = useState(() => {
    try {
      const savedWidth = localStorage.getItem(INFO_PANEL_WIDTH_STORAGE_KEY);
      return savedWidth || infoPanelWidth;
    } catch (e) {
      return infoPanelWidth;
    }
  });
  const [isDragging, setIsDragging] = useState(false);
  const [isDraggingInfoPanel, setIsDraggingInfoPanel] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Save width to localStorage when it changes
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, width);
    } catch (e) {
      // Ignore localStorage errors
    }
  }, [width]);
  
  // Save info panel width to localStorage when it changes
  useEffect(() => {
    try {
      localStorage.setItem(INFO_PANEL_WIDTH_STORAGE_KEY, infoPanelWidthState);
    } catch (e) {
      // Ignore localStorage errors
    }
  }, [infoPanelWidthState]);
  
  // Start resize for the sidebar
  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);
  
  // Start resize for the info panel
  const startInfoPanelResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingInfoPanel(true);
  }, []);
  
  // Handle dragging for sidebar
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging || !containerRef.current) return;
    
    const containerRect = containerRef.current.getBoundingClientRect();
    // Calculate width from left edge of container to current mouse position
    const newWidth = Math.max(100, Math.min(e.clientX - containerRect.left, containerRect.width * 0.8));
    
    setWidth(`${newWidth}px`);
  }, [isDragging]);
  
  // Handle dragging for info panel
  const handleInfoPanelMouseMove = useCallback((e: MouseEvent) => {
    if (!isDraggingInfoPanel || !containerRef.current) return;
    
    const containerRect = containerRef.current.getBoundingClientRect();
    // Calculate width from right edge of container to current mouse position
    const newWidth = Math.max(200, Math.min(containerRect.right - e.clientX, containerRect.width * 0.5));
    
    setInfoPanelWidthState(`${newWidth}px`);
  }, [isDraggingInfoPanel]);
  
  // Stop resize when mouse is up
  const stopResize = useCallback(() => {
    setIsDragging(false);
    setIsDraggingInfoPanel(false);
  }, []);
  
  // Add and remove event listeners
  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', stopResize);
      
      // Change cursor for the entire document during drag
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none'; // Prevent text selection during resize
    } else if (isDraggingInfoPanel) {
      document.addEventListener('mousemove', handleInfoPanelMouseMove);
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
      document.removeEventListener('mousemove', handleInfoPanelMouseMove);
      document.removeEventListener('mouseup', stopResize);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDragging, isDraggingInfoPanel, handleMouseMove, handleInfoPanelMouseMove, stopResize]);
  
  return (
    <div className="flex h-full" ref={containerRef}>
      {/* Sidebar (Master View) */}
      <div 
        className="border-r border-border bg-card"
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
      <div className="flex flex-1 h-full overflow-hidden">
        <div className="flex-1 h-full overflow-hidden p-4">
          {children}
        </div>
        
        {/* Info Panel (only shown when infoPanel is provided) */}
        {infoPanel && (
          <>
            {/* Info Panel Resize Handle */}
            <div 
              className="relative w-1 cursor-col-resize flex items-center justify-center"
              onMouseDown={startInfoPanelResize}
            >
              <div className={`absolute h-full w-1 ${isDraggingInfoPanel ? 'bg-primary' : 'hover:bg-border'}`}></div>
              
              {/* Visual indicator for resize handle */}
              <div className={`absolute h-8 w-4 rounded-sm flex items-center justify-center ${isDraggingInfoPanel ? 'bg-primary' : 'hover:bg-muted'}`}>
                <div className="w-[2px] h-4 bg-border mx-[1px]"></div>
              </div>
            </div>
            
            {/* Info Panel */}
            <div 
              className="border-l border-border bg-card h-full overflow-hidden"
              style={{ width: infoPanelWidthState, transition: isDraggingInfoPanel ? 'none' : 'width 0.1s ease' }}
            >
              {infoPanel}
            </div>
          </>
        )}
      </div>
    </div>
  );
}