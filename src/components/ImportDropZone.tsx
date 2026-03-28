import { useState, useCallback, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Package } from 'lucide-react';

interface ImportDropZoneProps {
  onFilesDropped: (filePaths: string[]) => void;
  children: React.ReactNode;
}

export default function ImportDropZone({
  onFilesDropped,
  children,
}: ImportDropZoneProps): React.JSX.Element {
  const { t } = useTranslation();
  const [isDragOver, setIsDragOver] = useState(false);
  let dragCounter = 0;

  const handleDragEnter = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter++;
      if (e.dataTransfer.types.includes('Files')) {
        setIsDragOver(true);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const handleDragLeave = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter--;
      if (dragCounter === 0) {
        setIsDragOver(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      dragCounter = 0;

      const files = e.dataTransfer.files;
      if (files.length === 0) return;

      const paths: string[] = [];
      for (let i = 0; i < files.length; i++) {
        // Electron extends File with a .path property
        paths.push((files[i] as File & { path: string }).path);
      }

      onFilesDropped(paths);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onFilesDropped],
  );

  return (
    <div
      className="relative h-full"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      data-testid="import-drop-zone"
    >
      {children}
      {isDragOver && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
          data-testid="import-drop-overlay"
        >
          <div className="flex flex-col items-center gap-3 rounded-lg border-2 border-dashed border-primary p-12">
            <Package className="h-12 w-12 text-primary" />
            <p className="text-lg font-medium text-primary">{t('import.dropHere')}</p>
            <p className="text-sm text-muted-foreground">{t('import.dropHint')}</p>
          </div>
        </div>
      )}
    </div>
  );
}
