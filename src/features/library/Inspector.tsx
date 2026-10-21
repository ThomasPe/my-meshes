import { Check, CloudOff, ExternalLink, Eye, FileBox, FolderHeart, FolderOpen, ImageUp, Layers, Pencil, Plus, Scale, Star, StarOff, Trash2, X } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { ProjectActions } from '@/features/library/ProjectMenu';
import { TagEditor } from '@/features/library/TagEditor';
import { Thumb } from '@/features/library/Thumb';
import { reportError } from '@/lib/errors';
import { formatBytes, formatDate, initials } from '@/lib/format';
import { useBatchUpdate, useProject, useRoots, useUpdateMetadata } from '@/lib/queries';
import { navigate } from '@/lib/router';
import { useUi } from '@/lib/store';
import type { FacetCount, Facets, ProjectSummary, TagCount } from '@/lib/types';
import { cn } from '@/lib/utils';

interface Props {
  selectedIds: string[];
  visible: ProjectSummary[];
  tagCounts: TagCount[];
  facets: Facets | undefined;
  filterTitle: string;
  onTag: (tag: string) => void;
  actions: ProjectActions;
}

export function Inspector({ selectedIds, visible, tagCounts, facets, filterTitle, onTag, actions }: Props) {
  const { t, i18n } = useTranslation();
  const id = selectedIds.length === 1 ? selectedIds[0]! : null;
  const project = useProject(id);
  const roots = useRoots();
  const update = useUpdateMetadata();
  const ui = useUi();

  if (selectedIds.length === 0 || (selectedIds.length === 1 && !project.data)) {
    return (
      <ScrollArea className="h-full border-l border-border bg-panel" data-testid="inspector">
        <div className="p-5">
          <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{filterTitle}</div>
          <h2 className="mt-0.5 text-xl font-extrabold tracking-tight">{t('library.projects', { count: visible.length })}</h2>
          <div className="text-xs font-semibold text-muted-foreground">{t('library.inView', { size: formatBytes(visible.reduce((a, p) => a + p.total_bytes, 0), i18n.language) })}</div>
          <Section title={t('library.topTags')}>
            <div className="flex flex-wrap gap-1.5">{tagCounts.slice(0, 8).map((tc) => <button key={tc.tag} type="button" onClick={() => onTag(tc.tag)} className={cn('rounded-full bg-secondary px-2.5 py-0.5 text-xs font-semibold hover:bg-accent hover:text-accent-foreground', ui.tags.includes(tc.tag) && 'bg-accent text-accent-foreground')}>{tc.tag} <span className="text-muted-foreground">{tc.count}</span></button>)}</div>
          </Section>
          {(facets?.creators.length ?? 0) > 0 && (
            <Section title={t('library.creators')}>
              <div className="grid gap-1">{facets!.creators.slice(0, 5).map((c) => <button type="button" key={c.value} onClick={() => actions.filterByCreator(c.value)} title={t('library.filterByCreator', { creator: c.value })} className={cn('flex items-center gap-2.5 rounded-[10px] bg-background px-3 py-2 text-left text-[13px] font-semibold hover:bg-accent', ui.creator === c.value && 'bg-accent text-accent-foreground')} data-testid="inspector-creator"><span className="grid size-5 place-items-center rounded-full bg-accent text-[9px] font-extrabold text-accent-foreground">{initials(c.value)}</span><span className="truncate">{c.value}</span><span className="ml-auto text-muted-foreground tabular">{c.count}</span></button>)}</div>
            </Section>
          )}
          <FacetSection title={t('library.facetLicenses')} icon={<Scale className="size-3.5" />} items={facets?.licenses ?? []} active={ui.license} onPick={(v) => ui.setLicense(ui.license === v ? null : v)} testId="facet-license" />
          <FacetSection title={t('library.facetMaterials')} icon={<Layers className="size-3.5" />} items={facets?.materials ?? []} active={ui.material} onPick={(v) => ui.setMaterial(ui.material === v ? null : v)} testId="facet-material" />
          <FacetSection title={t('library.facetFileTypes')} icon={<FileBox className="size-3.5" />} items={facets?.file_types ?? []} active={ui.fileType} onPick={(v) => ui.setFileType(ui.fileType === v ? null : v)} testId="facet-filetype" upper />
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
          <p className="mt-3 text-xs text-muted-foreground">{t('inspector.multiHint')}</p>
          <BatchEditor selection={sel} />
          <div className="mt-3 grid gap-2" data-testid="multi-actions">
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button size="sm" variant="outline" data-testid="multi-add-collection"><FolderHeart />{t('inspector.addAllTo')}</Button></DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {actions.collections.map((c) => <DropdownMenuItem key={c.id} onSelect={() => actions.addManyToCollection(sel, c.id)} data-testid="multi-collection">{c.name}</DropdownMenuItem>)}
                {actions.collections.length > 0 && <DropdownMenuSeparator />}
                <DropdownMenuItem onSelect={() => actions.addManyToCollection(sel, null)}><Plus />{t('collections.new')}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {sel.every((p) => p.favorite)
              ? <Button size="sm" variant="outline" onClick={() => actions.setFavoriteMany(sel, false)} data-testid="multi-unfavorite"><StarOff />{t('inspector.unfavoriteAll')}</Button>
              : <Button size="sm" variant="outline" onClick={() => actions.setFavoriteMany(sel, true)} data-testid="multi-favorite"><Star />{t('inspector.favoriteAll')}</Button>}
            <Button size="sm" variant="destructive" onClick={() => actions.removeMany(sel)} data-testid="multi-delete"><Trash2 />{t('inspector.deleteSelected')}</Button>
          </div>
          <Section title={t('library.selected', { count: sel.length })}>
            <ul className="grid gap-1 text-[13px] font-semibold">{sel.slice(0, 12).map((p) => <li key={p.id} className="truncate rounded-[10px] bg-background px-3 py-1.5">{p.title}</li>)}{sel.length > 12 && <li className="px-3 text-muted-foreground">+{sel.length - 12}</li>}</ul>
          </Section>
        </div>
      </ScrollArea>
    );
  }

  const p = project.data!;
  const root = roots.data?.find((r) => r.id === p.root_id);
  const dirPath = root ? `${root.path}${p.rel_path ? (root.path.includes('\\') ? '\\' : '/') + p.rel_path.replace(/\//g, root.path.includes('\\') ? '\\' : '/') : ''}` : p.rel_path;
  const sidecarBadge = p.sidecar.state === 'ok' ? <Badge variant="success" className="max-w-full" title={t('inspector.sidecarOk')}><span className="truncate">{t('inspector.sidecarOk')}</span></Badge> : p.sidecar.state === 'malformed' ? <Badge variant="warning" className="max-w-full" title={p.sidecar.message}><span className="truncate">{t('inspector.sidecarMalformed')}</span></Badge> : <Badge variant="outline" className="max-w-full" title={t('inspector.sidecarMissing')}><span className="truncate">{t('inspector.sidecarMissing')}</span></Badge>;
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
          <Button size="icon-sm" variant="outline" disabled={p.offline} onClick={() => actions.rerenderThumbnail(summary)} title={t('actions.rerenderThumb')} aria-label={t('actions.rerenderThumb')} data-testid="inspector-rethumb"><ImageUp /></Button>
          <Button size="icon-sm" variant="outline" disabled={p.offline || p.rel_path === ''} onClick={() => actions.remove(summary)} title={t('actions.delete')} aria-label={t('actions.delete')} data-testid="inspector-delete" className="text-destructive hover:text-destructive"><Trash2 /></Button>
        </div>
        {p.offline && root && <p className="mb-3 rounded-[10px] bg-warning-soft p-3 text-xs font-semibold text-warning">{t('inspector.offlineHint', { path: root.path })}</p>}
        <dl className="grid grid-cols-[92px_minmax(0,1fr)] gap-x-3 gap-y-2 text-[13px]">
          <dt className="text-muted-foreground">{t('inspector.creator')}</dt><dd className="truncate font-semibold">{p.creator ?? <span className="text-muted-foreground">{t('library.unknownCreator')}</span>}</dd>
          <dt className="text-muted-foreground">{t('inspector.license')}</dt><dd className="truncate font-semibold">{p.license ?? <span className="text-muted-foreground">{t('inspector.notSet')}</span>}</dd>
          <dt className="text-muted-foreground">{t('inspector.source')}</dt><dd className="truncate font-semibold">{p.source_url ? <a className="inline-flex max-w-full items-center gap-1 text-primary hover:underline" href={p.source_url} target="_blank" rel="noreferrer" title={p.source_url}><span className="truncate">{p.source_url.replace(/^https?:\/\/(www\.)?/, '')}</span><ExternalLink className="size-3 shrink-0" /></a> : <span className="text-muted-foreground">{t('inspector.notSet')}</span>}</dd>
          <dt className="text-muted-foreground">{t('inspector.material')}</dt><dd className="truncate font-semibold">{p.material ?? <span className="text-muted-foreground">{t('project.any')}</span>}{p.supports_required != null && <span className="text-muted-foreground"> · {p.supports_required ? t('inspector.supports') : t('inspector.noSupports')}</span>}</dd>
          <dt className="text-muted-foreground">{t('inspector.modified')}</dt><dd className="font-semibold">{formatDate(p.modified, i18n.language)}</dd>
          <dt className="text-muted-foreground">{t('inspector.added')}</dt><dd className="font-semibold">{formatDate(p.added, i18n.language)}</dd>
          <dt className="text-muted-foreground">{t('inspector.sidecar')}</dt><dd className="min-w-0">{sidecarBadge}</dd>
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

/** META-6: tag and creator changes for every selected project, written by the engine in one call. */
function BatchEditor({ selection }: { selection: ProjectSummary[] }) {
  const { t } = useTranslation();
  const batch = useBatchUpdate();
  const [tag, setTag] = useState('');
  const [creator, setCreator] = useState('');
  const ids = selection.map((p) => p.id);
  const union = [...new Set(selection.flatMap((p) => p.tags))].sort();
  const editable = selection.some((p) => !p.offline);
  const run = (update: Parameters<typeof batch.mutate>[0]['update']) => batch.mutate({ ids, update }, {
    onSuccess: (r) => {
      if (r.updated) toast.success(t('inspector.batchDone', { count: r.updated }));
      if (r.failed.length) toast.warning(t('inspector.batchFailed', { count: r.failed.length }), { description: r.failed[0]!.message });
    },
    onError: reportError,
  });
  return (
    <div className="mt-3 grid gap-2 rounded-[10px] bg-background p-3" data-testid="batch-editor">
      <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{t('inspector.batchTags')}</div>
      <div className="flex flex-wrap gap-1.5">
        {union.map((tg) => <span key={tg} className="inline-flex items-center gap-1 rounded-full bg-secondary pl-2.5 pr-1 py-0.5 text-xs font-semibold" data-testid="batch-tag">{tg}<button type="button" aria-label={t('inspector.batchRemoveTag', { tag: tg })} title={t('inspector.batchRemoveTag', { tag: tg })} disabled={!editable || batch.isPending} className="rounded-full p-0.5 text-muted-foreground hover:text-destructive" onClick={() => run({ remove_tags: [tg] })}><X className="size-3" /></button></span>)}
        <Input value={tag} placeholder={t('inspector.batchAddTag')} disabled={!editable || batch.isPending} className="h-7 w-40 rounded-full text-xs" data-testid="batch-add-tag" onChange={(e) => setTag(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && tag.trim()) { run({ add_tags: [tag.trim()] }); setTag(''); } }} />
      </div>
      <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{t('inspector.batchCreator')}</div>
      <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); if (creator.trim()) { run({ creator: creator.trim() }); setCreator(''); } }}>
        <Input value={creator} placeholder={t('inspector.batchCreatorPlaceholder')} disabled={!editable || batch.isPending} className="h-7 text-xs" data-testid="batch-creator" onChange={(e) => setCreator(e.target.value)} />
        <Button type="submit" size="icon-sm" variant="outline" disabled={!editable || batch.isPending || !creator.trim()} aria-label={t('inspector.batchApply')} title={t('inspector.batchApply')} data-testid="batch-creator-apply"><Check /></Button>
      </form>
    </div>
  );
}

