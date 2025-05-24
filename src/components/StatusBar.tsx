import { useEffect, useState, useRef } from 'react';
import { LogMessage } from '@/helpers/ipc/logs/logs-context';
import { ChevronUp, ChevronDown, XCircle, AlertCircle, CheckCircle, Info } from 'lucide-react';
import React from 'react';

// Maximum height of the expanded status bar (1/3 of the window height)
const MAX_EXPANDED_HEIGHT = window.innerHeight / 3;

export default function StatusBar() {
  const [logs, setLogs] = useState<LogMessage[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedHeight, setExpandedHeight] = useState(200);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartY = useRef<number | null>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);

  // Load initial logs
  useEffect(() => {
    async function fetchLogs() {
      const allLogs = await window.logs.getAll();
      setLogs(allLogs);
    }
    fetchLogs();

    // Subscribe to new logs
    const unsubscribe = window.logs.onNewLog((newLog) => {
      setLogs(prevLogs => [...prevLogs, newLog]);
      
      // Auto-scroll to bottom if container exists and user is at the bottom
      if (logContainerRef.current) {
        const container = logContainerRef.current;
        const isAtBottom = container.scrollHeight - container.clientHeight <= container.scrollTop + 50;
        
        if (isAtBottom) {
          setTimeout(() => {
            container.scrollTop = container.scrollHeight;
          }, 10);
        }
      }
    });

    return unsubscribe;
  }, []);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      // Update max height based on window size
      const maxHeight = window.innerHeight / 3;
      setExpandedHeight(prev => Math.min(prev, maxHeight));
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Get the most recent log for the collapsed view
  const latestLog = logs.length > 0 ? logs[logs.length - 1] : null;

  // Handle mouse events for resizing
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    dragStartY.current = e.clientY;
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging && dragStartY.current !== null) {
        const deltaY = dragStartY.current - e.clientY;
        const newHeight = Math.min(Math.max(100, expandedHeight + deltaY), MAX_EXPANDED_HEIGHT);
        setExpandedHeight(newHeight);
        dragStartY.current = e.clientY;
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      dragStartY.current = null;
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDragging, expandedHeight]);

  // Clear all logs
  const handleClearLogs = async () => {
    await window.logs.clear();
    setLogs([]);
  };

  // Render icon based on log type
  const getLogTypeIcon = (type: string) => {
    switch (type) {
      case 'error':
        return <XCircle className="w-4 h-4 text-destructive" />;
      case 'warning':
        return <AlertCircle className="w-4 h-4 text-warning" />;
      case 'success':
        return <CheckCircle className="w-4 h-4 text-success" />;
      case 'info':
      default:
        return <Info className="w-4 h-4 text-muted-foreground" />;
    }
  };

  // Format timestamp to readable format
  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString();
  };

  return (
    <div
      className={`fixed left-0 right-0 bottom-0 border-t border-border bg-card transition-height duration-150 ease-in-out ${
        isExpanded ? 'shadow-lg' : ''
      }`}
      style={{ 
        height: isExpanded ? `${expandedHeight}px` : '34px',
        transition: isDragging ? 'none' : 'height 0.2s ease'
      }}
    >
      {/* Resize handle - only shown when expanded */}
      {isExpanded && (
        <div
          className="absolute top-0 left-0 right-0 h-1 cursor-row-resize flex justify-center items-center"
          onMouseDown={handleMouseDown}
        >
          <div className={`h-1 w-20 ${isDragging ? 'bg-primary' : 'hover:bg-border'} rounded-b`}></div>
        </div>
      )}

      {/* Header - always visible */}
      <div className="flex items-center justify-between px-4 h-8 border-b border-border bg-muted">
        <div className="flex items-center space-x-2">
          <span className="text-xs font-medium">Status</span>
          <span className="text-xs text-muted-foreground">{logs.length} messages</span>
        </div>
        <div className="flex items-center space-x-2">
          {isExpanded && (
            <button 
              onClick={handleClearLogs}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          )}
          <button 
            onClick={() => setIsExpanded(!isExpanded)} 
            className="p-1 hover:bg-background rounded"
          >
            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Collapsed view - show only latest message */}
      {!isExpanded && latestLog && (
        <div className="flex items-center px-4 h-6 text-xs overflow-hidden">
          <div className="flex items-center space-x-2 overflow-hidden">
            {getLogTypeIcon(latestLog.type)}
            <span className="text-muted-foreground">{formatTimestamp(latestLog.timestamp)}</span>
            <span className="truncate">{latestLog.message}</span>
          </div>
        </div>
      )}

      {/* Expanded view - scrollable log list */}
      {isExpanded && (
        <div 
          ref={logContainerRef}
          className="px-2 py-1 overflow-y-auto" 
          style={{ height: 'calc(100% - 32px)' }}
        >
          {logs.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <span className="text-sm text-muted-foreground">No logs</span>
            </div>
          ) : (
            logs.map(log => (
              <div key={log.id} className="flex items-start py-1 px-2 text-xs hover:bg-muted rounded">
                <div className="flex-shrink-0 pt-0.5 mr-2">
                  {getLogTypeIcon(log.type)}
                </div>
                <div className="flex-grow">
                  <div className="flex items-center space-x-2">
                    <span className="text-muted-foreground">{formatTimestamp(log.timestamp)}</span>
                    <span>{log.message}</span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}