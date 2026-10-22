import { ChevronDown, FolderPlus, Inbox, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { reportError } from '@/lib/errors';
import { formatBytes, formatDate } from '@/lib/format';
import { commonPrefix, proposeName, stripPrefix } from '@/features/library/inboxNames';
import { useDeleteInboxFile, useInbox, usePromoteInbox, usePromoteInboxEach, useRoots } from '@/lib/queries';
import { navigate } from '@/lib/router';
import { isAppError } from '@/lib/types';
import { cn } from '@/lib/utils';

/** `_Inbox` of one root (IMP-3): loose files with a promote-to-project action. */
export function InboxView({ rootId }: { rootId: string }) {
  const { t, i18n } = useTranslation();
  const inbox = useInbox(rootId);
  const roots = useRoots();
  const root = roots.data?.find((r) => r.id === rootId);
  const [checked, setChecked] = useState<string[]>([]);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const promote = usePromoteInbox();
  const promoteEach = usePromoteInboxEach();
  const del = useDeleteInboxFile();
  // "one project per file": editable names, optional strip of the prefix most of them share
  const [each, setEach] = useState<Array<{ file: string; name: string }> | null>(null);
  const [strip, setStrip] = useState(false);
  const [eachErrors, setEachErrors] = useState<Record<string, string>>({});
  const prefix = useMemo(() => commonPrefix((each ?? []).map((r) => proposeName(r.file))), [each]);
  const openEach = () => {
    setEach(selected.map((f) => ({ file: f.name, name: proposeName(f.name) })));
    setStrip(false);
    setEachErrors({});
  };
  const toggleStrip = (on: boolean) => {
    setStrip(on);
    setEach((rows) => rows && rows.map((r) => ({ ...r, name: on ? stripPrefix(proposeName(r.file), prefix) : proposeName(r.file) })));
  };
  const dupes = useMemo(() => { const seen = new Map<string, number>(); for (const r of each ?? []) { const k = r.name.trim().toLowerCase(); seen.set(k, (seen.get(k) ?? 0) + 1); } return seen; }, [each]);
  const eachValid = !!each && each.length > 0 && each.every((r) => r.name.trim() && dupes.get(r.name.trim().toLowerCase()) === 1);
  const confirmEach = () => {
    if (!each || !eachValid) return;
    promoteEach.mutate({ rootId, items: each.map((r) => ({ file: r.file, name: r.name.trim() })) }, {
      onSuccess: (report) => {
        if (report.created.length) toast.success(t('inbox.promotedMany', { count: report.created.length }));
        if (report.failed.length === 0) { setEach(null); setChecked([]); return; }
        toast.error(t('inbox.promoteFailedSome', { count: report.failed.length }), { description: report.failed[0]!.message });
        const errors = Object.fromEntries(report.failed.map((f) => [f.file, f.message]));
        setEachErrors(errors);
        setEach((rows) => rows && rows.filter((r) => r.file in errors));
        setChecked(report.failed.map((f) => f.file));
      },
      onError: (e) => { setEach(null); reportError(e); },
    });
  };
  const files = inbox.data ?? [];
  const selected = files.filter((f) => checked.includes(f.name));

  const openNaming = () => {
    const first = selected[0]?.name ?? '';
    setName(first.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '));
    setError(null);
    setNaming(true);
  };
  const confirm = () => {
    promote.mutate({ rootId, files: checked, name }, {
      onSuccess: (p) => { setNaming(false); setChecked([]); toast.success(t('inbox.promoted', { name: p.title })); navigate({ page: 'project', id: p.id }); },
      onError: (e) => { if (isAppError(e) && (e.code === 'invalid_name' || e.code === 'already_exists')) setError(t(`errors.${e.code}`)); else { setNaming(false); reportError(e); } },
    });
  };

  return (
    <div className="h-full overflow-auto px-5 pb-6 pt-3" data-testid="inbox">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm text-muted-foreground">{t('inbox.hint', { path: root ? `${root.path}${root.path.includes('\\') ? '\\' : '/'}_Inbox` : '_Inbox' })}</p>
        <div className="flex items-center">
          <Button size="sm" disabled={selected.length === 0} onClick={openNaming} className={cn(selected.length > 1 && 'rounded-r-none')} data-testid="inbox-promote"><FolderPlus />{t('inbox.makeProject', { count: selected.length })}</Button>
          {selected.length > 1 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button size="sm" className="rounded-l-none border-l border-primary-foreground/30 px-2" aria-label={t('inbox.moreOptions')} data-testid="inbox-promote-more"><ChevronDown /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={openEach} data-testid="inbox-promote-each"><FolderPlus />{t('inbox.makeEach', { count: selected.length })}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
      {files.length === 0 && !inbox.isPending ? (
        <div className="grid place-items-center rounded-2xl bg-card p-10 text-center text-muted-foreground shadow-card" data-testid="inbox-empty">
          <div className="grid justify-items-center gap-2"><Inbox className="size-7" /><b className="text-foreground">{t('inbox.empty')}</b><p className="max-w-[40ch] text-sm">{t('inbox.emptyHint')}</p></div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl bg-card shadow-card">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border text-left text-[11px] font-bold uppercase tracking-wider text-muted-foreground"><th className="w-10 px-3 py-2.5"><input type="checkbox" aria-label="select all" checked={checked.length === files.length && files.length > 0} onChange={(e) => setChecked(e.target.checked ? files.map((f) => f.name) : [])} /></th><th className="px-3 py-2.5">{t('library.columns.title')}</th><th className="px-3 py-2.5">{t('project.fileRole.other')}</th><th className="px-3 py-2.5 text-right">{t('library.columns.size')}</th><th className="px-3 py-2.5 text-right">{t('library.columns.modified')}</th><th /></tr></thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.name} className={cn('border-b border-border last:border-0 hover:bg-secondary/50', checked.includes(f.name) && 'bg-accent/40')} data-testid="inbox-row" onClick={() => setChecked((c) => (c.includes(f.name) ? c.filter((x) => x !== f.name) : [...c, f.name]))}>
                  <td className="px-3 py-2.5"><input type="checkbox" aria-label={f.name} checked={checked.includes(f.name)} onChange={() => {}} /></td>
                  <td className="px-3 py-2.5 font-bold">{f.name}</td>
                  <td className="px-3 py-2.5"><Badge variant={f.kind === 'model' ? 'accent' : 'default'}>{t(`project.fileRole.${f.kind}`)}</Badge></td>
                  <td className="px-3 py-2.5 text-right text-muted-foreground tabular">{formatBytes(f.size, i18n.language)}</td>
                  <td className="px-3 py-2.5 text-right text-muted-foreground tabular">{formatDate(f.modified, i18n.language)}</td>
                  <td className="px-3 py-2.5 text-right"><Button size="icon-sm" variant="ghost" aria-label={`${t('actions.delete')} ${f.name}`} className="text-muted-foreground hover:text-destructive" onClick={(e) => { e.stopPropagation(); del.mutate({ rootId, name: f.name }, { onSuccess: () => toast.success(t('actions.fileDeleted', { name: f.name })), onError: reportError }); }}><Trash2 /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialog open={!!each} onOpenChange={(o) => !o && setEach(null)}>
        <DialogContent className="sm:max-w-[640px]" data-testid="promote-each-dialog">
          <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); confirmEach(); }}>
            <DialogHeader><DialogTitle>{t('inbox.promoteEachTitle')}</DialogTitle><DialogDescription>{t('inbox.promoteEachBody')}</DialogDescription></DialogHeader>
            {prefix && <label className="flex items-center justify-between gap-3 rounded-xl bg-secondary/60 px-3 py-2 text-[13px] font-semibold"><span>{t('inbox.stripPrefix', { prefix })}</span><Switch checked={strip} onCheckedChange={toggleStrip} data-testid="promote-strip-prefix" /></label>}
            <div className="max-h-[50vh] overflow-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-border text-left text-[11px] font-bold uppercase tracking-wider text-muted-foreground"><th className="px-3 py-2">{t('inbox.fileColumn')}</th><th className="px-3 py-2">{t('inbox.nameColumn')}</th></tr></thead>
                <tbody>
                  {(each ?? []).map((r, i) => {
                    const dup = !!r.name.trim() && dupes.get(r.name.trim().toLowerCase())! > 1;
                    const err = eachErrors[r.file] ?? (dup ? t('inbox.duplicateName') : null);
                    return (
                      <tr key={r.file} className="border-b border-border last:border-0 align-top" data-testid="promote-each-row">
                        <td className="max-w-[240px] truncate px-3 py-2 text-muted-foreground" title={r.file}>{r.file}</td>
                        <td className="px-3 py-1.5"><Input value={r.name} onChange={(e) => { const v = e.target.value; setEach((rows) => rows && rows.map((x, j) => (j === i ? { ...x, name: v } : x))); setEachErrors((m) => { if (!(r.file in m)) return m; const n = { ...m }; delete n[r.file]; return n; }); }} className="h-8" aria-invalid={!!err} data-testid="promote-each-name" />{err && <p className="mt-1 text-xs font-semibold text-destructive" data-testid="promote-each-error">{err}</p>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setEach(null)}>{t('common.cancel')}</Button><Button type="submit" disabled={!eachValid || promoteEach.isPending} data-testid="promote-each-confirm">{t('inbox.createMany', { count: each?.length ?? 0 })}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={naming} onOpenChange={(o) => !o && setNaming(false)}>
        <DialogContent data-testid="promote-dialog">
          <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); confirm(); }}>
            <DialogHeader><DialogTitle>{t('inbox.promoteTitle', { count: selected.length })}</DialogTitle><DialogDescription>{t('inbox.promoteBody')}</DialogDescription></DialogHeader>
            <div className="grid gap-1.5"><Label htmlFor="promote-name">{t('actions.folderName')}</Label><Input id="promote-name" autoFocus value={name} onChange={(e) => { setName(e.target.value); setError(null); }} data-testid="promote-name" />{error && <p className="text-xs font-semibold text-destructive" data-testid="promote-error">{error}</p>}</div>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setNaming(false)}>{t('common.cancel')}</Button><Button type="submit" disabled={!name.trim() || promote.isPending} data-testid="promote-confirm">{t('inbox.makeProjectShort')}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
