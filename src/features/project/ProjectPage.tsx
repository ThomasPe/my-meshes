import { ChevronLeft, CloudOff, FolderOpen, Pencil, Star, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useProjectActions } from '@/features/library/useProjectActions';
import { FilesTable } from '@/features/project/FilesTable';
import { ImageGallery } from '@/features/project/ImageGallery';
import { MetadataForm } from '@/features/project/MetadataForm';
import { Viewer } from '@/features/project/Viewer';
import { formatBytes, initials } from '@/lib/format';
import { useProject, useRoots } from '@/lib/queries';
import { navigate, routeHref } from '@/lib/router';
import type { ProjectSummary } from '@/lib/types';
import { cn } from '@/lib/utils';

export function ProjectPage({ id }: { id: string }) {
  const { t, i18n } = useTranslation();
  const project = useProject(id);
  const roots = useRoots();
  const { actions, dialogs } = useProjectActions({ onRenamed: (_old, newId) => navigate({ page: 'project', id: newId }), onDeleted: () => navigate({ page: 'library' }) });
  if (project.isPending) return <div className="p-6 text-sm text-muted-foreground">{t('common.loading')}</div>;
  if (project.isError || !project.data) return <div className="p-6"><p className="text-sm text-destructive">{t('errors.not_found')}</p><Button asChild variant="outline" className="mt-3"><a href={routeHref({ page: 'library' })}>{t('project.back')}</a></Button></div>;
  const p = project.data;
  const root = roots.data?.find((r) => r.id === p.root_id);
  const summary: ProjectSummary = { id: p.id, root_id: p.root_id, rel_path: p.rel_path, title: p.title, creator: p.creator, tags: p.tags, thumbnail: p.thumbnail, file_count: p.files.length, model_count: p.model_count, total_bytes: p.total_bytes, modified: p.modified, has_sidecar: p.sidecar.state === 'ok', offline: p.offline, favorite: p.favorite, added: p.added, thumb: p.thumb, slicer: p.slicer };
  return (
    <div className="h-full overflow-auto" data-testid="project-page">
      {dialogs}
      <div className="mx-auto grid max-w-[1200px] gap-5 px-6 pb-10 pt-5">
        <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <a href={routeHref({ page: 'library' })} className="inline-flex items-center gap-1 hover:text-primary" data-testid="back"><ChevronLeft className="size-4" />{t('project.back')}</a>
          {root && <><span>/</span><span>{root.path}</span></>}
          {p.rel_path.split('/').filter(Boolean).map((seg, i) => <span key={i} className="contents"><span>/</span><span>{seg}</span></span>)}
        </div>
        <div className="flex flex-wrap items-start gap-3.5">
          <div className="grid min-w-[200px] flex-1 gap-1">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-extrabold tracking-tight" data-testid="project-title">{p.title}</h1>
              <Button size="icon-sm" variant="ghost" aria-pressed={p.favorite} aria-label={p.favorite ? t('favorites.remove') : t('favorites.add')} title={p.favorite ? t('favorites.remove') : t('favorites.add')} data-testid="project-favorite" onClick={() => actions.toggleFavorite(summary)} className={cn(p.favorite && 'text-warning')}><Star className={cn(p.favorite && 'fill-current')} /></Button>
            </div>
            <div className="flex flex-wrap items-center gap-2.5 text-[13px] font-semibold text-muted-foreground">
              {p.creator ? <><span className="grid size-5 place-items-center rounded-full bg-accent text-[9px] font-extrabold text-accent-foreground">{initials(p.creator)}</span>{p.creator}</> : t('library.unknownCreator')}
              <span>·</span><span>{t('library.files', { count: p.files.length })} · {formatBytes(p.total_bytes, i18n.language)}</span>
              {p.slicer && <Badge variant="accent" data-testid="slicer-badge">{p.slicer}</Badge>}
              {p.offline && <Badge variant="outline"><CloudOff />{t('library.offline')}</Badge>}
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" disabled={p.offline} onClick={() => actions.reveal(summary)}><FolderOpen />{t('inspector.reveal')}</Button>
            <Button variant="outline" disabled={p.offline || p.rel_path === ''} onClick={() => actions.rename(summary)} data-testid="project-rename"><Pencil />{t('actions.rename')}</Button>
            <Button variant="outline" disabled={p.offline || p.rel_path === ''} onClick={() => actions.remove(summary)} data-testid="project-delete" className="text-destructive hover:text-destructive"><Trash2 />{t('actions.delete')}</Button>
          </div>
        </div>
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">{t('project.overview')}</TabsTrigger>
            <TabsTrigger value="files">{t('project.files')} <span className="text-muted-foreground">{p.files.length}</span></TabsTrigger>
            {p.files.some((f) => f.kind === 'image') && <TabsTrigger value="images" data-testid="tab-images">{t('project.images')} <span className="text-muted-foreground">{p.files.filter((f) => f.kind === 'image').length}</span></TabsTrigger>}
          </TabsList>
          <TabsContent value="overview" className="mt-4">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(300px,1fr)]">
              <Viewer project={p} files={p.files} offline={p.offline} />
              <div className="rounded-2xl bg-card p-5 shadow-card"><MetadataForm project={p} onReload={() => void project.refetch()} /></div>
            </div>
          </TabsContent>
          <TabsContent value="files" className="mt-4"><FilesTable projectId={p.id} files={p.files} offline={p.offline} /></TabsContent>
          <TabsContent value="images" className="mt-4"><ImageGallery project={p} files={p.files} offline={p.offline} /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
