import { useEffect } from 'react';
import i18n from '@/i18n';
import { getBackend } from '@/lib/backend';
import { loadNotifications } from '@/lib/store';

/**
 * APP-4 notifications: a Windows toast when background work finishes while Meshkeep is not
 * the active window (a watch/poll rescan that found projects, an import). Nothing is shown
 * while the user is looking at the app; the status bar and toasts cover that.
 */
export function useOsNotifications() {
  useEffect(() => {
    let dead = false;
    const unlisten: Array<() => void> = [];
    getBackend().then(async (b) => {
      const u = await b.onLibraryChanged((e) => {
        if (!loadNotifications() || document.hasFocus()) return;
        if ((e.reason === 'watch' || e.reason === 'poll') && e.report && e.report.projects > 0) {
          b.getRoots().then((roots) => {
            const root = roots.find((r) => r.id === e.rootId)?.path.split(/[\\/]/).filter(Boolean).pop() ?? '';
            void b.notify(i18n.t('notify.scanTitle'), i18n.t('notify.scanBody', { projects: e.report!.projects, root }));
          }).catch(() => {});
        } else if (e.reason === 'import') {
          void b.notify(i18n.t('notify.importTitle'), e.report ? i18n.t('notify.importBody', { count: e.report.projects }) : i18n.t('notify.importBodyInbox'));
        }
      });
      if (dead) u(); else unlisten.push(u);
    });
    return () => { dead = true; unlisten.forEach((f) => f()); };
  }, []);
}
