import { ChevronDown, ChevronRight, Clock, Folder, FolderHeart, FolderOpen, HardDrive, Inbox, LayoutGrid, Pencil, Plus, RefreshCw, Settings, Sparkles, Star, Tag, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu';
import { getBackend } from '@/lib/backend';
import { reportError } from '@/lib/errors';
import { navigate } from '@/lib/router';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useCollectionDialog } from '@/features/library/CollectionDialogs';
import { useCollections, useFolderTree, useInbox, useLibraryStats, useRoots, useSmartCollections, useTagCounts } from '@/lib/queries';
import { routeHref } from '@/lib/router';
import { useUi, type LibraryFilter } from '@/lib/store';
import type { FolderNode, LibraryRoot } from '@/lib/types';
import { Truncated } from '@/components/ui/truncated';
import { cn } from '@/lib/utils';

const itemClass = 'flex h-9 w-full items-center gap-2.5 rounded-[10px] px-3 text-left text-[13px] font-semibold text-secondary-foreground hover:bg-secondary [&_svg]:size-4 [&_svg]:shrink-0';
const activeClass = 'bg-accent text-accent-foreground hover:bg-accent';
const headClass = 'mb-1.5 flex items-center px-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground';

function same(a: LibraryFilter, b: LibraryFilter) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function Sidebar({ onRescan }: { onRescan?: (rootId: string) => void } = {}) {
  const { t } = useTranslation();
  const roots = useRoots();
  const stats = useLibraryStats();
  const tags = useTagCounts(null);
  const collections = useCollections();
  const smart = useSmartCollections();
  const filter = useUi((s) => s.filter);
  const setFilter = useUi((s) => s.setFilter);
  const activeTags = useUi((s) => s.tags);
  const toggleTag = useUi((s) => s.toggleTag);
  const openDialog = useCollectionDialog((s) => s.open);

  return (
    <ScrollArea className="h-full border-r border-border bg-panel" data-testid="sidebar">
      <nav className="grid grid-cols-[minmax(0,1fr)] gap-4 p-3">
        <section>
          <h3 className={headClass}>{t('nav.library')}</h3>
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
          <h3 className={headClass}>{t('collections.title')}<button type="button" className="ml-auto rounded-full p-1 hover:bg-secondary" title={t('collections.new')} aria-label={t('collections.new')} data-testid="collection-new" onClick={() => openDialog({ kind: 'create' })}><Plus className="size-3.5" /></button></h3>
          {(collections.data ?? []).map((c) => {
            const f: LibraryFilter = { kind: 'collection', id: c.id };
            return (
              <ContextMenu key={c.id}>
                <ContextMenuTrigger asChild>
                  <button type="button" data-testid="filter-collection" className={cn(itemClass, same(filter, f) && activeClass)} onClick={() => setFilter(f)}>
                    <FolderHeart /><Truncated text={c.name} /><span className="ml-auto shrink-0 text-xs tabular text-muted-foreground">{c.projects.length}</span>
                  </button>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onSelect={() => openDialog({ kind: 'rename', id: c.id, name: c.name })}><Pencil />{t('actions.rename')}</ContextMenuItem>
                  <ContextMenuItem variant="destructive" onSelect={() => openDialog({ kind: 'delete', id: c.id, name: c.name })} data-testid="collection-delete"><Trash2 />{t('actions.delete')}</ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            );
          })}
          {(smart.data ?? []).map((s) => {
            const f: LibraryFilter = { kind: 'smart', id: s.id };
            return (
              <ContextMenu key={s.id}>
                <ContextMenuTrigger asChild>
                  <button type="button" data-testid="filter-smart" className={cn(itemClass, same(filter, f) && activeClass)} onClick={() => setFilter(f)} title={t('collections.smartHint')}>
                    <Sparkles /><Truncated text={s.name} />
                  </button>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onSelect={() => openDialog({ kind: 'renameSmart', id: s.id, name: s.name })}><Pencil />{t('actions.rename')}</ContextMenuItem>
                  <ContextMenuItem variant="destructive" onSelect={() => openDialog({ kind: 'deleteSmart', id: s.id, name: s.name })}><Trash2 />{t('actions.delete')}</ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            );
          })}
          {(collections.data?.length ?? 0) + (smart.data?.length ?? 0) === 0 && <p className="px-3 py-1 text-xs text-muted-foreground">{t('collections.emptyHint')}</p>}
        </section>
        <section>
          <h3 className={headClass}>{t('library.roots')}<a href={routeHref({ page: 'settings' })} className="ml-auto rounded-full p-1 hover:bg-secondary" title={t('settings.addFolder')}><Plus className="size-3.5" /></a></h3>
          {(roots.data ?? []).map((r) => <RootTree key={r.id} root={r} filter={filter} setFilter={setFilter} onRescan={onRescan} />)}
        </section>
        {tags.data && tags.data.length > 0 && (
          <section>
            <h3 className={headClass}>{t('library.tags')}</h3>
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

const INDENT = 14; // px per tree level; the chevron column is only kept where a level has children

function reveal(rootId: string, rel: string) {
  getBackend().then((b) => b.revealFolder(rootId, rel)).catch(reportError);
}

function RootTree({ root, filter, setFilter, onRescan }: { root: LibraryRoot; filter: LibraryFilter; setFilter: (f: LibraryFilter) => void; onRescan?: (rootId: string) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const tree = useFolderTree(root.id);
  const inbox = useInbox(root.status === 'offline' ? null : root.id);
  const rootFilter: LibraryFilter = { kind: 'root', rootId: root.id };
  const inboxFilter: LibraryFilter = { kind: 'inbox', rootId: root.id };
  const name = root.path.split(/[\\/]/).filter(Boolean).pop() || root.path;
  const online = root.status !== 'offline';
  const chevrons = (tree.data ?? []).some((n) => n.children.length > 0);
  return (
    <div>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className={cn(itemClass, 'pr-2', same(filter, rootFilter) && activeClass)} data-testid="root-row">
            <button type="button" aria-label={open ? 'collapse' : 'expand'} className="-ml-1 rounded p-0.5 text-muted-foreground hover:text-foreground" onClick={() => setOpen((o) => !o)}>{open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}</button>
            <button type="button" data-testid="filter-root" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setFilter(rootFilter)} title={root.path}>
              <span className={cn('size-2 shrink-0 rounded-full', online ? 'bg-success' : 'bg-muted-foreground/50')} />
              <HardDrive className="text-muted-foreground" />
              <Truncated text={name} />
            </button>
            <span className="shrink-0 text-[11px] text-muted-foreground">{online ? root.mode : 'offline'}</span>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent data-testid="root-menu">
          {onRescan && <ContextMenuItem disabled={!online} onSelect={() => onRescan(root.id)}><RefreshCw />{t('library.rescan')}</ContextMenuItem>}
          <ContextMenuItem disabled={!online} onSelect={() => reveal(root.id, '')} data-testid="menu-reveal-folder"><FolderOpen />{t('inspector.reveal')}</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => navigate({ page: 'settings' })}><Settings />{t('nav.settings')}</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {open && online && (
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div className={cn(itemClass, 'h-8 font-medium', same(filter, inboxFilter) && activeClass)} style={{ paddingLeft: 12 + INDENT }}>
              {chevrons && <span className="w-3.5 shrink-0" />}
              <button type="button" data-testid="filter-inbox" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setFilter(inboxFilter)}><Inbox className="text-muted-foreground" /><Truncated text={t('inbox.title')} /></button>
              <span className="shrink-0 text-[11px] tabular text-muted-foreground" data-testid="inbox-count">{inbox.data?.length ?? 0}</span>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onSelect={() => reveal(root.id, '_Inbox')} data-testid="menu-reveal-folder"><FolderOpen />{t('inspector.reveal')}</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      )}
      {open && (tree.data ?? []).map((n) => <FolderItem key={n.rel_path} node={n} depth={1} rootId={root.id} filter={filter} setFilter={setFilter} chevrons={chevrons} online={online} />)}
    </div>
  );
}

function FolderItem({ node, depth, rootId, filter, setFilter, chevrons, online }: { node: FolderNode; depth: number; rootId: string; filter: LibraryFilter; setFilter: (f: LibraryFilter) => void; chevrons: boolean; online: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(depth < 2);
  const f: LibraryFilter = { kind: 'folder', rootId, path: node.rel_path };
  const has = node.children.length > 0;
  const childChevrons = node.children.some((c) => c.children.length > 0);
  return (
    <div>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className={cn(itemClass, 'h-8 font-medium', same(filter, f) && activeClass)} style={{ paddingLeft: 12 + depth * INDENT }}>
            {has ? <button type="button" aria-label={open ? 'collapse' : 'expand'} className="-ml-1 rounded p-0.5 text-muted-foreground hover:text-foreground" onClick={() => setOpen((o) => !o)}>{open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}</button> : chevrons ? <span className="w-3.5 shrink-0" /> : null}
            <button type="button" data-testid="filter-folder" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setFilter(f)}><Folder className="text-muted-foreground" /><Truncated text={node.name} data-testid="folder-name" /></button>
            <span className="shrink-0 text-[11px] tabular text-muted-foreground">{node.project_count}</span>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent data-testid="folder-menu">
          <ContextMenuItem onSelect={() => setFilter(f)}><Folder />{t('library.showProjects')}</ContextMenuItem>
          <ContextMenuItem disabled={!online} onSelect={() => reveal(rootId, node.rel_path)} data-testid="menu-reveal-folder"><FolderOpen />{t('inspector.reveal')}</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {open && has && node.children.map((c) => <FolderItem key={c.rel_path} node={c} depth={depth + 1} rootId={rootId} filter={filter} setFilter={setFilter} chevrons={childChevrons} online={online} />)}
    </div>
  );
}
