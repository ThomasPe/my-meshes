import { useTranslation } from 'react-i18next';
import type { ScanState } from '@/App';
import { formatBytes, formatDate } from '@/lib/format';
import { useLibraryStats, useRoots } from '@/lib/queries';
import { useUi } from '@/lib/store';
import { cn } from '@/lib/utils';

export function StatusBar({ scanning }: { scanning: ScanState }) {
  const { t, i18n } = useTranslation();
  const roots = useRoots();
  const stats = useLibraryStats();
  const selected = useUi((s) => s.selected);
  const first = roots.data?.[0];
  const busy = Object.entries(scanning);

  return (
    <footer className="flex items-center gap-5 overflow-hidden whitespace-nowrap border-t border-border bg-panel px-5 text-xs font-semibold text-muted-foreground tabular" data-testid="statusbar">
      {busy.length > 0 ? (
        <span className="flex items-center gap-2"><Dot className="animate-pulse bg-primary" />{t('library.scanning', { count: busy.reduce((a, [, n]) => a + n, 0) })}</span>
      ) : first ? (
        <span className="flex items-center gap-2" title={first.path}>
          <Dot className={first.status === 'offline' ? 'bg-muted-foreground/50' : 'bg-success'} />
          {first.status === 'offline' ? t('status.offline', { path: first.path }) : t(first.mode === 'watch' ? 'status.watching' : first.mode === 'poll' ? 'status.polling' : 'status.manual', { path: first.path })}
          {first.last_scan_at && first.status !== 'offline' && <span className="text-muted-foreground/70">· {t('status.synced', { when: formatDate(first.last_scan_at, i18n.language) })}</span>}
          {roots.data && roots.data.length > 1 && <span className="text-muted-foreground/70">+{roots.data.length - 1}</span>}
        </span>
      ) : (
        <span>{t('status.noRoots')}</span>
      )}
      <span className="ml-auto flex gap-5">
        {selected.length > 0 && <span data-testid="status-selected">{t('library.selected', { count: selected.length })}</span>}
        {stats.data && <span>{t('status.total', { count: stats.data.projects, size: formatBytes(stats.data.totalBytes, i18n.language) })}</span>}
      </span>
    </footer>
  );
}

function Dot({ className }: { className?: string }) {
  return <span className={cn('inline-block size-2 shrink-0 rounded-full', className)} />;
}
