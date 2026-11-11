import { Archive, ExternalLink, File as FileIcon, FileText, Image as ImageIcon, LayoutGrid, List, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { FileThumb } from '@/features/project/FileThumb';
import { useProjectImage } from '@/features/project/ImageGallery';
import { getBackend } from '@/lib/backend';
import { reportError } from '@/lib/errors';
import { formatBytes, formatDate } from '@/lib/format';
import { useDeleteFile } from '@/lib/queries';
import { navigate } from '@/lib/router';
import { useUi } from '@/lib/store';
import { canRender } from '@/lib/thumbs/files';
import type { FileThumbListing } from '@/lib/thumbs/useFileThumb';
import type { FileEntry } from '@/lib/types';
import { useSeen } from '@/lib/useSeen';
import { cn } from '@/lib/utils';

interface PreviewProps { projectId: string; file: FileEntry; listing: FileThumbListing; offline: boolean; className?: string }

/** An image file as its own preview, read when the tile is first seen (shared with the gallery's cache). */
function ImagePreview({ projectId, file, offline, className }: Omit<PreviewProps, 'listing'>) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useSeen(ref);
  const url = useProjectImage(projectId, file.rel_path, seen && !offline, null, `${file.size}-${file.modified}`);
  return (
    <div ref={ref} className={cn('relative thumb-bg text-thumb', className)}>
      {url ? <img src={url} alt="" draggable={false} className="absolute inset-0 size-full object-cover" /> : <ImageIcon className="absolute inset-0 m-auto size-[38%] opacity-70" strokeWidth={1.4} />}
    </div>
  );
}

/** What a file looks like: models are rendered, images show themselves, everything else gets a glyph. */
function FilePreview({ projectId, file, listing, offline, className }: PreviewProps) {
  if (file.kind === 'model') return <FileThumb projectId={projectId} file={file} listing={listing} offline={offline} className={className} />;
  if (file.kind === 'image') return <ImagePreview projectId={projectId} file={file} offline={offline} className={className} />;
  const Icon = file.kind === 'document' ? FileText : file.kind === 'attachment' ? Archive : FileIcon;
  return <div className={cn('relative thumb-bg text-thumb', className)}><Icon className="absolute inset-0 m-auto size-[38%] opacity-70" strokeWidth={1.4} /></div>;
}

interface Props {
  projectId: string;
  files: FileEntry[];
  offline: boolean;
  packed?: string | null;
  listing: FileThumbListing;
  /** Puts a model on screen in the viewer (the page switches to the overview). */
  onShow?: (rel: string) => void;
}

