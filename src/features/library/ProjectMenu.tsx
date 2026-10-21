import { Eye, FolderHeart, FolderMinus, FolderOpen, ImageUp, Pencil, Plus, Star, StarOff, Trash2 } from 'lucide-react';
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

export function ProjectMenu({ project: p, actions, children }: { project: ProjectSummary; actions: ProjectActions; children: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent data-testid="project-menu">
        <ContextMenuItem onSelect={() => actions.open(p)}><Eye />{t('inspector.open')}</ContextMenuItem>
        <ContextMenuItem onSelect={() => actions.toggleFavorite(p)}>{p.favorite ? <><StarOff />{t('favorites.remove')}</> : <><Star />{t('favorites.add')}</>}</ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger data-testid="menu-add-to-collection"><FolderHeart />{t('collections.addTo')}</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {actions.collections.map((c) => <ContextMenuItem key={c.id} disabled={c.projects.includes(p.id)} onSelect={() => actions.addToCollection(p, c.id)} data-testid="menu-collection">{c.name}</ContextMenuItem>)}
            {actions.collections.length > 0 && <ContextMenuSeparator />}
            <ContextMenuItem onSelect={() => actions.addToCollection(p, null)}><Plus />{t('collections.new')}</ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        {actions.removeFromCollection && <ContextMenuItem onSelect={() => actions.removeFromCollection!(p)} data-testid="menu-remove-from-collection"><FolderMinus />{t('collections.removeFrom')}</ContextMenuItem>}
        <ContextMenuItem disabled={p.offline || p.rel_path === ''} onSelect={() => actions.rename(p)} data-testid="menu-rename"><Pencil />{t('actions.rename')}</ContextMenuItem>
        <ContextMenuItem disabled={p.offline} onSelect={() => actions.reveal(p)}><FolderOpen />{t('inspector.reveal')}</ContextMenuItem>
        <ContextMenuItem disabled={p.offline} onSelect={() => actions.rerenderThumbnail(p)} data-testid="menu-rethumb"><ImageUp />{t('actions.rerenderThumb')}</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" disabled={p.offline || p.rel_path === ''} onSelect={() => actions.remove(p)} data-testid="menu-delete"><Trash2 />{t('actions.delete')}</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
