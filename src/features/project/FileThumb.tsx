import { Box } from 'lucide-react';
import { useRef, type ReactNode } from 'react';
import { extOf } from '@/lib/mesh';
import { canRender } from '@/lib/thumbs/files';
import { useFileThumb, type FileThumbListing } from '@/lib/thumbs/useFileThumb';
import { useThumbnail } from '@/lib/thumbs/useThumbnail';
import type { FileEntry } from '@/lib/types';
import { useSeen } from '@/lib/useSeen';
import { cn } from '@/lib/utils';

interface Props {
  projectId: string;
  file: FileEntry;
  listing: FileThumbListing;
  /** The root is not reachable: cached previews still show, nothing new is rendered. */
  offline?: boolean;
  className?: string;
  children?: ReactNode;
}

/** VIEW-8: the preview of one model file. Rendered the first time the tile is seen, cached
 * by the engine afterwards. Formats the app cannot draw show their extension instead. */
export function FileThumb({ projectId, file, listing, offline = false, className, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useSeen(ref);
  const thumb = useFileThumb(projectId, file, listing, seen && !offline);
  const url = useThumbnail(thumb.key, thumb.rev);
  return (
    <div ref={ref} className={cn('relative thumb-bg text-thumb', className)} data-testid="file-thumb" data-state={thumb.state}>
      {url
        ? <img src={url} alt="" draggable={false} data-testid="file-thumb-img" className="absolute inset-0 size-full object-contain p-[6%] animate-in fade-in-0 duration-300" />
        : <Box className={cn('absolute inset-0 m-auto size-[38%] opacity-70', thumb.state === 'pending' && 'animate-pulse')} strokeWidth={1.4} />}
      {!url && !canRender(file.name) && <span className="absolute inset-x-0 bottom-[8%] truncate px-1 text-center text-[9px] font-extrabold uppercase tracking-wider opacity-70">{extOf(file.name)}</span>}
      {children}
    </div>
  );
}
