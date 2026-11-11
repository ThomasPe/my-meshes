import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ProjectActions } from '@/features/library/ProjectMenu';
import { getBackend } from '@/lib/backend';
import { formatBytes } from '@/lib/format';
import { reportError } from '@/lib/errors';
import { useCollectionDialog } from '@/features/library/CollectionDialogs';
import { invalidateLibrary, keys, useAddToCollection, useCollections, useDeleteProject, useRemoveFromCollection, useRenameProject, useSetFavorite } from '@/lib/queries';
import { navigate } from '@/lib/router';
import { MoveDialog } from '@/features/library/MoveDialog';
import { forgetFileThumbs } from '@/lib/thumbs/files';
import { kickThumbQueue, useThumbs } from '@/lib/thumbs/queue';
import { forgetThumbnail } from '@/lib/thumbs/useThumbnail';
import { useUi } from '@/lib/store';
import { isAppError, type ProjectSummary } from '@/lib/types';

type Target = Pick<ProjectSummary, 'id' | 'title' | 'rel_path' | 'favorite' | 'offline'>;
type PackJob = { mode: 'pack' | 'unpack'; targets: ProjectSummary[] };

/**
 * Project-level actions (favorite, rename, delete, reveal, open) plus the dialogs they need.
 * Render `dialogs` once in the page; pass `actions` to cards, rows, menus and the inspector.
 */
