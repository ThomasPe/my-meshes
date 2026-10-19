import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ProjectActions } from '@/features/library/ProjectMenu';
import { getBackend } from '@/lib/backend';
import { reportError } from '@/lib/errors';
import { useCollectionDialog } from '@/features/library/CollectionDialogs';
import { useAddToCollection, useCollections, useDeleteProject, useRemoveFromCollection, useRenameProject, useSetFavorite } from '@/lib/queries';
import { navigate } from '@/lib/router';
import { useUi } from '@/lib/store';
import { isAppError, type ProjectSummary } from '@/lib/types';

type Target = Pick<ProjectSummary, 'id' | 'title' | 'rel_path' | 'favorite' | 'offline'>;

/**
 * Project-level actions (favorite, rename, delete, reveal, open) plus the dialogs they need.
 * Render `dialogs` once in the page; pass `actions` to cards, rows, menus and the inspector.
 */
export function useProjectActions(opts: { onRenamed?: (oldId: string, newId: string) => void; onDeleted?: (id: string) => void; collectionId?: string | null } = {}) {
  const { t } = useTranslation();
  const favorite = useSetFavorite();
  const collections = useCollections();
  const addTo = useAddToCollection();
  const removeFrom = useRemoveFromCollection();
  const openCollectionDialog = useCollectionDialog((s) => s.open);
  const collectionId = opts.collectionId ?? null;
  const rename = useRenameProject();
  const remove = useDeleteProject();
  const select = useUi((s) => s.select);
  const [renaming, setRenaming] = useState<Target | null>(null);
  const [name, setName] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Target | null>(null);

  const actions = useMemo<ProjectActions>(() => ({
    open: (p) => navigate({ page: 'project', id: p.id }),
    toggleFavorite: (p) => favorite.mutate({ id: p.id, favorite: !p.favorite }, { onError: reportError }),
    rename: (p) => { setRenameError(null); setName(p.rel_path.split('/').pop() ?? ''); setRenaming(p); },
    remove: (p) => setDeleting(p),
    reveal: (p) => { getBackend().then((b) => b.revealProject(p.id)).catch(reportError); },
    addToCollection: (p, cid) => {
      if (cid === null) { openCollectionDialog({ kind: 'create', addProjectIds: [p.id] }); return; }
      addTo.mutate({ id: cid, projectIds: [p.id] }, { onSuccess: (c) => toast.success(t('collections.added', { name: c.name })), onError: reportError });
    },
    removeFromCollection: collectionId ? (p) => removeFrom.mutate({ id: collectionId, projectIds: [p.id] }, { onError: reportError }) : undefined,
    collections: collections.data ?? [],
  }), [favorite, collections.data, addTo, removeFrom, collectionId, openCollectionDialog, t]);

  const submitRename = useCallback(() => {
    if (!renaming) return;
    rename.mutate({ id: renaming.id, name }, {
      onSuccess: (np) => {
        const oldId = renaming.id;
        setRenaming(null);
        toast.success(t('actions.renamed', { name: np.rel_path.split('/').pop() }));
        select([np.id]);
        opts.onRenamed?.(oldId, np.id);
      },
      onError: (e) => {
        if (isAppError(e) && (e.code === 'invalid_name' || e.code === 'already_exists')) setRenameError(t(`errors.${e.code}`));
        else { setRenaming(null); reportError(e); }
      },
    });
  }, [renaming, name, rename, t, select, opts]);

  const confirmDelete = useCallback(() => {
    if (!deleting) return;
    const target = deleting;
    remove.mutate(target.id, {
      onSuccess: () => { setDeleting(null); select([]); toast.success(t('actions.deleted', { name: target.title })); opts.onDeleted?.(target.id); },
      onError: (e) => { setDeleting(null); reportError(e); },
    });
  }, [deleting, remove, select, t, opts]);

  const dialogs = (
    <>
      <Dialog open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent data-testid="rename-dialog">
          <form onSubmit={(e) => { e.preventDefault(); submitRename(); }} className="grid gap-4">
            <DialogHeader><DialogTitle>{t('actions.renameTitle')}</DialogTitle><DialogDescription>{t('actions.renameBody')}</DialogDescription></DialogHeader>
            <div className="grid gap-1.5">
              <Label htmlFor="rename-input">{t('actions.folderName')}</Label>
              <Input id="rename-input" autoFocus value={name} onChange={(e) => { setName(e.target.value); setRenameError(null); }} data-testid="rename-input" aria-invalid={!!renameError} />
              {renameError && <p className="text-xs font-semibold text-destructive" data-testid="rename-error">{renameError}</p>}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRenaming(null)}>{t('common.cancel')}</Button>
              <Button type="submit" disabled={rename.isPending || !name.trim()} data-testid="rename-confirm">{t('actions.rename')}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent data-testid="delete-dialog">
          <DialogHeader><DialogTitle>{t('actions.deleteTitle', { name: deleting?.title })}</DialogTitle><DialogDescription>{t('actions.deleteBody')}</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>{t('common.cancel')}</Button>
            <Button variant="destructive" disabled={remove.isPending} onClick={confirmDelete} data-testid="delete-confirm">{t('actions.moveToTrash')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );

  return { actions, dialogs };
}
