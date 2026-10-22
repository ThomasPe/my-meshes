import { Box, ChevronDown, ChevronRight, Clock, Eye, Folder, FolderInput, FolderHeart, FolderOpen, HardDrive, Inbox, LayoutGrid, Pencil, Plus, RefreshCw, Settings, Sparkles, Star, Tag, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu';
import { getBackend } from '@/lib/backend';
import { reportError } from '@/lib/errors';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useCollectionDialog } from '@/features/library/CollectionDialogs';
import { useCollections, useFolderTree, useInbox, useLibraryStats, useRoots, useSmartCollections, useTagCounts } from '@/lib/queries';
import { navigate, routeHref, useRoute } from '@/lib/router';
import { MoveDialog } from '@/features/library/MoveDialog';
import { useMove } from '@/features/library/useMove';
import { create } from 'zustand';

/** The project row whose "Move to…" dialog is open (one dialog for the whole tree). */
const useTreeMove = create<{ target: { id: string; title: string; rel_path: string } | null; set: (t: { id: string; title: string; rel_path: string } | null) => void }>((set) => ({ target: null, set: (target) => set({ target }) }));
import { PROJECTS_MIME } from '@/features/library/ProjectGrid';
import { useTree, useUi, type LibraryFilter } from '@/lib/store';

/** Drop-target props for a tree row that accepts dragged project cards (IMP-7). */
function useDropTarget(enabled: boolean, rootId: string, rel: string, label: string) {
  const [over, setOver] = useState(false);
  const { run } = useMove();
  if (!enabled) return { over: false, props: {} };
  const accepts = (e: React.DragEvent) => e.dataTransfer.types.includes(PROJECTS_MIME);
  return {
    over,
    props: {
      onDragOver: (e: React.DragEvent) => { if (!accepts(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (!over) setOver(true); },
      onDragLeave: () => setOver(false),
      onDrop: (e: React.DragEvent) => {
        if (!accepts(e)) return;
        e.preventDefault(); setOver(false);
        try { const ids = JSON.parse(e.dataTransfer.getData(PROJECTS_MIME)) as string[]; if (ids.length) run(ids, rootId, rel, label); } catch { /* not ours */ }
      },
    },
  };
}
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
  const storeFilter = useUi((s) => s.setFilter);
  const activeTags = useUi((s) => s.tags);
  const storeToggleTag = useUi((s) => s.toggleTag);
  // the sidebar lives in the shell and stays visible on a project page: picking a view,
  // folder or tag there returns to the library with that selection (NAV-1)
  const route = useRoute();
  const inLibrary = route.page === 'library';
  const currentProject = route.page === 'project' ? route.id : null;
  const setFilter = useCallback((f: LibraryFilter) => { storeFilter(f); if (!inLibrary) navigate({ page: 'library' }); }, [storeFilter, inLibrary]);
  const toggleTag = useCallback((tag: string) => { storeToggleTag(tag); if (!inLibrary) navigate({ page: 'library' }); }, [storeToggleTag, inLibrary]);
  const openDialog = useCollectionDialog((s) => s.open);

  // Explorer-style keyboard navigation over the folder tree. Rows are plain DOM nodes with
  // data attributes, so the roving focus and the arrow keys work without lifting the
  // per-row open state: Right expands (or steps into), Left collapses (or steps out),
  // Up/Down/Home/End move and select, typing jumps to the next matching name.
  const treeRef = useRef<HTMLDivElement>(null);
  const typeahead = useRef({ text: '', at: 0 });
  const rowsOf = () => Array.from(treeRef.current?.querySelectorAll<HTMLElement>('[data-tree-row]') ?? []);
  const focusRow = (row: HTMLElement | undefined, select = true) => {
    if (!row) return;
    for (const r of rowsOf()) r.tabIndex = r === row ? 0 : -1;
    row.focus();
    if (select) row.querySelector<HTMLElement>('[data-select]')?.click();
  };
  const onTreeFocus = (e: React.FocusEvent) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-tree-row]');
    if (row) for (const r of rowsOf()) r.tabIndex = r === row ? 0 : -1;
  };
  const onTreeKey = (e: React.KeyboardEvent) => {
    const rows = rowsOf();
    const current = (e.target as HTMLElement).closest<HTMLElement>('[data-tree-row]');
    if (!current || rows.length === 0) return;
    const idx = rows.indexOf(current);
    const open = current.getAttribute('aria-expanded');
    const toggle = () => current.querySelector<HTMLElement>('[data-chevron]')?.click();
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); focusRow(rows[Math.min(idx + 1, rows.length - 1)]); break;
      case 'ArrowUp': e.preventDefault(); focusRow(rows[Math.max(idx - 1, 0)]); break;
      case 'Home': e.preventDefault(); focusRow(rows[0]); break;
      case 'End': e.preventDefault(); focusRow(rows[rows.length - 1]); break;
      case 'ArrowRight':
        e.preventDefault();
        if (open === 'false') toggle();
        else if (open === 'true') { const next = rows[idx + 1]; if (next && next.dataset.parent === current.dataset.key) focusRow(next); }
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (open === 'true') toggle();
        else { const parent = rows.find((r) => r.dataset.key === current.dataset.parent); if (parent) focusRow(parent); }
        break;
      case 'Enter': case ' ': e.preventDefault(); current.querySelector<HTMLElement>('[data-select]')?.click(); break;
      case '*': e.preventDefault(); for (const r of rows) if (r.getAttribute('aria-expanded') === 'false' && r.dataset.parent === current.dataset.parent) r.querySelector<HTMLElement>('[data-chevron]')?.click(); break;
      default: {
        if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
        const now = Date.now();
        const st = typeahead.current;
        st.text = now - st.at < 800 ? st.text + e.key.toLowerCase() : e.key.toLowerCase();
        st.at = now;
        const order = [...rows.slice(idx + (st.text.length === 1 ? 1 : 0)), ...rows.slice(0, idx + (st.text.length === 1 ? 1 : 0))];
        const hit = order.find((r) => (r.dataset.label ?? '').toLowerCase().startsWith(st.text));
        if (hit) { e.preventDefault(); focusRow(hit); }
      }
    }
  };
  useEffect(() => {
    // one tab stop: the first row (or the selected one) unless the user already moved
    const rows = rowsOf();
    if (rows.length && !rows.some((r) => r.tabIndex === 0)) (rows.find((r) => r.getAttribute('aria-selected') === 'true') ?? rows[0])!.tabIndex = 0;
  });
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
          <div ref={treeRef} role="tree" aria-label={t('library.roots')} onKeyDown={onTreeKey} onFocusCapture={onTreeFocus} data-testid="folder-tree">
            {(roots.data ?? []).map((r) => <RootTree key={r.id} root={r} filter={filter} setFilter={setFilter} onRescan={onRescan} current={currentProject} />)}
            <TreeMoveDialog />
          </div>
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

