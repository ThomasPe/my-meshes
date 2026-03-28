import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from './ui/button';
import {
  FileArchive,
  FileText,
  Box,
  X,
  Check,
  ChevronDown,
  ChevronRight,
  Pencil,
  AlertCircle,
} from 'lucide-react';

interface ArchiveEntry {
  path: string;
  name: string;
  size: number;
  isDirectory: boolean;
  isModelFile: boolean;
}

interface InspectedArchive {
  archivePath: string;
  archiveName: string;
  entries: ArchiveEntry[];
  modelFileCount: number;
  totalSize: number;
  suggestedProjectName: string;
}

interface StagingItem {
  archive: InspectedArchive;
  projectName: string;
  expanded: boolean;
  editing: boolean;
}

interface ImportStagingDialogProps {
  filePaths: string[];
  targetRootPath: string;
  onImportComplete: () => void;
  onCancel: () => void;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

export default function ImportStagingDialog({
  filePaths,
  targetRootPath,
  onImportComplete,
  onCancel,
}: ImportStagingDialogProps): React.JSX.Element {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [stagingItems, setStagingItems] = useState<StagingItem[]>([]);
  const [looseFiles, setLooseFiles] = useState<string[]>([]);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    const inspect = async () => {
      const archives: string[] = [];
      const loose: string[] = [];

      for (const fp of filePaths) {
        if (fp.toLowerCase().endsWith('.zip')) {
          archives.push(fp);
        } else {
          loose.push(fp);
        }
      }

      setLooseFiles(loose);

      if (archives.length > 0) {
        try {
          const results = await window.electronApi.importInspectArchives(archives);
          setStagingItems(
            results.map((archive: InspectedArchive) => ({
              archive,
              projectName: archive.suggestedProjectName,
              expanded: results.length === 1,
              editing: false,
            })),
          );
        } catch (err) {
          setError(String(err));
        }
      }

      setLoading(false);
    };

    inspect();
  }, [filePaths]);

  const handleImport = useCallback(async () => {
    setImporting(true);
    setError(undefined);

    try {
      // Extract archives
      if (stagingItems.length > 0) {
        const items = stagingItems.map((si) => ({
          archivePath: si.archive.archivePath,
          projectName: si.projectName,
        }));

        const results = await window.electronApi.importExtractArchives(items, targetRootPath);
        const failures = results.filter(
          (r: { success: boolean; error?: string; archivePath: string }) => !r.success,
        );
        if (failures.length > 0) {
          setError(
            failures
              .map(
                (f: { archivePath: string; error?: string }) =>
                  `${f.archivePath}: ${f.error}`,
              )
              .join('\n'),
          );
          setImporting(false);
          return;
        }
      }

      // Import loose files
      if (looseFiles.length > 0) {
        const result = await window.electronApi.importLooseFiles(looseFiles, targetRootPath);
        if (!result.success) {
          setError(result.error);
          setImporting(false);
          return;
        }
      }

      onImportComplete();
    } catch (err) {
      setError(String(err));
      setImporting(false);
    }
  }, [stagingItems, looseFiles, targetRootPath, onImportComplete]);

  const toggleExpand = useCallback((index: number) => {
    setStagingItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, expanded: !item.expanded } : item)),
    );
  }, []);

  const startEditing = useCallback((index: number) => {
    setStagingItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, editing: true } : item)),
    );
  }, []);

  const updateProjectName = useCallback((index: number, name: string) => {
    setStagingItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, projectName: name } : item)),
    );
  }, []);

  const finishEditing = useCallback((index: number) => {
    setStagingItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, editing: false } : item)),
    );
  }, []);

  const totalItems = stagingItems.length + (looseFiles.length > 0 ? 1 : 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      data-testid="import-staging-dialog"
    >
      <div className="mx-4 flex max-h-[80vh] w-full max-w-2xl flex-col rounded-lg border border-border bg-background shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">{t('import.stagingTitle')}</h2>
          <button onClick={onCancel} className="rounded p-1 hover:bg-accent" data-testid="import-cancel">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <p className="text-sm text-muted-foreground">{t('import.inspecting')}</p>
            </div>
          ) : (
            <>
              {/* Target root info */}
              <div className="mb-3 rounded bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                {t('import.targetRoot')}: <span className="font-medium text-foreground">{targetRootPath}</span>
              </div>

              {error && (
                <div className="mb-3 flex items-start gap-2 rounded border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive" data-testid="import-error">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* Archive items */}
              {stagingItems.map((item, index) => (
                <div
                  key={item.archive.archivePath}
                  className="mb-2 rounded border border-border"
                  data-testid={`staging-item-${index}`}
                >
                  <div className="flex items-center gap-2 px-3 py-2">
                    <button
                      onClick={() => toggleExpand(index)}
                      className="shrink-0"
                    >
                      {item.expanded ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </button>
                    <FileArchive className="h-4 w-4 shrink-0 text-amber-500" />
                    <div className="flex-1">
                      {item.editing ? (
                        <input
                          type="text"
                          value={item.projectName}
                          onChange={(e) => updateProjectName(index, e.target.value)}
                          onBlur={() => finishEditing(index)}
                          onKeyDown={(e) => e.key === 'Enter' && finishEditing(index)}
                          className="w-full rounded border border-input bg-background px-2 py-0.5 text-sm"
                          data-testid={`staging-name-input-${index}`}
                          autoFocus
                        />
                      ) : (
                        <div className="flex items-center gap-1">
                          <span className="text-sm font-medium" data-testid={`staging-name-${index}`}>
                            {item.projectName}
                          </span>
                          <button
                            onClick={() => startEditing(index)}
                            className="rounded p-0.5 hover:bg-accent"
                            data-testid={`staging-edit-${index}`}
                          >
                            <Pencil className="h-3 w-3 text-muted-foreground" />
                          </button>
                        </div>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {item.archive.archiveName} · {item.archive.modelFileCount}{' '}
                        {t('import.modelFiles')} · {formatSize(item.archive.totalSize)}
                      </span>
                    </div>
                  </div>

                  {item.expanded && (
                    <div className="border-t border-border px-3 py-2">
                      <div className="max-h-40 overflow-auto">
                        {item.archive.entries.map((entry) => (
                          <div
                            key={entry.path}
                            className="flex items-center gap-2 py-0.5 text-xs text-muted-foreground"
                          >
                            {entry.isModelFile ? (
                              <Box className="h-3 w-3 text-primary" />
                            ) : (
                              <FileText className="h-3 w-3" />
                            )}
                            <span className={entry.isModelFile ? 'text-foreground' : ''}>
                              {entry.path}
                            </span>
                            <span className="ml-auto">{formatSize(entry.size)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {/* Loose files */}
              {looseFiles.length > 0 && (
                <div
                  className="mb-2 rounded border border-border px-3 py-2"
                  data-testid="staging-loose-files"
                >
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">{t('import.looseFiles')}</p>
                      <p className="text-xs text-muted-foreground">
                        {looseFiles.length} {t('import.filesWillBeMovedToUnsorted')}
                      </p>
                    </div>
                  </div>
                  <div className="mt-1">
                    {looseFiles.map((fp) => (
                      <p key={fp} className="truncate text-xs text-muted-foreground">
                        {fp.split(/[/\\]/).pop()}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {totalItems === 0 && !error && (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  {t('import.noImportableFiles')}
                </p>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <Button variant="ghost" size="sm" onClick={onCancel} data-testid="import-cancel-btn">
            {t('confirm.cancel')}
          </Button>
          <Button
            size="sm"
            onClick={handleImport}
            disabled={loading || importing || totalItems === 0}
            data-testid="import-confirm-btn"
          >
            {importing ? (
              t('import.importing')
            ) : (
              <>
                <Check className="mr-1 h-3.5 w-3.5" />
                {t('import.importButton', { count: totalItems })}
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
