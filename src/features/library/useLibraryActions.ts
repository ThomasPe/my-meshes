import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { getBackend } from '@/lib/backend';
import { reportError } from '@/lib/errors';
import { formatDuration } from '@/lib/format';
import { invalidateLibrary, keys } from '@/lib/queries';
import { navigate } from '@/lib/router';

/** Root-level actions shared by welcome, library and settings. */
export function useLibraryActions(onScanEnd?: (rootId: string) => void) {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const scan = useCallback(async (rootId: string) => {
    try {
      const b = await getBackend();
      const report = await b.scanRoot(rootId);
      invalidateLibrary(qc);
      toast.success(t('settings.scanDone', { projects: report.projects, files: report.files, time: formatDuration(report.millis) }));
      return report;
    } catch (e) {
      reportError(e);
      qc.invalidateQueries({ queryKey: keys.roots });
      return null;
    } finally {
      onScanEnd?.(rootId);
    }
  }, [qc, t, onScanEnd]);

  const addRoot = useCallback(async (path: string) => {
    try {
      const b = await getBackend();
      const root = await b.addRoot(path, 'watch');
      await qc.invalidateQueries({ queryKey: keys.roots });
      toast(t('settings.rootAdded', { path: root.path }));
      navigate({ page: 'library' });
      void scan(root.id);
      return root;
    } catch (e) {
      reportError(e);
      return null;
    }
  }, [qc, t, scan]);

  const addRootViaPicker = useCallback(async () => {
    const b = await getBackend();
    const picked = await b.pickFolder();
    if (picked) await addRoot(picked);
  }, [addRoot]);

  const removeRoot = useCallback(async (id: string) => {
    try {
      const b = await getBackend();
      const root = await b.removeRoot(id);
      invalidateLibrary(qc);
      toast(t('settings.rootRemoved', { path: root.path }));
    } catch (e) {
      reportError(e);
    }
  }, [qc, t]);

  return { scan, addRoot, addRootViaPicker, removeRoot };
}
