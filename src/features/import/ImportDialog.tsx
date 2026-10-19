import { Archive, FileBox, Folder, Upload } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useImport } from '@/features/import/useImport';
import { reportError } from '@/lib/errors';
import { formatBytes } from '@/lib/format';
import { useExecuteImport, useRoots } from '@/lib/queries';
import { navigate } from '@/lib/router';
import { useUi } from '@/lib/store';
import { isAppError, type ArchivePolicy, type ImportAction } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Staging area (IMP-1/2/3): review proposals, pick the root and the archive policy, confirm. */
export function ImportDialog() {
  const { t, i18n } = useTranslation();
  const { open, analyzing, items, progress, setItem, close } = useImport();
  const roots = useRoots();
  const online = useMemo(() => (roots.data ?? []).filter((r) => r.status !== 'offline'), [roots.data]);
  const [rootId, setRootId] = useState<string>('');
  const [policy, setPolicy] = useState<ArchivePolicy>('keep');
  const [error, setError] = useState<string | null>(null);
  const run = useExecuteImport();
  const setFilter = useUi((s) => s.setFilter);
  useEffect(() => { if (!rootId && online[0]) setRootId(online[0].id); }, [online, rootId]);
  useEffect(() => { if (open) setError(null); }, [open]);

  const archiveBytes = items.filter((i) => i.kind === 'archive' && i.action === 'project').reduce((a, i) => a + i.total_bytes, 0);
  const counts = { project: items.filter((i) => i.action === 'project').length, inbox: items.filter((i) => i.action === 'inbox').length, skip: items.filter((i) => i.action === 'skip').length };
  const nothing = counts.project + counts.inbox === 0;

  const confirm = () => {
    if (!rootId) return;
    setError(null);
    run.mutate({ root_id: rootId, archive_policy: policy, items: items.map((i) => ({ source: i.source, action: i.action, name: i.name })) }, {
      onSuccess: (report) => {
        close();
        if (report.errors.length) toast.warning(t('import.partial', { count: report.errors.length }), { description: report.errors.join('\n') });
        else toast.success(t('import.done', { projects: report.projects.length, inbox: report.inbox_files }));
        if (report.projects.length > 0) { setFilter({ kind: 'recent' }); navigate({ page: 'library' }); }
        else if (report.inbox_files > 0) { setFilter({ kind: 'inbox', rootId }); navigate({ page: 'library' }); }
      },
      onError: (e) => { if (isAppError(e) && (e.code === 'invalid_name' || e.code === 'already_exists')) setError(`${e.message}`); else reportError(e); },
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !run.isPending) close(); }}>
      <DialogContent className="max-w-3xl" data-testid="import-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Upload className="size-5" />{t('import.title')}</DialogTitle>
          <DialogDescription>{t('import.lead')}</DialogDescription>
        </DialogHeader>
        {analyzing ? (
          <p className="py-6 text-center text-sm font-semibold text-muted-foreground">{t('import.analyzing')}</p>
        ) : (
          <div className="grid gap-3">
            <div className="max-h-[42vh] overflow-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-border text-left text-[11px] font-bold uppercase tracking-wider text-muted-foreground"><th className="px-3 py-2">{t('import.source')}</th><th className="px-3 py-2">{t('import.becomes')}</th><th className="px-3 py-2">{t('import.name')}</th><th className="px-3 py-2 text-right">{t('import.contents')}</th></tr></thead>
                <tbody>
                  {items.map((it, i) => (
                    <tr key={it.source} className={cn('border-b border-border last:border-0', it.action === 'skip' && 'opacity-60')} data-testid="import-item">
                      <td className="max-w-[220px] px-3 py-2"><div className="flex items-center gap-2">{it.kind === 'archive' ? <Archive className="size-4 shrink-0 text-muted-foreground" /> : it.kind === 'folder' ? <Folder className="size-4 shrink-0 text-muted-foreground" /> : <FileBox className="size-4 shrink-0 text-muted-foreground" />}<span className="truncate font-semibold" title={it.source}>{it.source.split(/[\\/]/).pop()}</span></div>{it.warnings.map((w) => <div key={w} className="text-[11px] font-semibold text-warning">{w}</div>)}</td>
                      <td className="px-3 py-2">
                        <Select value={it.action} onValueChange={(v) => setItem(i, { action: v as ImportAction })}>
                          <SelectTrigger size="sm" className="w-[130px] shadow-none" data-testid="import-action"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {it.kind !== 'file' && <SelectItem value="project">{t('import.actions.project')}</SelectItem>}
                            <SelectItem value="inbox">{t('import.actions.inbox')}</SelectItem>
                            <SelectItem value="skip">{t('import.actions.skip')}</SelectItem>
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-3 py-2">{it.action === 'project' ? <Input value={it.name} onChange={(e) => setItem(i, { name: e.target.value })} className="h-8" data-testid="import-name" /> : <span className="text-xs text-muted-foreground">{it.action === 'inbox' ? t('import.toInbox') : '—'}</span>}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right text-xs text-muted-foreground tabular">{t('import.models', { count: it.model_count })} · {formatBytes(it.total_bytes, i18n.language)}</td>
                    </tr>
                  ))}
                  {items.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-sm text-muted-foreground">{t('import.empty')}</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('import.intoRoot')}
                <Select value={rootId} onValueChange={setRootId}>
                  <SelectTrigger className="shadow-none" data-testid="import-root"><SelectValue /></SelectTrigger>
                  <SelectContent>{online.map((r) => <SelectItem key={r.id} value={r.id}>{r.path}</SelectItem>)}</SelectContent>
                </Select>
              </label>
              <label className="grid gap-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('import.archivePolicy')}
                <Select value={policy} onValueChange={(v) => setPolicy(v as ArchivePolicy)} disabled={archiveBytes === 0}>
                  <SelectTrigger className="shadow-none" data-testid="import-policy"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="keep">{t('import.policy.keep', { size: formatBytes(archiveBytes, i18n.language) })}</SelectItem>
                    <SelectItem value="originals">{t('import.policy.originals', { size: formatBytes(archiveBytes, i18n.language) })}</SelectItem>
                    <SelectItem value="trash">{t('import.policy.trash')}</SelectItem>
                  </SelectContent>
                </Select>
              </label>
            </div>
            {error && <p className="text-sm font-semibold text-destructive" data-testid="import-error">{error}</p>}
          </div>
        )}
        <DialogFooter className="items-center">
          <span className="mr-auto flex gap-1.5 text-xs font-semibold text-muted-foreground">
            <Badge variant="accent">{t('import.summary.projects', { count: counts.project })}</Badge>
            <Badge>{t('import.summary.inbox', { count: counts.inbox })}</Badge>
            {counts.skip > 0 && <Badge variant="outline">{t('import.summary.skip', { count: counts.skip })}</Badge>}
            {progress && run.isPending && <span className="self-center">{t('import.progress', { index: progress.index + 1, total: progress.total, name: progress.name })}</span>}
          </span>
          <Button variant="outline" disabled={run.isPending} onClick={close}>{t('common.cancel')}</Button>
          <Button disabled={analyzing || nothing || !rootId || run.isPending || items.some((i) => i.action === 'project' && !i.name.trim())} onClick={confirm} data-testid="import-confirm"><Upload />{t('import.confirm')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Full-window hint while files are dragged over the app. */
export function DropOverlay() {
  const { t } = useTranslation();
  const dragging = useImport((s) => s.dragging);
  if (!dragging) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-40 grid place-items-center bg-primary/10 backdrop-blur-[2px]" data-testid="drop-overlay">
      <div className="grid justify-items-center gap-2 rounded-3xl border-2 border-dashed border-primary bg-card px-10 py-8 shadow-card-hover">
        <Upload className="size-8 text-primary" />
        <b className="text-lg">{t('import.dropHere')}</b>
        <span className="text-sm text-muted-foreground">{t('import.dropHint')}</span>
      </div>
    </div>
  );
}
