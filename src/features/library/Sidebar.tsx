import { ChevronDown, ChevronRight, Clock, Folder, HardDrive, LayoutGrid, Plus, Star, Tag } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useFolderTree, useLibraryStats, useRoots, useTagCounts } from '@/lib/queries';
import { routeHref } from '@/lib/router';
import { useUi, type LibraryFilter } from '@/lib/store';
import type { FolderNode, LibraryRoot } from '@/lib/types';
import { cn } from '@/lib/utils';

const itemClass = 'flex h-9 w-full items-center gap-2.5 rounded-[10px] px-3 text-left text-[13px] font-semibold text-secondary-foreground hover:bg-secondary [&_svg]:size-4 [&_svg]:shrink-0';
const activeClass = 'bg-accent text-accent-foreground hover:bg-accent';

function same(a: LibraryFilter, b: LibraryFilter) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function Sidebar() {
  const { t } = useTranslation();
  const roots = useRoots();
  const stats = useLibraryStats();
  const tags = useTagCounts(null);
  const filter = useUi((s) => s.filter);
  const setFilter = useUi((s) => s.setFilter);
  const activeTags = useUi((s) => s.tags);
  const toggleTag = useUi((s) => s.toggleTag);

  return (
    <ScrollArea className="h-full border-r border-border bg-panel" data-testid="sidebar">
      <nav className="grid gap-4 p-3">
        <section>
          <h3 className="mb-1.5 px-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{t('nav.library')}</h3>
          <button type="button" data-testid="filter-all" className={cn(itemClass, filter.kind === 'all' && activeClass)} onClick={() => setFilter({ kind: 'all' })}>
            <LayoutGrid />{t('library.all')}<span className="ml-auto text-xs tabular text-muted-foreground">{stats.data?.projects ?? ''}</span>
          </button>
          <button type="button" data-testid="filter-recent" className={cn(itemClass, filter.kind === 'recent' && activeClass)} onClick={() => setFilter({ kind: 'recent' })}>
            <Clock />{t('library.recent')}
          </button>
          <button type="button" data-testid="filter-favorites" className={cn(itemClass, filter.kind === 'favorites' && activeClass)} onClick={() => setFilter({ kind: 'favorites' })}>
            <Star />{t('library.favorites')}<span className="ml-auto text-xs tabular text-muted-foreground" data-testid="favorites-count">{stats.data?.favorites ?? ''}</span>
          </button>
        </section>
        <section>
          <h3 className="mb-1.5 flex items-center px-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{t('library.roots')}<a href={routeHref({ page: 'settings' })} className="ml-auto rounded-full p-1 hover:bg-secondary" title={t('settings.addFolder')}><Plus className="size-3.5" /></a></h3>
          {(roots.data ?? []).map((r) => <RootTree key={r.id} root={r} filter={filter} setFilter={setFilter} />)}
        </section>
        {tags.data && tags.data.length > 0 && (
          <section>
            <h3 className="mb-1.5 px-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{t('library.tags')}</h3>
            <div className="flex flex-wrap gap-1.5 px-3">
              {tags.data.slice(0, 24).map((tc) => (
                <button key={tc.tag} type="button" onClick={() => toggleTag(tc.tag)} className={cn('inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 text-xs font-semibold text-secondary-foreground hover:bg-accent hover:text-accent-foreground', activeTags.includes(tc.tag) && 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground')}>
                  <Tag className="size-3" />{tc.tag}<span className="opacity-60">{tc.count}</span>
                </button>
              ))}
            </div>
          </section>
        )}
      </nav>
    </ScrollArea>
  );
}

function RootTree({ root, filter, setFilter }: { root: LibraryRoot; filter: LibraryFilter; setFilter: (f: LibraryFilter) => void }) {
  const [open, setOpen] = useState(true);
  const tree = useFolderTree(root.id);
  const rootFilter: LibraryFilter = { kind: 'root', rootId: root.id };
  const name = root.path.split(/[\\/]/).filter(Boolean).pop() || root.path;
  return (
    <div>
      <div className={cn(itemClass, 'pr-2', same(filter, rootFilter) && activeClass)}>
        <button type="button" aria-label={open ? 'collapse' : 'expand'} className="-ml-1 rounded p-0.5 text-muted-foreground hover:text-foreground" onClick={() => setOpen((o) => !o)}>{open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}</button>
        <button type="button" data-testid="filter-root" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setFilter(rootFilter)} title={root.path}>
          <span className={cn('size-2 shrink-0 rounded-full', root.status === 'offline' ? 'bg-muted-foreground/50' : 'bg-success')} />
          <HardDrive className="text-muted-foreground" />
          <span className="truncate">{name}</span>
        </button>
        <span className="text-[11px] text-muted-foreground">{root.status === 'offline' ? 'offline' : root.mode}</span>
      </div>
      {open && (tree.data ?? []).map((n) => <FolderItem key={n.rel_path} node={n} depth={1} rootId={root.id} filter={filter} setFilter={setFilter} />)}
    </div>
  );
}

function FolderItem({ node, depth, rootId, filter, setFilter }: { node: FolderNode; depth: number; rootId: string; filter: LibraryFilter; setFilter: (f: LibraryFilter) => void }) {
  const [open, setOpen] = useState(depth < 2);
  const f: LibraryFilter = { kind: 'folder', rootId, path: node.rel_path };
  const has = node.children.length > 0;
  return (
    <div>
      <div className={cn(itemClass, 'h-8 font-medium', same(filter, f) && activeClass)} style={{ paddingLeft: 12 + depth * 16 }}>
        {has ? <button type="button" aria-label={open ? 'collapse' : 'expand'} className="-ml-1 rounded p-0.5 text-muted-foreground hover:text-foreground" onClick={() => setOpen((o) => !o)}>{open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}</button> : <span className="w-3.5" />}
        <button type="button" data-testid="filter-folder" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setFilter(f)}><Folder className="text-muted-foreground" /><span className="truncate">{node.name}</span></button>
        <span className="text-[11px] tabular text-muted-foreground">{node.project_count}</span>
      </div>
      {open && has && node.children.map((c) => <FolderItem key={c.rel_path} node={c} depth={depth + 1} rootId={rootId} filter={filter} setFilter={setFilter} />)}
    </div>
  );
}
