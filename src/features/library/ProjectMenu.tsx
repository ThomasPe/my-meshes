import { Eye, FolderHeart, FolderInput, FolderMinus, FolderOpen, ImageUp, Pencil, Plus, Star, StarOff, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger } from '@/components/ui/context-menu';
import type { Collection, ProjectSummary } from '@/lib/types';

/** Actions a card, a row or the inspector can trigger; implemented once in `useProjectActions`. */
export interface ProjectActions {
  open: (p: ProjectSummary) => void;
  toggleFavorite: (p: ProjectSummary) => void;
  rename: (p: ProjectSummary) => void;
  remove: (p: ProjectSummary) => void;
  reveal: (p: ProjectSummary) => void;
  /** Opens the "Move to…" folder picker for one or several projects. */
  move: (ps: ProjectSummary[]) => void;
  /** Throws the cached preview away and lets the queue render it again. */
  rerenderThumbnail: (p: ProjectSummary) => void;
  /** Add to an existing collection (or `null` to create a new one first). */
  addToCollection: (p: ProjectSummary, collectionId: string | null) => void;
  /** Present only while a manual collection is being viewed. */
  removeFromCollection?: (p: ProjectSummary) => void;
  collections: Collection[];
  filterByCreator: (creator: string) => void;
  /** Multi-selection: delete several projects after one confirmation. */
  removeMany: (ps: ProjectSummary[]) => void;
  addManyToCollection: (ps: ProjectSummary[], collectionId: string | null) => void;
  setFavoriteMany: (ps: ProjectSummary[], favorite: boolean) => void;
}

/**
 * Context menu of a card or row. Like Explorer: when the clicked project is part of the
 * selection the menu acts on the whole selection and says so in its labels; otherwise the
 * caller selects the clicked project alone first (see `onContextMenu` on the card/row) and
 * the menu acts on that one. Single-only entries (open, rename, reveal) disappear for many.
 */
export function ProjectMenu({ project: p, selection = [], actions, children }: { project: ProjectSummary; selection?: ProjectSummary[]; actions: ProjectActions; children: React.ReactNode }) {
  const { t } = useTranslation();
  const targets = selection.some((s) => s.id === p.id) && selection.length > 1 ? selection : [p];
  const many = targets.length > 1;
  const n = targets.length;
  const movable = targets.filter((x) => !x.offline && x.rel_path !== '');
  const allFav = targets.every((x) => x.favorite);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent data-testid="project-menu" data-count={n}>
        {!many && <ContextMenuItem onSelect={() => actions.open(p)}><Eye />{t('inspector.open')}</ContextMenuItem>}
        <ContextMenuItem onSelect={() => (many ? actions.setFavoriteMany(targets, !allFav) : actions.toggleFavorite(p))} data-testid="menu-favorite">{allFav ? <><StarOff />{t('favorites.removeN', { count: n })}</> : <><Star />{t('favorites.addN', { count: n })}</>}</ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger data-testid="menu-add-to-collection"><FolderHeart />{t('collections.addNTo', { count: n })}</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {actions.collections.map((c) => <ContextMenuItem key={c.id} disabled={targets.every((x) => c.projects.includes(x.id))} onSelect={() => (many ? actions.addManyToCollection(targets, c.id) : actions.addToCollection(p, c.id))} data-testid="menu-collection">{c.name}</ContextMenuItem>)}
            {actions.collections.length > 0 && <ContextMenuSeparator />}
            <ContextMenuItem onSelect={() => (many ? actions.addManyToCollection(targets, null) : actions.addToCollection(p, null))}><Plus />{t('collections.new')}</ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        {actions.removeFromCollection && <ContextMenuItem onSelect={() => { for (const x of targets) actions.removeFromCollection!(x); }} data-testid="menu-remove-from-collection"><FolderMinus />{t('collections.removeNFrom', { count: n })}</ContextMenuItem>}
        {!many && <ContextMenuItem disabled={p.offline || p.rel_path === ''} onSelect={() => actions.rename(p)} data-testid="menu-rename"><Pencil />{t('actions.rename')}</ContextMenuItem>}
        <ContextMenuItem disabled={movable.length === 0} onSelect={() => actions.move(movable)} data-testid="menu-move"><FolderInput />{t('actions.moveN', { count: n })}</ContextMenuItem>
        {!many && <ContextMenuItem disabled={p.offline} onSelect={() => actions.reveal(p)}><FolderOpen />{t('inspector.reveal')}</ContextMenuItem>}
        <ContextMenuItem disabled={targets.every((x) => x.offline)} onSelect={() => { for (const x of targets) if (!x.offline) actions.rerenderThumbnail(x); }} data-testid="menu-rethumb"><ImageUp />{t('actions.rerenderN', { count: n })}</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" disabled={movable.length === 0} onSelect={() => (many ? actions.removeMany(movable) : actions.remove(p))} data-testid="menu-delete"><Trash2 />{t('actions.deleteN', { count: n })}</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
