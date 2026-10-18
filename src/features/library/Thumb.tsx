import { Archive, Box, FileText, Image as ImageIcon } from 'lucide-react';
import type { FileKind } from '@/lib/types';
import { useThumbnail } from '@/lib/thumbs/useThumbnail';
import { useThumbs } from '@/lib/thumbs/queue';
import { cn } from '@/lib/utils';

interface Props {
  /** Cache key from the summary; a key produced in this session wins while lists refetch. */
  thumb?: string | null;
  projectId?: string;
  kind?: FileKind;
  className?: string;
  children?: React.ReactNode;
}

/** Project preview: the cached PNG when there is one, otherwise a quiet glyph on the Gallery gradient. */
export function Thumb({ thumb, projectId, kind = 'model', className, children }: Props) {
  const fresh = useThumbs((s) => (projectId ? s.fresh[projectId] : undefined));
  const url = useThumbnail(thumb ?? fresh ?? null);
  const Icon = kind === 'image' ? ImageIcon : kind === 'document' ? FileText : kind === 'attachment' ? Archive : Box;
  return (
    <div className={cn('relative thumb-bg text-thumb', className)}>
      {url ? (
        <img src={url} alt="" draggable={false} data-testid="thumb-img" className="absolute inset-0 size-full object-contain p-[6%] animate-in fade-in-0 duration-300" />
      ) : (
        <Icon className="absolute inset-0 m-auto size-[38%] opacity-70" strokeWidth={1.4} />
      )}
      {children}
    </div>
  );
}