export function useProjectActions(opts: { onRenamed?: (oldId: string, newId: string) => void; onDeleted?: (id: string) => void; collectionId?: string | null } = {}) {
  const { t, i18n } = useTranslation();
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
  // LIB-9: pack / unpack, confirmed in a dialog, with a progress toast while it runs
  const qc = useQueryClient();
  const [packJob, setPackJob] = useState<PackJob | null>(null);
  const [keepArchive, setKeepArchive] = useState(false);
  const [packBusy, setPackBusy] = useState(false);
  const [deletingMany, setDeletingMany] = useState<Target[]>([]);
  const [moving, setMoving] = useState<Target[]>([]);
  const setCreator = useUi((s) => s.setCreator);

  const actions = useMemo<ProjectActions>(() => ({
    open: (p) => navigate({ page: 'project', id: p.id }),
    toggleFavorite: (p) => favorite.mutate({ id: p.id, favorite: !p.favorite }, { onError: reportError }),
    rename: (p) => { setRenameError(null); setName(p.rel_path.split('/').pop() ?? ''); setRenaming(p); },
    remove: (p) => setDeleting(p),
    reveal: (p) => { getBackend().then((b) => b.revealProject(p.id)).catch(reportError); },
    move: (ps) => setMoving(ps.filter((p) => !p.offline && p.rel_path !== '')),
    pack: (ps) => { const targets = ps.filter((p) => !p.offline && p.rel_path !== '' && !p.packed); if (targets.length) setPackJob({ mode: 'pack', targets }); },
    unpack: (ps) => { const targets = ps.filter((p) => !p.offline && p.packed); if (targets.length) { setKeepArchive(false); setPackJob({ mode: 'unpack', targets }); } },
    rerenderThumbnail: (p) => {
      getBackend().then(async (b) => {
        await b.resetThumbnail(p.id);
        const key = p.thumb ?? useThumbs.getState().fresh[p.id];
        if (key) forgetThumbnail(key);
        useThumbs.setState((s) => { const fresh = { ...s.fresh }; delete fresh[p.id]; return { fresh }; });
        // the previews of its single files are rendered again as well (VIEW-8)
        forgetFileThumbs(p.id);
        void qc.invalidateQueries({ queryKey: keys.fileThumbs(p.id) });
        toast.success(t('actions.rerenderQueued', { name: p.title }));
        void kickThumbQueue();
      }).catch(reportError);
    },
    addToCollection: (p, cid) => {
      if (cid === null) { openCollectionDialog({ kind: 'create', addProjectIds: [p.id] }); return; }
      addTo.mutate({ id: cid, projectIds: [p.id] }, { onSuccess: (c) => toast.success(t('collections.added', { name: c.name })), onError: reportError });
    },
    removeFromCollection: collectionId ? (p) => removeFrom.mutate({ id: collectionId, projectIds: [p.id] }, { onError: reportError }) : undefined,
    collections: collections.data ?? [],
    filterByCreator: (c) => setCreator(c),
    removeMany: (ps) => setDeletingMany(ps.filter((p) => !p.offline && p.rel_path !== '')),
    addManyToCollection: (ps, cid) => {
      const ids = ps.map((p) => p.id);
      if (cid === null) { openCollectionDialog({ kind: 'create', addProjectIds: ids }); return; }
      addTo.mutate({ id: cid, projectIds: ids }, { onSuccess: (c) => toast.success(t('collections.addedMany', { count: ids.length, name: c.name })), onError: reportError });
    },
    setFavoriteMany: (ps, fav) => { for (const p of ps) if (p.favorite !== fav) favorite.mutate({ id: p.id, favorite: fav }, { onError: reportError }); },
  }), [favorite, collections.data, addTo, removeFrom, collectionId, openCollectionDialog, setCreator, t, qc]);

  const confirmDeleteMany = useCallback(async () => {
    const targets = deletingMany;
    setDeletingMany([]);
    let ok = 0;
    for (const p of targets) {
      try { await remove.mutateAsync(p.id); ok++; } catch (e) { reportError(e); }
    }
    select([]);
    if (ok) toast.success(t('actions.deletedMany', { count: ok }));
  }, [deletingMany, remove, select, t]);

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

  const confirmPack = useCallback(async () => {
    if (!packJob) return;
    const job = packJob;
    const ids = job.targets.map((p) => p.id);
    setPackBusy(true);
    const id = toast.loading(t(job.mode === 'pack' ? 'actions.packing' : 'actions.unpacking', { count: ids.length }));
    let off: (() => void) | null = null;
    try {
      const b = await getBackend();
      off = await b.onPackProgress((p) => toast.loading(t(`actions.packPhase.${p.phase}`, { index: Math.min(p.index + 1, p.total), total: p.total, name: p.name.split('/').pop() }), { id }));
      const report = job.mode === 'pack' ? await b.packProjects(ids) : await b.unpackProjects(ids, keepArchive);
      // previews are rendered again from the new place of the model
      for (const p of job.targets) { const key = p.thumb ?? useThumbs.getState().fresh[p.id]; if (key) forgetThumbnail(key); }
      useThumbs.setState((s) => { const fresh = { ...s.fresh }; for (const pid of ids) delete fresh[pid]; return { fresh }; });
      for (const pid of ids) forgetFileThumbs(pid);
      invalidateLibrary(qc);
      void kickThumbQueue();
      const sizes = { before: formatBytes(report.bytes_before, i18n.language), after: formatBytes(report.bytes_after, i18n.language) };
      const notes = [...report.failed.map((f) => f.message), ...report.warnings];
      if (report.projects.length) toast.success(t(job.mode === 'pack' ? 'actions.packed' : 'actions.unpacked', { count: report.projects.length, ...sizes }), { id, description: notes.length ? notes.slice(0, 3).join('\n') : job.mode === 'pack' ? t('actions.packedHint') : undefined });
      else toast.error(t('actions.packFailed', { count: report.failed.length }), { id, description: notes.slice(0, 3).join('\n') });
    } catch (e) {
      toast.dismiss(id);
      reportError(e);
    } finally {
      off?.();
      setPackBusy(false);
      setPackJob(null);
    }
  }, [packJob, keepArchive, qc, t, i18n.language]);

  const dialogs = (
    <>
      <Dialog open={!!packJob} onOpenChange={(o) => { if (!o && !packBusy) setPackJob(null); }}>
        <DialogContent data-testid="pack-dialog" data-mode={packJob?.mode}>
          <DialogHeader>
            <DialogTitle>{packJob?.mode === 'unpack' ? t('actions.unpackTitle', { count: packJob.targets.length, name: packJob.targets[0]?.title }) : t('actions.packTitle', { count: packJob?.targets.length ?? 0, name: packJob?.targets[0]?.title })}</DialogTitle>
            <DialogDescription>{packJob?.mode === 'unpack' ? t('actions.unpackBody') : t('actions.packBody')}</DialogDescription>
          </DialogHeader>
          {(packJob?.targets.length ?? 0) > 1 && <ul className="max-h-40 overflow-auto text-sm font-semibold">{packJob?.targets.map((p) => <li key={p.id} className="truncate">{p.title}</li>)}</ul>}
          {packJob?.mode === 'unpack' && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-primary" checked={keepArchive} onChange={(e) => setKeepArchive(e.target.checked)} data-testid="unpack-keep-archive" />{t('actions.unpackKeep')}</label>}
          <DialogFooter>
            <Button variant="outline" disabled={packBusy} onClick={() => setPackJob(null)}>{t('common.cancel')}</Button>
            <Button disabled={packBusy} onClick={() => void confirmPack()} data-testid="pack-confirm">{packJob?.mode === 'unpack' ? t('actions.unpack') : t('actions.pack')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <MoveDialog projects={moving} onClose={() => setMoving([])} onMoved={() => { setMoving([]); select([]); }} />
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
      <Dialog open={deletingMany.length > 0} onOpenChange={(o) => !o && setDeletingMany([])}>
        <DialogContent data-testid="delete-many-dialog">
          <DialogHeader><DialogTitle>{t('actions.deleteManyTitle', { count: deletingMany.length })}</DialogTitle><DialogDescription>{t('actions.deleteBody')}</DialogDescription></DialogHeader>
          <ul className="max-h-40 overflow-auto text-sm font-semibold">{deletingMany.map((p) => <li key={p.id} className="truncate">{p.title}</li>)}</ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingMany([])}>{t('common.cancel')}</Button>
            <Button variant="destructive" disabled={remove.isPending} onClick={() => void confirmDeleteMany()} data-testid="delete-many-confirm">{t('actions.moveToTrash')}</Button>
          </DialogFooter>
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
