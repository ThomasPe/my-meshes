import { Archive, Box, FileText, Image as ImageIcon } from 'lucide-react';
import type { FileKind } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Placeholder until rendered thumbnails land (backlog Epic 3): a quiet glyph on the Gallery gradient. */
export function Thumb({ kind = 'model', className, children }: { kind?: FileKind; className?: string; children?: React.ReactNode }) {
  const Icon = kind === 'image' ? ImageIcon : kind === 'document' ? FileText : kind === 'attachment' ? Archive : Box;
  return (
    <div className={cn('relative thumb-bg text-thumb', className)}>
      <Icon className="absolute inset-0 m-auto size-[38%] opacity-70" strokeWidth={1.4} />
      {children}
    </div>
  );
}
