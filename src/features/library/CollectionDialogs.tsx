import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { reportError } from '@/lib/errors';
import { useCreateCollection, useCreateSmartCollection, useDeleteCollection, useDeleteSmartCollection, useRenameCollection, useRenameSmartCollection } from '@/lib/queries';
import { useUi } from '@/lib/store';
import type { ListQuery } from '@/lib/types';
import { create } from 'zustand';

export type CollectionDialogState =
  | { kind: 'none' }
  | { kind: 'create'; addProjectIds?: string[] }
  | { kind: 'rename'; id: string; name: string }
  | { kind: 'delete'; id: string; name: string }
  | { kind: 'createSmart'; query: ListQuery }
  | { kind: 'renameSmart'; id: string; name: string }
  | { kind: 'deleteSmart'; id: string; name: string };

export const useCollectionDialog = create<{ state: CollectionDialogState; open: (s: CollectionDialogState) => void; close: () => void }>((set) => ({
  state: { kind: 'none' },
  open: (state) => set({ state }),
  close: () => set({ state: { kind: 'none' } }),
}));

/** Name / confirm dialogs for manual and smart collections (NAV-7, NAV-8). Rendered once. */
export function CollectionDialogs({ onCreated }: { onCreated?: (id: string, addProjectIds?: string[]) => void }) {
  const { t } = useTranslation();
  const { state, close } = useCollectionDialog();
  const setFilter = useUi((s) => s.setFilter);
  const [name, setName] = useState('');
  const createC = useCreateCollection();
  const renameC = useRenameCollection();
  const deleteC = useDeleteCollection();
  const createS = useCreateSmartCollection();
  const renameS = useRenameSmartCollection();
  const deleteS = useDeleteSmartCollection();
  useEffect(() => { setName('name' in state ? state.name : ''); }, [state]);
  const pending = createC.isPending || renameC.isPending || deleteC.isPending || createS.isPending || renameS.isPending || deleteS.isPending;

  const submit = () => {
    const onError = (e: unknown) => reportError(e);
    switch (state.kind) {
      case 'create':
        createC.mutate(name, { onSuccess: (c) => { close(); toast.success(t('collections.created', { name: c.name })); onCreated?.(c.id, state.addProjectIds); if (!state.addProjectIds) setFilter({ kind: 'collection', id: c.id }); }, onError });
        break;
      case 'rename':
        renameC.mutate({ id: state.id, name }, { onSuccess: close, onError });
        break;
      case 'delete':
        deleteC.mutate(state.id, { onSuccess: () => { close(); setFilter({ kind: 'all' }); }, onError });
        break;
      case 'createSmart':
        createS.mutate({ name, query: state.query }, { onSuccess: (s) => { close(); toast.success(t('collections.smartSaved', { name: s.name })); setFilter({ kind: 'smart', id: s.id }); }, onError });
        break;
      case 'renameSmart':
        renameS.mutate({ id: state.id, name }, { onSuccess: close, onError });
        break;
      case 'deleteSmart':
        deleteS.mutate(state.id, { onSuccess: () => { close(); setFilter({ kind: 'all' }); }, onError });
        break;
      default:
        break;
    }
  };

  const isDelete = state.kind === 'delete' || state.kind === 'deleteSmart';
  const title = state.kind === 'create' ? t('collections.newTitle') : state.kind === 'createSmart' ? t('collections.newSmartTitle') : state.kind === 'rename' || state.kind === 'renameSmart' ? t('collections.renameTitle') : isDelete && 'name' in state ? t('collections.deleteTitle', { name: state.name }) : '';
  return (
    <Dialog open={state.kind !== 'none'} onOpenChange={(o) => !o && close()}>
      <DialogContent data-testid="collection-dialog">
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{state.kind === 'createSmart' ? t('collections.newSmartBody') : isDelete ? t('collections.deleteBody') : t('collections.nameBody')}</DialogDescription>
          </DialogHeader>
          {!isDelete && <div className="grid gap-1.5"><Label htmlFor="collection-name">{t('collections.name')}</Label><Input id="collection-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} data-testid="collection-name" /></div>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>{t('common.cancel')}</Button>
            <Button type="submit" variant={isDelete ? 'destructive' : 'default'} disabled={pending || (!isDelete && !name.trim())} data-testid="collection-confirm">{isDelete ? t('actions.delete') : state.kind.startsWith('rename') ? t('actions.rename') : t('collections.save')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
