import { ChevronLeft, ChevronRight, ExternalLink, Image as ImageIcon, ImageUp, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { getBackend } from '@/lib/backend';
import { reportError } from '@/lib/errors';
import { formatBytes } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { useChooseThumbnail } from '@/features/project/useChooseThumbnail';
import { VIEW_PREVIEW_REL } from '@/lib/thumbs/queue';
import type { FileEntry, Project } from '@/lib/types';
import { cn } from '@/lib/utils';

const urls = new Map<string, string>(); // `${projectId}/${rel}` -> object URL (session cache)

/** Loads one project image through the backend and returns an object URL. */
export function useProjectImage(projectId: string, rel: string | null, enabled = true): string | null {
  const key = rel ? `${projectId}/${rel}` : '';
  const [url, setUrl] = useState<string | null>(() => (key ? urls.get(key) ?? null : null));
  useEffect(() => {
    if (!key || !enabled) { setUrl(null); return; }
    const hit = urls.get(key);
    if (hit) { setUrl(hit); return; }
    let alive = true;
    getBackend()
      .then((b) => b.readProjectFile(projectId, rel!))
      .then((bytes) => { const u = URL.createObjectURL(new Blob([bytes])); urls.set(key, u); if (alive) setUrl(u); })
      .catch(() => { if (alive) setUrl(null); });
    return () => { alive = false; };
  }, [key, projectId, rel, enabled]);
  return url;
}

function Tile({ projectId, file, current, onOpen, onChoose }: { projectId: string; file: FileEntry; current: boolean; onOpen: () => void; onChoose: () => void }) {
  const { t, i18n } = useTranslation();
  const url = useProjectImage(projectId, file.rel_path);
  const captured = file.rel_path === VIEW_PREVIEW_REL;
  return (
    <div className="group relative grid gap-1.5 text-left" data-testid="image-tile" data-current={current || undefined}>
      <button type="button" onClick={onOpen} className="relative block aspect-[4/3] overflow-hidden rounded-xl bg-secondary shadow-card">
        {url ? <img src={url} alt={file.name} className="size-full object-cover transition-transform group-hover:scale-[1.03]" loading="lazy" /> : <ImageIcon className="absolute inset-0 m-auto size-8 text-muted-foreground" />}
      </button>
      {current
        ? <Badge variant="accent" className="absolute left-2 top-2" data-testid="thumbnail-badge"><ImageUp />{t('project.thumbnailCurrent')}</Badge>
        : <Button size="sm" variant="secondary" className="absolute left-2 top-2 opacity-0 shadow-card transition-opacity focus-visible:opacity-100 group-hover:opacity-100" onClick={onChoose} data-testid="use-as-thumbnail"><ImageUp />{t('project.useAsThumbnail')}</Button>}
      <span className="truncate text-xs font-semibold">{captured ? t('project.viewCapture') : file.name}</span>
      <span className="text-[11px] text-muted-foreground tabular">{formatBytes(file.size, i18n.language)}</span>
    </div>
  );
}

/** Built-in image viewer (VIEW-5): tile grid plus a lightbox with keyboard navigation. The
 * preview (VIEW-4) is chosen here: any image of the project, or back to the automatic choice. */
export function ImageGallery({ project, files, offline }: { project: Project; files: FileEntry[]; offline: boolean }) {
  const { t } = useTranslation();
  const projectId = project.id;
  const choose = useChooseThumbnail(project);
  const images = files.filter((f) => f.kind === 'image');
  const [index, setIndex] = useState<number | null>(null);
  const current = index !== null ? images[index] ?? null : null;
  const url = useProjectImage(projectId, current?.rel_path ?? null);
  useEffect(() => {
    if (index === null) return;
    const on = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setIndex((i) => (i === null ? i : (i + 1) % images.length));
      if (e.key === 'ArrowLeft') setIndex((i) => (i === null ? i : (i - 1 + images.length) % images.length));
    };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, [index, images.length]);
  if (images.length === 0) return <p className="rounded-2xl bg-card p-6 text-sm text-muted-foreground shadow-card">{t('project.noImages')}</p>;
  if (offline) return <p className="rounded-2xl bg-card p-6 text-sm text-muted-foreground shadow-card">{t('errors.root_offline')}</p>;
  const openOs = (rel: string) => getBackend().then((b) => b.openProjectFile(projectId, rel)).catch(reportError);
  return (
    <>
      <div className="grid gap-3 rounded-2xl bg-card p-4 shadow-card" data-testid="image-gallery">
        {project.thumbnail && (
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-muted-foreground">
            <ImageUp className="size-3.5 text-primary" />
            <span>{t('project.thumbnailIs', { name: project.thumbnail === VIEW_PREVIEW_REL ? t('project.viewCapture') : project.thumbnail })}</span>
            <Button size="sm" variant="ghost" className="h-7" onClick={() => void choose.useImage(null)} data-testid="thumbnail-auto">{t('project.chooseAutomatically')}</Button>
          </div>
        )}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
          {images.map((f, i) => <Tile key={f.rel_path} projectId={projectId} file={f} current={project.thumbnail === f.rel_path} onOpen={() => setIndex(i)} onChoose={() => void choose.useImage(f.rel_path)} />)}
        </div>
      </div>
      <Dialog open={index !== null} onOpenChange={(o) => !o && setIndex(null)}>
        <DialogContent className="max-w-[min(96vw,1400px)] border-0 bg-black/90 p-0 text-white shadow-none" data-testid="lightbox">
          <DialogTitle className="sr-only">{current?.name}</DialogTitle>
          <DialogDescription className="sr-only">{t('project.images')}</DialogDescription>
          <div className="relative grid h-[min(88vh,900px)] grid-rows-[1fr_auto]">
            <div className="relative grid place-items-center overflow-hidden">
              {url ? <img src={url} alt={current?.name ?? ''} className="max-h-full max-w-full object-contain" data-testid="lightbox-img" /> : <ImageIcon className="size-10 opacity-60" />}
              {images.length > 1 && (
                <>
                  <button type="button" aria-label="previous" className={cn('absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-white/15 p-2 hover:bg-white/30')} onClick={() => setIndex((i) => (i === null ? i : (i - 1 + images.length) % images.length))}><ChevronLeft /></button>
                  <button type="button" aria-label="next" className={cn('absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/15 p-2 hover:bg-white/30')} onClick={() => setIndex((i) => (i === null ? i : (i + 1) % images.length))} data-testid="lightbox-next"><ChevronRight /></button>
                </>
              )}
            </div>
            <div className="flex items-center gap-3 px-4 py-3 text-sm">
              <span className="truncate font-semibold" data-testid="lightbox-name">{current?.name}</span>
              <span className="text-white/60 tabular">{t('project.imageOf', { index: (index ?? 0) + 1, total: images.length })}</span>
              <span className="ml-auto flex gap-2">
                <Button size="sm" variant="ghost" className="text-white hover:bg-white/15 hover:text-white" onClick={() => current && void openOs(current.rel_path)}><ExternalLink />{t('project.openInApp')}</Button>
                <Button size="icon-sm" variant="ghost" className="text-white hover:bg-white/15 hover:text-white" aria-label={t('common.close')} onClick={() => setIndex(null)}><X /></Button>
              </span>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