/** One attribute filter (NAV-5): chips with counts, the active one highlighted, long lists fold. */
function FacetSection({ title, icon, items, active, onPick, testId, upper }: { title: string; icon: React.ReactNode; items: FacetCount[]; active: string | null; onPick: (v: string) => void; testId: string; upper?: boolean }) {
  const { t } = useTranslation();
  const [more, setMore] = useState(false);
  if (items.length === 0) return null;
  const shown = more ? items : items.slice(0, 6);
  return (
    <Section title={title}>
      <div className="flex flex-wrap gap-1.5" data-testid={`${testId}s`}>
        {shown.map((f) => <button key={f.value} type="button" onClick={() => onPick(f.value)} aria-pressed={active === f.value} title={t('library.filterBy', { value: f.value })} data-testid={testId} className={cn('inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 text-xs font-semibold hover:bg-accent hover:text-accent-foreground', active === f.value && 'bg-accent text-accent-foreground')}>{icon}{upper ? f.value.toUpperCase() : f.value} <span className="text-muted-foreground">{f.count}</span></button>)}
        {items.length > 6 && <button type="button" className="px-1 text-xs font-semibold text-primary hover:underline" onClick={() => setMore((m) => !m)}>{more ? t('library.less') : t('library.more', { count: items.length - 6 })}</button>}
      </div>
    </Section>
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
