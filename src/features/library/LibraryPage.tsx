import { Search } from 'lucide-react';
import { useCallback, useMemo, useRef } from 'react';
import { Group, Panel, Separator, type Layout } from 'react-resizable-panels';
import { useTranslation } from 'react-i18next';
import type { ScanState } from '@/App';
import { Button } from '@/components/ui/button';
import { useImport } from '@/features/import/useImport';
import { CollectionDialogs, useCollectionDialog } from '@/features/library/CollectionDialogs';
import { InboxView } from '@/features/library/InboxView';
import { Inspector } from '@/features/library/Inspector';
import { ProjectGrid } from '@/features/library/ProjectGrid';
import { ProjectList } from '@/features/library/ProjectList';
import { Sidebar } from '@/features/library/Sidebar';
import { Toolbar } from '@/features/library/Toolbar';
import { useLibraryActions } from '@/features/library/useLibraryActions';
import { useProjectActions } from '@/features/library/useProjectActions';
import { reportError } from '@/lib/errors';
import { useAddToCollection, useCollections, useFacets, useProjects, useReorderCollection, useRoots, useSmartCollections, useSmartProjects, useTagCounts } from '@/lib/queries';
import { navigate } from '@/lib/router';
import { useUi } from '@/lib/store';
import type { ListQuery } from '@/lib/types';

const LAYOUT_KEY = 'mm.library.panels';
type PanelPx = { sidebar: number; inspector: number };
/** Sidebar widths are remembered in pixels, so a different window size keeps the same panels. */
function loadPanels(): Partial<PanelPx> {
  try { const l = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? 'null'); return l && typeof l === 'object' ? (l as Partial<PanelPx>) : {}; } catch { return {}; }
}
function savePanels(layout: Layout, groupWidth: number) {
  if (!groupWidth) return;
  const px = (k: string) => Math.round(((layout[k] ?? 0) / 100) * groupWidth);
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify({ sidebar: px('sidebar'), inspector: px('inspector') })); } catch { /* ignore */ }
}
const separatorClass = 'group relative w-1 shrink-0 bg-transparent transition-colors hover:bg-primary/40 data-[separator-active]:bg-primary/60 data-[resize-handle-active]:bg-primary/60';

