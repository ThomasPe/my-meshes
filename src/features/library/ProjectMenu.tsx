import { Eye, FolderOpen, Pencil, Star, StarOff, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu';
import type { ProjectSummary } from '@/lib/types';

/** Actions a card, a row or the inspector can trigger; implemented once in `useProjectActions`. */
export interface ProjectActions {
  open: (p: ProjectSummary) => void;
  toggleFavorite: (p: ProjectSummary) => void;
  rename: (p: ProjectSummary) => void;
  remove: (p: ProjectSummary) => void;
  reveal: (p: ProjectSummary) => void;
}

export function ProjectMenu({ project: p, actions, children }: { project: ProjectSummary; actions: ProjectActions; children: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent data-testid="project-menu">
        <ContextMenuItem onSelect={() => actions.open(p)}><Eye />{t('inspector.open')}</ContextMenuItem>
        <ContextMenuItem onSelect={() => actions.toggleFavorite(p)}>{p.favorite ? <><StarOff />{t('favorites.remove')}</> : <><Star />{t('favorites.add')}</>}</ContextMenuItem>
        <ContextMenuItem disabled={p.offline || p.rel_path === ''} onSelect={() => actions.rename(p)} data-testid="menu-rename"><Pencil />{t('actions.rename')}</ContextMenuItem>
        <ContextMenuItem disabled={p.offline} onSelect={() => actions.reveal(p)}><FolderOpen />{t('inspector.reveal')}</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" disabled={p.offline || p.rel_path === ''} onSelect={() => actions.remove(p)} data-testid="menu-delete"><Trash2 />{t('actions.delete')}</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
