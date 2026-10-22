import { Copy, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { ProjectActions } from '@/features/library/ProjectMenu';
import { Thumb } from '@/features/library/Thumb';
import { useDuplicates } from '@/features/library/useDuplicates';
import { getBackend } from '@/lib/backend';
import { formatBytes, formatDate } from '@/lib/format';
import { navigate } from '@/lib/router';
import { useUi } from '@/lib/store';
import type { DuplicateGroup, DuplicateMember } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * Duplicates (LIB-8): projects grouped by shared model-file content. "Identical" groups hold
 * the same model files; "overlap" groups share some. Keeping one member sends the others to
 * the trash through the usual confirmation.
 */
export function DuplicatesView({ actions }: { actions: ProjectActions }) {
  const { t, i18n } = useTranslation();
  const { report, scanning, progress, scannedAt, scan } = useDuplicates();
  const selected = useUi((s) => s.selected);
  const select = useUi((s) => s.select);
  // first visit scans; later library changes (a deletion, a move) refresh the report quietly
  useEffect(() => { if (!report && !scanning) void scan(); }, [report, scanning, scan]);
  useEffect(() => {
    let off: (() => void) | null = null;
    let dead = false;
    getBackend().then(async (b) => { const u = await b.onLibraryChanged(() => { if (useDuplicates.getState().report) void useDuplicates.getState().scan(); }); if (dead) u(); else off = u; });
    return () => { dead = true; off?.(); };
  }, []);
  const keep = (g: DuplicateGroup, m: DuplicateMember) => actions.removeMany(g.members.filter((x) => x.id !== m.id));
  return (
    <div className="h-full overflow-auto px-5 pb-6 pt-3" data-testid="duplicates">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm text-muted-foreground">{t('duplicates.hint')}</p>
        {scanning && progress && progress.total > 0 && <span className="text-xs font-semibold text-muted-foreground" data-testid="duplicates-progress">{t('duplicates.hashing', { done: progress.done, total: progress.total })}</span>}
        <Button size="sm" variant="outline" disabled={scanning} onClick={() => void scan()} data-testid="duplicates-scan"><RefreshCw className={cn(scanning && 'animate-spin')} />{scanning ? t('duplicates.scanning') : t('duplicates.scan')}</Button>
      </div>
      {report && report.groups.length === 0 && !scanning && (
        <div className="grid place-items-center rounded-2xl bg-card p-10 text-center text-muted-foreground shadow-card" data-testid="duplicates-empty">
          <div className="grid justify-items-center gap-2"><Copy className="size-7" /><b className="text-foreground">{t('duplicates.none')}</b><p className="max-w-[44ch] text-sm">{t('duplicates.noneHint', { candidates: report.candidates })}</p></div>
        </div>
      )}
      {report && report.groups.length > 0 && (
        <p className="mb-3 text-xs font-semibold text-muted-foreground" data-testid="duplicates-summary">{t('duplicates.summary', { groups: report.groups.length, candidates: report.candidates, when: scannedAt ? formatDate(new Date(scannedAt).toISOString(), i18n.language) : '' })}</p>
      )}
      <div className="grid gap-3">
        {report?.groups.map((g, gi) => (
          <section key={gi} className="rounded-2xl bg-card p-4 shadow-card" data-testid="duplicate-group" data-kind={g.kind}>
            <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
              <Badge variant={g.kind === 'identical' ? 'accent' : 'default'}>{t(`duplicates.kind.${g.kind}`)}</Badge>
              <span className="font-semibold">{t('duplicates.groupLine', { members: g.members.length, files: g.files, size: formatBytes(g.bytes, i18n.language) })}</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {g.members.map((m) => {
                const sel = selected.includes(m.id);
                return (
                  <div key={m.id} className={cn('flex min-w-0 gap-3 overflow-hidden rounded-xl border-2 border-transparent bg-background p-2.5 outline-none', sel && 'border-primary')} data-testid="duplicate-member" aria-selected={sel} tabIndex={0} onClick={() => select([m.id])} onDoubleClick={() => navigate({ page: 'project', id: m.id })} onKeyDown={(e) => { if (e.key === 'Enter') navigate({ page: 'project', id: m.id }); }}>
                    <Thumb thumb={m.thumb} projectId={m.id} className="size-20 shrink-0 overflow-hidden rounded-lg" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-bold" title={m.title}>{m.title}</div>
                      <div className="truncate font-mono text-[11px] text-muted-foreground" title={m.rel_path}>{m.rel_path || '/'}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{t('duplicates.memberLine', { shared: m.shared_files, models: m.model_files, files: m.file_count, size: formatBytes(m.total_bytes, i18n.language), modified: formatDate(m.modified, i18n.language) })}</div>
                      {(m.has_sidecar || m.favorite) && (
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          {m.has_sidecar ? <Badge variant="outline">project.yaml</Badge> : null}
                          {m.favorite ? <Badge variant="warning">★</Badge> : null}
                        </div>
                      )}
                      <Button size="sm" variant="outline" className="mt-2 h-7 max-w-full" disabled={m.offline} title={t('duplicates.keepHint')} onClick={(e) => { e.stopPropagation(); keep(g, m); }} data-testid="duplicate-keep"><Trash2 /><span className="truncate">{t('duplicates.keep')}</span></Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