export function LibraryPage({ scanning, onScanEnd }: { scanning: ScanState; onScanEnd: (rootId: string) => void }) {
  const { t } = useTranslation();
  const { filter, tags, text, creator, license, material, fileType, sort, view, tile, selected, select, toggleTag, clearFilters, setSort } = useUi();
  const roots = useRoots();
  const collections = useCollections();
  const smart = useSmartCollections();
  const { scan } = useLibraryActions(onScanEnd);
  const collectionId = filter.kind === 'collection' ? filter.id : null;
  const smartId = filter.kind === 'smart' ? filter.id : null;
  const { actions, dialogs } = useProjectActions({ collectionId });
  const reorder = useReorderCollection();
  const addTo = useAddToCollection();
  const openCollectionDialog = useCollectionDialog((s) => s.open);
  const pickImport = useImport((s) => s.pick);
  const groupRef = useRef<HTMLDivElement | null>(null);
  const panels = useMemo(loadPanels, []);

  const rootScoped = filter.kind === 'root' || filter.kind === 'folder' || filter.kind === 'inbox';
  const effectiveSort = filter.kind === 'recent' ? 'added' : filter.kind === 'collection' ? (sort === 'collection' || sort === 'modified' ? 'collection' : sort) : sort === 'collection' ? 'modified' : sort;
  const query = useMemo<ListQuery>(() => ({
    root_id: rootScoped ? filter.rootId : null,
    path_prefix: filter.kind === 'folder' ? filter.path : null,
    tags,
    text: text || null,
    favorites: filter.kind === 'favorites',
    collection_id: collectionId,
    creator,
    license,
    material,
    file_type: fileType,
    sort: effectiveSort,
    limit: filter.kind === 'recent' ? 200 : null,
  }), [filter, tags, text, creator, license, material, fileType, effectiveSort, rootScoped, collectionId]);
  const projects = useProjects(filter.kind === 'inbox' || smartId ? { ...query, limit: 0 } : query);
  const smartOverrides = useMemo<ListQuery>(() => ({ sort: sort === 'collection' ? 'modified' : sort, text: text || null }), [sort, text]);
  const smartProjects = useSmartProjects(smartId, smartOverrides);
  const tagCounts = useTagCounts(rootScoped ? filter.rootId : null);
  const facets = useFacets(rootScoped ? filter.rootId : null);
  const list = useMemo(() => (smartId ? smartProjects.data ?? [] : filter.kind === 'inbox' ? [] : projects.data ?? []), [smartId, smartProjects.data, filter.kind, projects.data]);
  const pending = smartId ? smartProjects.isPending : projects.isPending;
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const onSelect = useCallback((id: string, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) select(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
    else if (e.shiftKey && selected.length) {
      const ids = list.map((p) => p.id);
      const a = ids.indexOf(selected[selected.length - 1]!), b = ids.indexOf(id);
      select([...new Set([...selected, ...ids.slice(Math.min(a, b), Math.max(a, b) + 1)])]);
    } else select([id]);
  }, [select, selected, list]);
  const onOpen = useCallback((id: string) => navigate({ page: 'project', id }), []);

  const rootName = (id: string) => roots.data?.find((r) => r.id === id)?.path.split(/[\\/]/).filter(Boolean).pop() ?? '';
  const filterTitle =
    filter.kind === 'all' ? t('library.all')
    : filter.kind === 'recent' ? t('library.recent')
    : filter.kind === 'favorites' ? t('library.favorites')
    : filter.kind === 'folder' ? filter.path.split('/').pop()!
    : filter.kind === 'inbox' ? `${t('inbox.title')} · ${rootName(filter.rootId)}`
    : filter.kind === 'collection' ? collections.data?.find((c) => c.id === filter.id)?.name ?? ''
    : filter.kind === 'smart' ? smart.data?.find((c) => c.id === filter.id)?.name ?? ''
    : rootName(filter.rootId);
  const activeRoot = rootScoped ? filter.rootId : roots.data?.[0]?.id;
  const filtered = tags.length > 0 || !!text || !!creator || !!license || !!material || !!fileType;
  const single = selected.length === 1 ? list.find((p) => p.id === selected[0]) : undefined;
  const onKey = (e: React.KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.key === 'Escape' && selected.length) select([]);
    if (e.key === 'Delete' && single) { e.preventDefault(); actions.remove(single); }
    else if (e.key === 'Delete' && selected.length > 1) { e.preventDefault(); actions.removeMany(list.filter((p) => selected.includes(p.id))); }
    if (e.key === 'F2' && single) { e.preventDefault(); actions.rename(single); }
  };
  const saveSmart = () => openCollectionDialog({ kind: 'createSmart', query: { root_id: query.root_id, path_prefix: query.path_prefix, tags: query.tags, text: query.text, favorites: query.favorites, creator, license, material, file_type: fileType, sort: effectiveSort === 'collection' ? 'modified' : effectiveSort } });
  const onReorder = collectionId && effectiveSort === 'collection' ? (ids: string[]) => reorder.mutate({ id: collectionId, order: ids }, { onError: reportError }) : undefined;

  return (
    <Group orientation="horizontal" className="h-full" elementRef={groupRef} onLayoutChanged={(l) => savePanels(l, groupRef.current?.clientWidth ?? 0)} data-testid="library">
      <Panel id="sidebar" defaultSize={panels.sidebar ?? 250} minSize={200} maxSize={480} className="min-w-0" data-testid="panel-sidebar"><Sidebar /></Panel>
      <Separator className={separatorClass} aria-label="resize sidebar" data-testid="resize-sidebar" />
      {dialogs}
      <CollectionDialogs onCreated={(id, addIds) => { if (addIds?.length) addTo.mutate({ id, projectIds: addIds }, { onError: reportError }); }} />
      <Panel id="main" minSize={360} className="min-w-0">
      <main className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]" onKeyDown={onKey}>
        <Toolbar title={filterTitle} count={filter.kind === 'inbox' ? 0 : list.length} onRescan={activeRoot && filter.kind !== 'inbox' ? () => void scan(activeRoot) : undefined} scanning={!!activeRoot && activeRoot in scanning} sortLocked={filter.kind === 'recent' || filter.kind === 'inbox'} onImport={() => void pickImport()} onSaveSmart={filtered && filter.kind !== 'inbox' && filter.kind !== 'collection' && filter.kind !== 'smart' ? saveSmart : undefined} collectionSort={filter.kind === 'collection'} />
        {filter.kind === 'inbox' ? (
          <InboxView rootId={filter.rootId} />
        ) : list.length === 0 && !pending ? (
          <div className="grid place-items-center p-10 text-center text-muted-foreground" data-testid="empty">
            <div className="grid justify-items-center gap-3">
              <span className="grid size-16 place-items-center rounded-[20px] bg-accent text-accent-foreground"><Search className="size-7" /></span>
              <b className="text-base text-foreground">{t('library.empty')}</b>
              <p className="max-w-[40ch] text-sm">{filtered ? t('library.emptyFiltered') : filter.kind === 'favorites' ? t('library.emptyFavorites') : filter.kind === 'collection' ? t('collections.emptyCollection') : filter.kind === 'smart' ? t('collections.emptySmart') : t('library.emptyRoot')}</p>
              {filtered ? <Button variant="outline" onClick={clearFilters}>{t('library.clearFilters')}</Button> : filter.kind !== 'favorites' && filter.kind !== 'collection' && filter.kind !== 'smart' && activeRoot && <Button onClick={() => void scan(activeRoot)}>{t('library.rescan')}</Button>}
            </div>
          </div>
        ) : view === 'grid' ? (
          <ProjectGrid projects={list} tile={tile} selected={selectedSet} onSelect={onSelect} onOpen={onOpen} onTag={toggleTag} actions={actions} onReorder={onReorder} />
        ) : (
          <ProjectList projects={list} selected={selectedSet} sort={effectiveSort} onSort={setSort} onSelect={onSelect} onOpen={onOpen} onTag={toggleTag} actions={actions} />
        )}
      </main>
      </Panel>
      <Separator className={separatorClass} aria-label="resize inspector" data-testid="resize-inspector" />
      <Panel id="inspector" defaultSize={panels.inspector ?? 320} minSize={260} maxSize={600} className="min-w-0" data-testid="panel-inspector">
        <Inspector selectedIds={selected} visible={list} tagCounts={tagCounts.data ?? []} facets={facets.data} filterTitle={filterTitle} onTag={toggleTag} actions={actions} />
      </Panel>
    </Group>
  );
}
