import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { getBackend } from '@/lib/backend';
import type { AppInfo } from '@/lib/types';

/**
 * Dev-channel builds check the update feed once per session on startup and offer the
 * install (APP-9). Nothing is ever installed without the click; stable builds only
 * check when the user asks in settings.
 */
export function useStartupUpdateCheck(info: AppInfo | undefined) {
  const { t } = useTranslation();
  const done = useRef(false);
  useEffect(() => {
    if (!info || done.current || !info.updater || info.channel !== 'dev' || info.testMode) return;
    done.current = true;
    const timer = setTimeout(async () => {
      try {
        const b = await getBackend();
        const u = await b.checkUpdate();
        if (!u.available) return;
        toast(t('settings.updateAvailable', { version: u.version }), {
          description: t('settings.updateDevHint'),
          duration: 20_000,
          action: { label: t('settings.installUpdate'), onClick: () => { b.installUpdate().catch((e) => toast.error(String((e as { message?: string }).message ?? e))); } },
        });
      } catch {
        /* offline or feed missing: silent, settings has the manual check */
      }
    }, 4000);
    return () => clearTimeout(timer);
  }, [info, t]);
}
