import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '../components/ui/button';
import { FolderOpen, Trash2, RefreshCw } from 'lucide-react';

type LibraryRoot = Awaited<ReturnType<typeof window.electronApi.listLibraryRoots>>[number];
type Project = Awaited<ReturnType<typeof window.electronApi.getProjects>>[number];

export default function LibraryPage(): React.JSX.Element {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const { data: roots = [] } = useQuery<LibraryRoot[]>({
    queryKey: ['library-roots'],
    queryFn: () => window.electronApi.listLibraryRoots(),
  });

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: () => window.electronApi.getProjects(),
  });

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

  return (
    <div className="flex h-full flex-col" data-testid="library-page">
      <div className="flex items-center justify-between border-b border-border p-4">
        <h1 className="text-2xl font-bold">{t('library.title')}</h1>
        <Button onClick={() => addRootMutation.mutate()} data-testid="add-root-button">
          <FolderOpen className="mr-2 h-4 w-4" />
          {t('library.addRoot')}
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {roots.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-muted-foreground" data-testid="library-empty">
              {t('library.empty')}
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="space-y-2" data-testid="library-roots">
              <h2 className="text-lg font-semibold">{t('library.roots')}</h2>
              {roots.map((root) => (
                <div
                  key={root.id}
                  className="flex items-center justify-between rounded-lg border border-border p-3"
                  data-testid={`library-root-${root.id}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{root.label ?? root.path}</p>
                    <p className="truncate text-xs text-muted-foreground">{root.path}</p>
                    {root.last_scan_at && (
                      <p className="text-xs text-muted-foreground">
                        {t('library.lastScan')}: {root.last_scan_at}
                      </p>
                    )}
                    {!root.is_online && (
                      <p className="text-xs text-destructive">{t('library.offline')}</p>
                    )}
                  </div>
                  <div className="ml-2 flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => scanMutation.mutate(root.id)}
                      data-testid={`scan-root-${root.id}`}
                    >
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeRootMutation.mutate(root.id)}
                      data-testid={`remove-root-${root.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            {projects.length > 0 && (
              <div className="space-y-2" data-testid="project-list">
                <h2 className="text-lg font-semibold">{t('library.projects')}</h2>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {projects.map((project) => (
                    <div
                      key={project.id}
                      className="rounded-lg border border-border p-3"
                      data-testid={`project-${project.id}`}
                    >
                      <p className="font-medium">{project.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{project.path}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
