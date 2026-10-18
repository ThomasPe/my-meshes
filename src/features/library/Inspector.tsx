import { CloudOff, ExternalLink, Eye, FolderOpen, Pencil, Star, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { ProjectActions } from '@/features/library/ProjectMenu';
import { TagEditor } from '@/features/library/TagEditor';
import { Thumb } from '@/features/library/Thumb';
import { reportError } from '@/lib/errors';
import { formatBytes, formatDate, initials } from '@/lib/format';
import { useProject, useRoots, useUpdateMetadata } from '@/lib/queries';
import { navigate } from '@/lib/router';
import type { ProjectSummary, TagCount } from '@/lib/types';
import { cn } from '@/lib/utils';

interface Props {
  selectedIds: string[];
  visible: ProjectSummary[];
  tagCounts: TagCount[];
  filterTitle: string;
  onTag: (tag: string) => void;
  actions: ProjectActions;
}

export function Inspector({ selectedIds, visible, tagCounts, filterTitle, onTag, actions }: Props) {
  const { t, i18n } = useTranslation();
  const id = selectedIds.length === 1 ? selectedIds[0]! : null;
  const project = useProject(id);
  const roots = useRoots();
  const update = useUpdateMetadata();

  if (selectedIds.length === 0 || (selectedIds.length === 1 && !project.data)) {
    const creators = Object.entries(visible.reduce<Record<string, number>>((m, p) => { if (p.creator) m[p.creator] = (m[p.creator] ?? 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 5);
    return (
      <ScrollArea className="h-full border-l border-border bg-panel" data-testid="inspector">
        <div className="p-5">
          <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{filterTitle}</div>
          <h2 className="mt-0.5 text-xl font-extrabold tracking-tight">{t('library.projects', { count: visible.length })}</h2>
          <div className="text-xs font-semibold text-muted-foreground">{t('library.inView', { size: formatBytes(visible.reduce((a, p) => a + p.total_bytes, 0), i18n.language) })}</div>
          <Section title={t('library.topTags')}>
            <div className="flex flex-wrap gap-1.5">{tagCounts.slice(0, 8).map((tc) => <button key={tc.tag} type="button" onClick={() => onTag(tc.tag)} className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-semibold hover:bg-accent hover:text-accent-foreground">{tc.tag} <span className="text-muted-foreground">{tc.count}</span></button>)}</div>
          </Section>
          {creators.length > 0 && (
            <Section title={t('library.creators')}>
              <div className="grid gap-1">{creators.map(([c, n]) => <div key={c} className="flex items-center gap-2.5 rounded-[10px] bg-background px-3 py-2 text-[13px] font-semibold"><span className="grid size-5 place-items-center rounded-full bg-accent text-[9px] font-extrabold text-accent-foreground">{initials(c)}</span><span className="truncate">{c}</span><span className="ml-auto text-muted-foreground tabular">{n}</span></div>)}</div>
            </Section>
          )}
          <p className="mt-4 rounded-[10px] bg-accent p-3 text-xs font-semibold text-accent-foreground">{t('library.hint')}</p>
        </div>
      </ScrollArea>
    );
  }

  if (selectedIds.length > 1) {
    const sel = visible.filter((p) => selectedIds.includes(p.id));
    return (
      <ScrollArea className="h-full border-l border-border bg-panel" data-testid="inspector">
        <div className="p-5">
          <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{t('library.selected', { count: sel.length })}</div>
          <h2 className="mt-0.5 text-xl font-extrabold tracking-tight">{t('library.projects', { count: sel.length })}</h2>
          <div className="text-xs font-semibold text-muted-foreground">{formatBytes(sel.reduce((a, p) => a + p.total_bytes, 0), i18n.language)} · {t('library.files', { count: sel.reduce((a, p) => a + p.file_count, 0) })}</div>
        </div>
      </ScrollArea>
    );
  }

  const p = project.data!;
  const root = roots.data?.find((r) => r.id === p.root_id);
  const dirPath = root ? `${root.path}${p.rel_path ? (root.path.includes('\\') ? '\\' : '/') + p.rel_path.replace(/\//g, root.path.includes('\\') ? '\\' : '/') : ''}` : p.rel_path;
  const sidecarBadge = p.sidecar.state === 'ok' ? <Badge variant="success">{t('inspector.sidecarOk')}</Badge> : p.sidecar.state === 'malformed' ? <Badge variant="warning" title={p.sidecar.message}>{t('inspector.sidecarMalformed')}</Badge> : <Badge variant="outline">{t('inspector.sidecarMissing')}</Badge>;
  const summary: ProjectSummary = { id: p.id, root_id: p.root_id, rel_path: p.rel_path, title: p.title, creator: p.creator, tags: p.tags, thumbnail: p.thumbnail, file_count: p.files.length, model_count: p.model_count, total_bytes: p.total_bytes, modified: p.modified, has_sidecar: p.sidecar.state === 'ok', offline: p.offline, favorite: p.favorite, added: p.added, thumb: p.thumb, slicer: p.slicer };

  const saveTags = (tags: string[]) => {
    update.mutate({ id: p.id, update: { tags, expected_stamp: p.sidecar_stamp ?? null } }, {
      onSuccess: (np) => toast.success(p.sidecar.state === 'missing' ? t('project.created') : t('project.saved'), { description: np.title }),
      onError: (e) => reportError(e),
    });
  };

  return (
    <ScrollArea className="h-full border-l border-border bg-panel" data-testid="inspector">
      <div className="p-5">
        <Thumb thumb={p.thumb} projectId={p.id} className="mb-3.5 aspect-[5/3] overflow-hidden rounded-[10px]">
          <span className="absolute right-2.5 top-2.5 flex gap-1">
            {p.offline && <Badge variant="outline"><CloudOff />{t('library.offline')}</Badge>}
            {p.slicer && <Badge variant="accent" title={p.slicer}>{t('library.slicerProject')}</Badge>}
          </span>
        </Thumb>
        <div className="flex items-start gap-2">
          <h2 className="min-w-0 flex-1 text-xl font-extrabold tracking-tight text-balance" data-testid="inspector-title">{p.title}</h2>
          <Button size="icon-sm" variant="ghost" aria-pressed={p.favorite} aria-label={p.favorite ? t('favorites.remove') : t('favorites.add')} title={p.favorite ? t('favorites.remove') : t('favorites.add')} data-testid="inspector-favorite" onClick={() => actions.toggleFavorite(summary)} className={cn(p.favorite && 'text-warning')}><Star className={cn(p.favorite && 'fill-current')} /></Button>
        </div>
        <div className="mb-3 break-all text-xs font-semibold text-muted-foreground">{dirPath}</div>
        <div className="mb-3 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => navigate({ page: 'project', id: p.id })} data-testid="inspector-open"><Eye />{t('inspector.open')}</Button>
          <Button size="sm" variant="outline" disabled={p.offline} onClick={() => actions.reveal(summary)} title={t('inspector.reveal')}><FolderOpen />{t('inspector.reveal')}</Button>
          <Button size="icon-sm" variant="outline" disabled={p.offline || p.rel_path === ''} onClick={() => actions.rename(summary)} title={t('actions.rename')} aria-label={t('actions.rename')} data-testid="inspector-rename"><Pencil /></Button>
          <Button size="icon-sm" variant="outline" disabled={p.offline || p.rel_path === ''} onClick={() => actions.remove(summary)} title={t('actions.delete')} aria-label={t('actions.delete')} data-testid="inspector-delete" className="text-destructive hover:text-destructive"><Trash2 /></Button>
        </div>
        {p.offline && root && <p className="mb-3 rounded-[10px] bg-warning-soft p-3 text-xs font-semibold text-warning">{t('inspector.offlineHint', { path: root.path })}</p>}
        <dl className="grid grid-cols-[92px_minmax(0,1fr)] gap-x-3 gap-y-2 text-[13px]">
          <dt className="text-muted-foreground">{t('inspector.creator')}</dt><dd className="truncate font-semibold">{p.creator ?? <span className="text-muted-foreground">{t('library.unknownCreator')}</span>}</dd>
          <dt className="text-muted-foreground">{t('inspector.license')}</dt><dd className="truncate font-semibold">{p.license ?? <span className="text-muted-foreground">{t('inspector.notSet')}</span>}</dd>
          <dt className="text-muted-foreground">{t('inspector.source')}</dt><dd className="truncate font-semibold">{p.source_url ? <a className="inline-flex items-center gap-1 text-primary hover:underline" href={p.source_url} target="_blank" rel="noreferrer">{p.source_url.replace(/^https?:\/\/(www\.)?/, '')}<ExternalLink className="size-3" /></a> : <span className="text-muted-foreground">{t('inspector.notSet')}</span>}</dd>
          <dt className="text-muted-foreground">{t('inspector.material')}</dt><dd className="truncate font-semibold">{p.material ?? <span className="text-muted-foreground">{t('project.any')}</span>}{p.supports_required != null && <span className="text-muted-foreground"> · {p.supports_required ? t('inspector.supports') : t('inspector.noSupports')}</span>}</dd>
          <dt className="text-muted-foreground">{t('inspector.modified')}</dt><dd className="font-semibold">{formatDate(p.modified, i18n.language)}</dd>
          <dt className="text-muted-foreground">{t('inspector.added')}</dt><dd className="font-semibold">{formatDate(p.added, i18n.language)}</dd>
          <dt className="text-muted-foreground">{t('inspector.sidecar')}</dt><dd>{sidecarBadge}</dd>
        </dl>
        <Section title={t('inspector.tags')}>
          <TagEditor tags={p.tags} onChange={saveTags} disabled={p.offline || update.isPending} />
        </Section>
        <Section title={`${t('inspector.files')} · ${p.files.length} · ${formatBytes(p.total_bytes, i18n.language)}`}>
          <div className="grid gap-1">
            {p.files.slice(0, 8).map((f) => (
              <div key={f.rel_path} className="flex items-center gap-2.5 rounded-[10px] bg-background px-3 py-1.5 text-[13px] font-semibold">
                <span className="w-8 font-mono text-[11px] uppercase text-primary">{f.name.split('.').pop()}</span>
                <span className="truncate">{f.name}</span>
                <span className="ml-auto whitespace-nowrap text-xs text-muted-foreground tabular">{f.kind === 'attachment' ? t('project.fileRole.attachment') : formatBytes(f.size, i18n.language)}</span>
              </div>
            ))}
            {p.files.length > 8 && <Button variant="ghost" size="sm" onClick={() => navigate({ page: 'project', id: p.id })}>+{p.files.length - 8}</Button>}
          </div>
        </Section>
        {p.warnings.length > 0 && <Section title={t('inspector.warnings')}><ul className="list-disc pl-4 text-xs text-warning">{p.warnings.map((w) => <li key={w}>{w}</li>)}</ul></Section>}
        {p.description && <Section title={t('project.description')}><p className="text-[13px] text-secondary-foreground">{p.description}</p></Section>}
      </div>
    </ScrollArea>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-4">
      <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}
