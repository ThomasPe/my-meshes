import { ExternalLink, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getBackend } from '@/lib/backend';
import { reportError } from '@/lib/errors';
import { formatBytes, formatDate } from '@/lib/format';
import { useDeleteFile } from '@/lib/queries';
import { navigate } from '@/lib/router';
import type { FileEntry } from '@/lib/types';

export function FilesTable({ projectId, files, offline }: { projectId: string; files: FileEntry[]; offline: boolean }) {
  const { t, i18n } = useTranslation();
  const open = (rel: string) => getBackend().then((b) => b.openProjectFile(projectId, rel)).catch(reportError);
  const del = useDeleteFile();
  const [deleting, setDeleting] = useState<FileEntry | null>(null);
  const confirm = () => {
    if (!deleting) return;
    const f = deleting;
    del.mutate({ id: projectId, relPath: f.rel_path }, {
      onSuccess: (project) => { setDeleting(null); toast.success(t('actions.fileDeleted', { name: f.name })); if (!project) { toast(t('actions.projectGone')); navigate({ page: 'library' }); } },
      onError: (e) => { setDeleting(null); reportError(e); },
    });
  };
  return (
    <div className="overflow-hidden rounded-2xl bg-card shadow-card">
      <table className="w-full text-sm">
        <thead><tr className="border-b border-border text-left text-[11px] font-bold uppercase tracking-wider text-muted-foreground"><th className="px-4 py-2.5">{t('library.columns.title')}</th><th className="px-3 py-2.5">{t('project.fileRole.other')}</th><th className="px-3 py-2.5 text-right">{t('library.columns.size')}</th><th className="px-3 py-2.5 text-right">{t('library.columns.modified')}</th><th /></tr></thead>
        <tbody>
          {files.map((f) => (
            <tr key={f.rel_path} className="border-b border-border last:border-0 hover:bg-secondary/50" data-testid="file-row">
              <td className="px-4 py-2.5"><div className="font-bold">{f.name} {f.slicer && <Badge variant="accent" className="ml-1">{f.slicer}</Badge>}</div>{f.rel_path !== f.name && <div className="font-mono text-[11px] text-muted-foreground">{f.rel_path}</div>}</td>
              <td className="px-3 py-2.5"><Badge variant={f.kind === 'model' ? 'accent' : f.kind === 'attachment' ? 'outline' : 'default'}>{t(`project.fileRole.${f.kind}`)}</Badge></td>
              <td className="px-3 py-2.5 text-right text-muted-foreground tabular">{formatBytes(f.size, i18n.language)}</td>
              <td className="px-3 py-2.5 text-right text-muted-foreground tabular">{formatDate(f.modified, i18n.language)}</td>
              <td className="px-3 py-2.5 text-right whitespace-nowrap">
                <Button size="sm" variant="ghost" disabled={offline} onClick={() => void open(f.rel_path)} title={t('project.openInApp')}><ExternalLink />{t('project.openInApp')}</Button>
                <Button size="icon-sm" variant="ghost" disabled={offline} onClick={() => setDeleting(f)} title={t('actions.delete')} aria-label={`${t('actions.delete')} ${f.name}`} data-testid="file-delete" className="text-muted-foreground hover:text-destructive"><Trash2 /></Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {files.some((f) => f.kind === 'attachment') && <p className="px-4 py-3 text-xs text-muted-foreground">{t('project.attachmentHint')}</p>}
      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent data-testid="delete-file-dialog">
          <DialogHeader><DialogTitle>{t('actions.deleteFileTitle', { name: deleting?.name })}</DialogTitle><DialogDescription>{t('actions.deleteFileBody')}</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>{t('common.cancel')}</Button>
            <Button variant="destructive" disabled={del.isPending} onClick={confirm} data-testid="delete-file-confirm">{t('actions.moveToTrash')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
