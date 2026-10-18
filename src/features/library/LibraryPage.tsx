import { Search } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ScanState } from '@/App';
import { Button } from '@/components/ui/button';
import { Inspector } from '@/features/library/Inspector';
import { ProjectGrid } from '@/features/library/ProjectGrid';
import { ProjectList } from '@/features/library/ProjectList';
import { Sidebar } from '@/features/library/Sidebar';
import { Toolbar } from '@/features/library/Toolbar';
import { useLibraryActions } from '@/features/library/useLibraryActions';
import { useProjectActions } from '@/features/library/useProjectActions';
import { useProjects, useRoots, useTagCounts } from '@/lib/queries';
import { navigate } from '@/lib/router';
import { useUi } from '@/lib/store';
import type { ListQuery } from '@/lib/types';

export function LibraryPage({ scanning, onScanEnd }: { scanning: ScanState; onScanEnd: (rootId: string) => void }) {
  const { t } = useTranslation();
  const { filter, tags, text, sort, view, tile, selected, select, toggleTag, clearFilters, setSort } = useUi();
  const roots = useRoots();
  const { scan } = useLibraryActions(onScanEnd);
  const { actions, dialogs } = useProjectActions();

  const query = useMemo<ListQuery>(() => ({
    root_id: filter.kind === 'root' || filter.kind === 'folder' ? filter.rootId : null,
    path_prefix: filter.kind === 'folder' ? filter.path : null,
    tags,
    text: text || null,
    favorites: filter.kind === 'favorites',
    sort: filter.kind === 'recent' ? 'added' : sort,
    limit: filter.kind === 'recent' ? 200 : null,
  }), [filter, tags, text, sort]);
  const projects = useProjects(query);
  const tagCounts = useTagCounts(filter.kind === 'root' || filter.kind === 'folder' ? filter.rootId : null);
  const list = projects.data ?? [];
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

  const filterTitle = filter.kind === 'all' ? t('library.all') : filter.kind === 'recent' ? t('library.recent') : filter.kind === 'favorites' ? t('library.favorites') : filter.kind === 'folder' ? filter.path.split('/').pop()! : (roots.data?.find((r) => r.id === filter.rootId)?.path.split(/[\\/]/).filter(Boolean).pop() ?? '');
  const activeRoot = filter.kind === 'root' || filter.kind === 'folder' ? filter.rootId : roots.data?.[0]?.id;
  const filtered = tags.length > 0 || !!text;
  const single = selected.length === 1 ? list.find((p) => p.id === selected[0]) : undefined;
  const onKey = (e: React.KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.key === 'Escape' && selected.length) select([]);
    if (e.key === 'Delete' && single) { e.preventDefault(); actions.remove(single); }
    if (e.key === 'F2' && single) { e.preventDefault(); actions.rename(single); }
  };

  return (
    <div className="grid h-full grid-cols-[250px_minmax(0,1fr)_320px]" data-testid="library">
      <Sidebar />
      {dialogs}
      <main className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]" onKeyDown={onKey}>
        <Toolbar title={filterTitle} count={list.length} onRescan={activeRoot ? () => void scan(activeRoot) : undefined} scanning={!!activeRoot && activeRoot in scanning} sortLocked={filter.kind === 'recent'} />
        {list.length === 0 && !projects.isPending ? (
          <div className="grid place-items-center p-10 text-center text-muted-foreground" data-testid="empty">
            <div className="grid justify-items-center gap-3">
              <span className="grid size-16 place-items-center rounded-[20px] bg-accent text-accent-foreground"><Search className="size-7" /></span>
              <b className="text-base text-foreground">{t('library.empty')}</b>
              <p className="max-w-[40ch] text-sm">{filtered ? t('library.emptyFiltered') : filter.kind === 'favorites' ? t('library.emptyFavorites') : t('library.emptyRoot')}</p>
              {filtered ? <Button variant="outline" onClick={clearFilters}>{t('library.clearFilters')}</Button> : filter.kind !== 'favorites' && activeRoot && <Button onClick={() => void scan(activeRoot)}>{t('library.rescan')}</Button>}
            </div>
          </div>
        ) : view === 'grid' ? (
          <ProjectGrid projects={list} tile={tile} selected={selectedSet} onSelect={onSelect} onOpen={onOpen} onTag={toggleTag} actions={actions} />
        ) : (
          <ProjectList projects={list} selected={selectedSet} sort={filter.kind === 'recent' ? 'added' : sort} onSort={setSort} onSelect={onSelect} onOpen={onOpen} onTag={toggleTag} actions={actions} />
        )}
      </main>
      <Inspector selectedIds={selected} visible={list} tagCounts={tagCounts.data ?? []} filterTitle={filterTitle} onTag={toggleTag} actions={actions} />
    </div>
  );
}