const INDENT = 8; // px per tree level: a child's chevron sits half an icon to the right of its parent's
const MODE_DOT: Record<string, string> = { watch: 'bg-success', poll: 'bg-primary', manual: 'bg-muted-foreground', offline: 'bg-destructive' };

function reveal(rootId: string, rel: string) {
  getBackend().then((b) => b.revealFolder(rootId, rel)).catch(reportError);
}

function RootTree({ root, filter, setFilter, onRescan, current }: { root: LibraryRoot; filter: LibraryFilter; setFilter: (f: LibraryFilter) => void; onRescan?: (rootId: string) => void; current: string | null }) {
  const { t } = useTranslation();
  const open = useTree((s) => s.open[root.id] ?? true);
  const setTreeOpen = useTree((s) => s.setOpen);
  const setOpen = (f: (o: boolean) => boolean) => setTreeOpen(root.id, f(open));
  const tree = useFolderTree(root.id);
  const inbox = useInbox(root.status === 'offline' ? null : root.id);
  const rootFilter: LibraryFilter = { kind: 'root', rootId: root.id };
  const inboxFilter: LibraryFilter = { kind: 'inbox', rootId: root.id };
  const name = root.path.split(/[\\/]/).filter(Boolean).pop() || root.path;
  const online = root.status !== 'offline';
  const modeKey = online ? root.mode : 'offline';
  const modeLabel = online ? t(`settings.mode.${root.mode}`) : t('settings.status.offline');
  const drop = useDropTarget(online, root.id, '', name);
  return (
    <div>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className={cn(itemClass, 'pr-2 font-extrabold text-foreground focus-visible:outline-2 focus-visible:outline-primary', same(filter, rootFilter) ? activeClass : 'bg-secondary/50', drop.over && 'outline outline-2 outline-primary')} {...drop.props} data-drop-over={drop.over || undefined} data-testid="root-row" data-tree-row data-key={root.id} data-label={name} role="treeitem" aria-expanded={open} aria-selected={same(filter, rootFilter)} tabIndex={-1}>
            <button type="button" tabIndex={-1} data-chevron aria-label={open ? 'collapse' : 'expand'} className="-ml-1 rounded p-0.5 text-muted-foreground hover:text-foreground" onClick={() => setOpen((o) => !o)}>{open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}</button>
            <button type="button" tabIndex={-1} data-select data-testid="filter-root" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setFilter(rootFilter)} title={`${root.path} · ${modeLabel}`}>
              <span className="relative shrink-0"><HardDrive className="text-muted-foreground" /><span className={cn('absolute -bottom-0.5 -right-0.5 size-2 rounded-full ring-2 ring-panel', MODE_DOT[modeKey])} data-testid="root-mode-dot" data-mode={modeKey} aria-label={modeLabel} /></span>
              <Truncated text={name} />
            </button>
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
            <div className={cn(itemClass, 'h-8 font-medium focus-visible:outline-2 focus-visible:outline-primary', same(filter, inboxFilter) && activeClass)} style={{ paddingLeft: 12 + INDENT }} data-tree-row data-key={`${root.id}:_Inbox`} data-parent={root.id} data-label={t('inbox.title')} role="treeitem" aria-selected={same(filter, inboxFilter)} tabIndex={-1}>
              <span className="w-3.5 shrink-0" />
              <button type="button" tabIndex={-1} data-select data-testid="filter-inbox" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setFilter(inboxFilter)}><Inbox className="text-muted-foreground" /><Truncated text={t('inbox.title')} /></button>
              <span className="shrink-0 text-[11px] tabular text-muted-foreground" data-testid="inbox-count">{inbox.data?.length ?? 0}</span>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onSelect={() => reveal(root.id, '_Inbox')} data-testid="menu-reveal-folder"><FolderOpen />{t('inspector.reveal')}</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      )}
      {open && (tree.data ?? []).map((n) => <FolderItem key={n.rel_path} node={n} depth={1} rootId={root.id} filter={filter} setFilter={setFilter} online={online} current={current} />)}
    </div>
  );
}