export function FilesTable({ projectId, files, offline, packed = null, listing, onShow }: Props) {
  const { t, i18n } = useTranslation();
  const view = useUi((s) => s.filesView);
  const setView = useUi((s) => s.setFilesView);
  // LIB-9: files inside the packed archive can be opened (a copy is made), not deleted one by one
  const inArchive = (f: FileEntry) => !!packed && (f.rel_path === packed || f.rel_path.startsWith(`${packed}/`));
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
  // a model the viewer can draw opens there with a click on its preview
  const preview = (f: FileEntry, className: string) => {
    const tile = <FilePreview projectId={projectId} file={f} listing={listing} offline={offline} className={className} />;
    if (!onShow || f.kind !== 'model' || !canRender(f.name)) return tile;
    return <button type="button" onClick={() => onShow(f.rel_path)} title={t('project.showInViewer')} aria-label={`${t('project.showInViewer')}: ${f.name}`} className="block w-full rounded-lg outline-none ring-ring transition-transform hover:scale-[1.02] focus-visible:ring-2" data-testid="file-show">{tile}</button>;
  };
  const deleteButton = (f: FileEntry, variant: 'ghost' | 'secondary') => (
    <Button size="icon-sm" variant={variant} disabled={offline || inArchive(f)} onClick={() => setDeleting(f)} title={inArchive(f) ? t('project.packedNoDelete') : t('actions.delete')} aria-label={`${t('actions.delete')} ${f.name}`} data-testid="file-delete" className="text-muted-foreground hover:text-destructive"><Trash2 /></Button>
  );
  const packedEntry = (f: FileEntry) => (inArchive(f) && f.rel_path !== packed) || undefined;
  return (
    <div className="grid gap-3" data-testid="files" data-view={view}>
      <div className="flex justify-end">
        <ToggleGroup type="single" value={view} onValueChange={(v) => v && setView(v as 'grid' | 'list')} aria-label={t('project.filesView')}>
          <ToggleGroupItem value="list" data-testid="files-view-list"><List />{t('library.list')}</ToggleGroupItem>
          <ToggleGroupItem value="grid" data-testid="files-view-grid"><LayoutGrid />{t('library.grid')}</ToggleGroupItem>
        </ToggleGroup>
      </div>
      {view === 'grid' ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-3" data-testid="files-grid">
          {files.map((f) => (
            <div key={f.rel_path} className="group relative grid content-start gap-2 rounded-2xl bg-card p-2 shadow-card" data-testid="file-tile" data-kind={f.kind} data-packed={packedEntry(f)}>
              {preview(f, 'aspect-square w-full overflow-hidden rounded-lg')}
              <div className="grid min-w-0 gap-0.5 px-1 pb-1">
                <div className="truncate text-[13px] font-bold" title={f.rel_path}>{f.name}</div>
                <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                  <span className="truncate">{f.slicer ?? t(`project.fileRole.${f.kind}`)}</span><span>·</span><span className="shrink-0 tabular">{formatBytes(f.size, i18n.language)}</span>
                </div>
              </div>
              <div className="absolute right-3.5 top-3.5 flex gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                <Button size="icon-sm" variant="secondary" disabled={offline} onClick={() => void open(f.rel_path)} title={t('project.openInApp')} aria-label={`${t('project.openInApp')}: ${f.name}`}><ExternalLink /></Button>
                {deleteButton(f, 'secondary')}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl bg-card shadow-card">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border text-left text-[11px] font-bold uppercase tracking-wider text-muted-foreground"><th className="px-4 py-2.5">{t('library.columns.title')}</th><th className="px-3 py-2.5">{t('project.fileRole.other')}</th><th className="px-3 py-2.5 text-right">{t('library.columns.size')}</th><th className="px-3 py-2.5 text-right">{t('library.columns.modified')}</th><th /></tr></thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.rel_path} className="border-b border-border last:border-0 hover:bg-secondary/50" data-testid="file-row" data-packed={packedEntry(f)}>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-3">
                      <div className="w-11 shrink-0">{preview(f, 'aspect-square w-full overflow-hidden rounded-lg')}</div>
                      <div className="min-w-0"><div className="font-bold">{f.name} {f.slicer && <Badge variant="accent" className="ml-1">{f.slicer}</Badge>}</div>{f.rel_path !== f.name && <div className="font-mono text-[11px] text-muted-foreground">{f.rel_path}</div>}</div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5"><Badge variant={f.kind === 'model' ? 'accent' : f.kind === 'attachment' ? 'outline' : 'default'}>{t(`project.fileRole.${f.kind}`)}</Badge></td>
                  <td className="px-3 py-2.5 text-right text-muted-foreground tabular">{formatBytes(f.size, i18n.language)}</td>
                  <td className="px-3 py-2.5 text-right text-muted-foreground tabular">{formatDate(f.modified, i18n.language)}</td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" disabled={offline} onClick={() => void open(f.rel_path)} title={t('project.openInApp')}><ExternalLink />{t('project.openInApp')}</Button>
                    {deleteButton(f, 'ghost')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {packed
        ? <p className="px-1 text-xs text-muted-foreground" data-testid="packed-hint">{t('project.packedHint', { archive: packed })}</p>
        : files.some((f) => f.kind === 'attachment') && <p className="px-1 text-xs text-muted-foreground">{t('project.attachmentHint')}</p>}
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
