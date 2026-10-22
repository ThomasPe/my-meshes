import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { reportError } from '@/lib/errors';
import { useMoveProjects } from '@/lib/queries';

/** `root:rel/path` -> the folder the project sat in, for undo. */
export function parentOf(id: string): { rootId: string; rel: string } {
  const i = id.indexOf(':');
  const rootId = id.slice(0, i), rel = id.slice(i + 1);
  return { rootId, rel: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '' };
}

/**
 * Moves projects into a folder and reports the outcome in a toast with an Undo action that
 * moves them back to where each one came from (IMP-7). Shared by the dialog and by drops on
 * the tree.
 */
export function useMove() {
  const { t } = useTranslation();
  const move = useMoveProjects();
  const run = useCallback((projectIds: string[], rootId: string, destRel: string, destLabel: string, onDone?: () => void) => {
    move.mutate({ projectIds, rootId, destRel }, {
      onSuccess: (report) => {
        // the report lists moved projects in request order, minus the failed ones
        const failed = new Set(report.failed.map((f) => f.project_id));
        const origins = new Map<string, string[]>(); // "root:parent" -> new ids
        let k = 0;
        for (const oldId of projectIds) {
          if (failed.has(oldId)) continue;
          const np = report.moved[k++];
          if (!np || np.id === oldId) continue;
          const o = parentOf(oldId);
          const key = `${o.rootId}:${o.rel}`;
          origins.set(key, [...(origins.get(key) ?? []), np.id]);
        }
        const count = [...origins.values()].reduce((a, l) => a + l.length, 0);
        if (count > 0) {
          const undo = () => {
            for (const [key, ids] of origins) {
              const i = key.indexOf(':');
              move.mutate({ projectIds: ids, rootId: key.slice(0, i), destRel: key.slice(i + 1) }, { onSuccess: () => toast.success(t('actions.movedBack', { count: ids.length })), onError: reportError });
            }
          };
          toast.success(t('actions.moved', { count, dest: destLabel }), { action: { label: t('actions.undo'), onClick: undo }, duration: 8000 });
        } else if (report.failed.length === 0) toast.info(t('actions.moveNoop'));
        if (report.failed.length) toast.error(t('actions.moveFailedSome', { count: report.failed.length }), { description: report.failed[0]!.message });
        onDone?.();
      },
      onError: reportError,
    });
  }, [move, t]);
  return { run, pending: move.isPending };
}
