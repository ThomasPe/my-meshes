import { Search } from 'lucide-react';
import { useCallback, useMemo } from 'react';
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
import { useAddToCollection, useCollections, useProjects, useReorderCollection, useRoots, useSmartCollections, useSmartProjects, useTagCounts } from '@/lib/queries';
import { navigate } from '@/lib/router';
import { useUi } from '@/lib/store';
import type { ListQuery } from '@/lib/types';

export function LibraryPage({ scanning, onScanEnd }: { scanning: ScanState; onScanEnd: (rootId: string) => void }) {
  const { t } = useTranslation();
  const { filter, tags, text, sort, view, tile, selected, select, toggleTag, clearFilters, setSort } = useUi();
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

  const rootScoped = filter.kind === 'root' || filter.kind === 'folder' || filter.kind === 'inbox';
  const effectiveSort = filter.kind === 'recent' ? 'added' : filter.kind === 'collection' ? (sort === 'collection' || sort === 'modified' ? 'collection' : sort) : sort === 'collection' ? 'modified' : sort;
  const query = useMemo<ListQuery>(() => ({
    root_id: rootScoped ? filter.rootId : null,
    path_prefix: filter.kind === 'folder' ? filter.path : null,
    tags,
    text: text || null,
    favorites: filter.kind === 'favorites',
    collection_id: collectionId,
    sort: effectiveSort,
    limit: filter.kind === 'recent' ? 200 : null,
  }), [filter, tags, text, effectiveSort, rootScoped, collectionId]);
  const projects = useProjects(filter.kind === 'inbox' || smartId ? { ...query, limit: 0 } : query);
  const smartOverrides = useMemo<ListQuery>(() => ({ sort: sort === 'collection' ? 'modified' : sort, text: text || null }), [sort, text]);
  const smartProjects = useSmartProjects(smartId, smartOverrides);
  const tagCounts = useTagCounts(rootScoped ? filter.rootId : null);
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
  const filtered = tags.length > 0 || !!text;
  const single = selected.length === 1 ? list.find((p) => p.id === selected[0]) : undefined;
  const onKey = (e: React.KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.key === 'Escape' && selected.length) select([]);
    if (e.key === 'Delete' && single) { e.preventDefault(); actions.remove(single); }
    if (e.key === 'F2' && single) { e.preventDefault(); actions.rename(single); }
  };
  const saveSmart = () => openCollectionDialog({ kind: 'createSmart', query: { root_id: query.root_id, path_prefix: query.path_prefix, tags: query.tags, text: query.text, favorites: query.favorites, sort: effectiveSort === 'collection' ? 'modified' : effectiveSort } });
  const onReorder = collectionId && effectiveSort === 'collection' ? (ids: string[]) => reorder.mutate({ id: collectionId, order: ids }, { onError: reportError }) : undefined;

  return (
    <div className="grid h-full grid-cols-[250px_minmax(0,1fr)_320px]" data-testid="library">
      <Sidebar />
      {dialogs}
      <CollectionDialogs onCreated={(id, addIds) => { if (addIds?.length) addTo.mutate({ id, projectIds: addIds }, { onError: reportError }); }} />
      <main className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]" onKeyDown={onKey}>
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
      <Inspector selectedIds={selected} visible={list} tagCounts={tagCounts.data ?? []} filterTitle={filterTitle} onTag={toggleTag} actions={actions} />
    </div>
  );
}