function FolderItem({ node, depth, rootId, filter, setFilter, online, current }: { node: FolderNode; depth: number; rootId: string; filter: LibraryFilter; setFilter: (f: LibraryFilter) => void; online: boolean; current: string | null }) {
  const { t } = useTranslation();
  const key = `${rootId}:${node.rel_path}`;
  const open = useTree((s) => s.open[key] ?? depth < 2);
  const setTreeOpen = useTree((s) => s.setOpen);
  const setOpen = (f: (o: boolean) => boolean) => setTreeOpen(key, f(open));
  const f: LibraryFilter = { kind: 'folder', rootId, path: node.rel_path };
  const has = node.children.length > 0;
  // a project folder gets the model icon and opens the project itself (its id is root:path);
  // its own count is implied, so only containers show one
  const Icon = node.is_project ? Box : Folder;
  const projectId = node.is_project ? key : null;
  const active = projectId ? current === projectId : same(filter, f);
  const choose = () => (projectId ? navigate({ page: 'project', id: projectId }) : setFilter(f));
  const drop = useDropTarget(online && !projectId, rootId, node.rel_path, node.name);
  // a project row can be dragged onto another folder row, same payload as a card
  const dragProps = projectId && online ? {
    draggable: true,
    onDragStart: (e: React.DragEvent) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData(PROJECTS_MIME, JSON.stringify([projectId])); e.dataTransfer.setData('text/plain', projectId); },
  } : {};
  return (
    <div>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className={cn(itemClass, 'h-8 font-medium focus-visible:outline-2 focus-visible:outline-primary', active && activeClass, drop.over && 'outline outline-2 outline-primary')} {...drop.props} {...dragProps} data-drop-over={drop.over || undefined} style={{ paddingLeft: 12 + depth * INDENT }} data-tree-row data-key={key} data-parent={node.rel_path.includes('/') ? `${rootId}:${node.rel_path.slice(0, node.rel_path.lastIndexOf('/'))}` : rootId} data-label={node.name} data-kind={node.is_project ? 'project' : 'folder'} role="treeitem" aria-expanded={has ? open : undefined} aria-selected={active} tabIndex={-1}>
            {has ? <button type="button" tabIndex={-1} data-chevron aria-label={open ? 'collapse' : 'expand'} className="-ml-1 rounded p-0.5 text-muted-foreground hover:text-foreground" onClick={() => setOpen((o) => !o)}>{open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}</button> : <span className="w-3.5 shrink-0" />}
            <button type="button" tabIndex={-1} data-select data-testid={projectId ? 'tree-project' : 'filter-folder'} className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={choose}><Icon className={node.is_project ? 'text-primary/80' : 'text-muted-foreground'} /><Truncated text={node.name} data-testid="folder-name" /></button>
            {(!node.is_project || has) && <span className="shrink-0 text-[11px] tabular text-muted-foreground">{node.project_count}</span>}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent data-testid="folder-menu">
          {projectId && <ContextMenuItem onSelect={() => navigate({ page: 'project', id: projectId })}><Eye />{t('inspector.open')}</ContextMenuItem>}
          {projectId && <ContextMenuItem disabled={!online} onSelect={() => useTreeMove.getState().set({ id: projectId, title: node.name, rel_path: node.rel_path })} data-testid="menu-move"><FolderInput />{t('actions.move')}</ContextMenuItem>}
          {(!projectId || has) && <ContextMenuItem onSelect={() => setFilter(f)}><Folder />{t('library.showProjects')}</ContextMenuItem>}
          <ContextMenuItem disabled={!online} onSelect={() => reveal(rootId, node.rel_path)} data-testid="menu-reveal-folder"><FolderOpen />{t('inspector.reveal')}</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {open && has && node.children.map((c) => <FolderItem key={c.rel_path} node={c} depth={depth + 1} rootId={rootId} filter={filter} setFilter={setFilter} online={online} current={current} />)}
    </div>
  );
}

function TreeMoveDialog() {
  const target = useTreeMove((s) => s.target);
  const set = useTreeMove((s) => s.set);
  return <MoveDialog projects={target ? [target] : []} onClose={() => set(null)} onMoved={() => set(null)} />;
}
