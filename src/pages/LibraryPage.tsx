import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '../components/ui/button';
import { FolderOpen, Trash2, RefreshCw, Eye, PanelLeft, PackagePlus } from 'lucide-react';
import FolderTree from '../components/FolderTree';
import ProjectGrid from '../components/ProjectGrid';
import ProjectDetail from '../components/ProjectDetail';
import SearchBar from '../components/SearchBar';
import ImportDropZone from '../components/ImportDropZone';
import ImportStagingDialog from '../components/ImportStagingDialog';

type LibraryRoot = Awaited<ReturnType<typeof window.electronApi.listLibraryRoots>>[number];
type Project = Awaited<ReturnType<typeof window.electronApi.getProjects>>[number];

export default function LibraryPage(): React.JSX.Element {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [selectedProjectId, setSelectedProjectId] = useState<number | undefined>();
  const [selectedFolderPath, setSelectedFolderPath] = useState<string | undefined>();
  const [searchQuery, setSearchQuery] = useState('');
  const [showSidebar, setShowSidebar] = useState(true);
  const [showDetail, setShowDetail] = useState(false);
  const [importFiles, setImportFiles] = useState<string[] | undefined>();

  const { data: roots = [] } = useQuery<LibraryRoot[]>({
    queryKey: ['library-roots'],
    queryFn: () => window.electronApi.listLibraryRoots(),
    refetchOnMount: 'always',
  });

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ['projects', searchQuery],
    queryFn: () =>
      searchQuery
        ? window.electronApi.searchProjects(searchQuery)
        : window.electronApi.getProjects(),
    refetchOnMount: 'always',
  });

  // Filter projects by selected folder
  const filteredProjects = selectedFolderPath
    ? projects.filter((p) =>
        p.path.replace(/\\/g, '/').startsWith(selectedFolderPath.replace(/\\/g, '/')),
      )
    : projects;

  const selectedProject = filteredProjects.find((p) => p.id === selectedProjectId);

  // Listen for watcher changes to refetch
  useEffect(() => {
    const unsubscribe = window.electronApi.onWatcherChange(() => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    });
    return unsubscribe;
  }, [queryClient]);

  const addRootMutation = useMutation({
    mutationFn: () => window.electronApi.addLibraryRoot(),
    onSuccess: (root) => {
      if (root) {
        queryClient.invalidateQueries({ queryKey: ['library-roots'] });
      }
    },
  });

  const removeRootMutation = useMutation({
    mutationFn: (id: number) => window.electronApi.removeLibraryRoot(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['library-roots'] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });

  const scanMutation = useMutation({
    mutationFn: (rootId: number) => window.electronApi.scanLibraryRoot(rootId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['library-roots'] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });

  const handleProjectSelect = useCallback((project: { id: number }) => {
    setSelectedProjectId(project.id);
    setShowDetail(true);
  }, []);

  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  const handleFilesDropped = useCallback((filePaths: string[]) => {
    if (filePaths.length > 0) {
      setImportFiles(filePaths);
    }
  }, []);

  const handleImportViaButton = useCallback(async () => {
    const filePaths = await window.electronApi.importSelectFiles();
    if (filePaths.length > 0) {
      setImportFiles(filePaths);
    }
  }, []);

  const handleImportComplete = useCallback(() => {
    setImportFiles(undefined);
    // Re-scan all roots to pick up imported files
    for (const root of roots) {
      scanMutation.mutate(root.id);
    }
  }, [roots, scanMutation]);

  const handleImportCancel = useCallback(() => {
    setImportFiles(undefined);
  }, []);

  return (
    <ImportDropZone onFilesDropped={handleFilesDropped}>
      <div className="flex h-full flex-col" data-testid="library-page">
        {/* Toolbar */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowSidebar(!showSidebar)}
            data-testid="toggle-sidebar"
          >
            <PanelLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <SearchBar onSearch={handleSearch} />
          </div>
          {roots.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleImportViaButton}
              data-testid="import-button"
            >
              <PackagePlus className="mr-2 h-4 w-4" />
              {t('import.button')}
            </Button>
          )}
          <Button onClick={() => addRootMutation.mutate()} size="sm" data-testid="add-root-button">
            <FolderOpen className="mr-2 h-4 w-4" />
            {t('library.addRoot')}
          </Button>
        </div>

      {roots.length === 0 ? (
        <div className="flex h-full items-center justify-center">
          <div className="text-center">
            <p className="mb-4 text-muted-foreground" data-testid="library-empty">
              {t('library.empty')}
            </p>
            <Button onClick={() => addRootMutation.mutate()} data-testid="add-root-empty">
              <FolderOpen className="mr-2 h-4 w-4" />
              {t('library.addRoot')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          {/* Folder Tree Sidebar */}
          {showSidebar && (
            <div
              className="w-56 shrink-0 overflow-auto border-r border-border"
              data-testid="sidebar"
            >
              <div className="p-2">
                <h2 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                  {t('library.roots')}
                </h2>
                {roots.map((root) => (
                  <div
                    key={root.id}
                    className="mb-1 flex items-center gap-1 text-xs"
                    data-testid={`library-root-${root.id}`}
                  >
                    <span
                      className={`flex-1 truncate ${!root.is_online ? 'text-destructive' : ''}`}
                    >
                      {root.label ?? root.path}
                    </span>
                    <button
                      className="rounded p-0.5 hover:bg-accent"
                      onClick={() => scanMutation.mutate(root.id)}
                      data-testid={`scan-root-${root.id}`}
                    >
                      <RefreshCw className="h-3 w-3" />
                    </button>
                    <button
                      className="rounded p-0.5 hover:bg-accent"
                      onClick={() => removeRootMutation.mutate(root.id)}
                      data-testid={`remove-root-${root.id}`}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="border-t border-border">
                <FolderTree
                  roots={roots}
                  projects={projects}
                  selectedPath={selectedFolderPath}
                  onSelect={setSelectedFolderPath}
                />
              </div>
            </div>
          )}

          {/* Main Content: Grid */}
          <div className="flex-1 overflow-auto p-2" data-testid="library-roots">
            <ProjectGrid
              projects={filteredProjects}
              onSelect={handleProjectSelect}
              selectedId={selectedProjectId}
            />
          </div>

          {/* Detail Sidebar */}
          {showDetail && selectedProject && (
            <div className="w-64 shrink-0 border-l border-border" data-testid="detail-panel">
              <div className="flex items-center justify-between border-b border-border px-2 py-1">
                <span className="text-xs font-semibold">{t('detail.title')}</span>
                <button
                  className="rounded p-0.5 hover:bg-accent"
                  onClick={() => setShowDetail(false)}
                >
                  <Eye className="h-3 w-3" />
                </button>
              </div>
              <ProjectDetail project={selectedProject} />
            </div>
          )}
        </div>
      )}

      {/* Import Staging Dialog */}
      {importFiles && roots.length > 0 && (
        <ImportStagingDialog
          filePaths={importFiles}
          targetRootPath={roots[0].path}
          onImportComplete={handleImportComplete}
          onCancel={handleImportCancel}
        />
      )}
    </div>
    </ImportDropZone>
  );
}
