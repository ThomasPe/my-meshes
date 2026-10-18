import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, Star } from 'lucide-react';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { ProjectMenu, type ProjectActions } from '@/features/library/ProjectMenu';
import { Thumb } from '@/features/library/Thumb';
import { formatBytes, formatDate } from '@/lib/format';
import type { ProjectSummary, SortKey } from '@/lib/types';
import { cn } from '@/lib/utils';

interface Props {
  projects: ProjectSummary[];
  selected: Set<string>;
  sort: SortKey;
  onSort: (s: SortKey) => void;
  onSelect: (id: string, e: React.MouseEvent) => void;
  onOpen: (id: string) => void;
  onTag: (tag: string) => void;
  actions: ProjectActions;
}

const ROW = 60;

export function ProjectList({ projects, selected, sort, onSort, onSelect, onOpen, onTag, actions }: Props) {
  const { t, i18n } = useTranslation();
  const parentRef = useRef<HTMLDivElement>(null);
  const virt = useVirtualizer({ count: projects.length, getScrollElement: () => parentRef.current, estimateSize: () => ROW, overscan: 10 });
  const cols = 'grid-cols-[56px_minmax(220px,2fr)_minmax(120px,1fr)_minmax(140px,1.4fr)_70px_90px_100px_36px]';
  const Head = ({ k, label, className }: { k?: SortKey; label: string; className?: string }) => (
    <button type="button" disabled={!k} onClick={() => k && onSort(k)} className={cn('flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground disabled:cursor-default', className)}>
      {label}{k && sort === k && <ArrowDown className="size-3" />}
    </button>
  );
  return (
    <div className="flex h-full flex-col px-5 pb-6 pt-3" data-testid="project-list">
      <div className="overflow-hidden rounded-2xl bg-card shadow-card">
        <div className={cn('grid items-center gap-3 border-b border-border px-3 py-2', cols)}>
          <span /><Head k="title" label={t('library.columns.title')} /><Head k="creator" label={t('library.columns.creator')} /><Head label={t('library.columns.tags')} /><Head label={t('library.columns.files')} className="justify-end" /><Head k="size" label={t('library.columns.size')} className="justify-end" /><Head k="modified" label={t('library.columns.modified')} className="justify-end" /><span />
        </div>
        <div ref={parentRef} className="max-h-[calc(100vh-200px)] overflow-auto">
          <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
            {virt.getVirtualItems().map((row) => {
              const p = projects[row.index]!;
              const sel = selected.has(p.id);
              return (
                <ProjectMenu key={p.id} project={p} actions={actions}>
                <div data-testid="project-row" data-id={p.id} aria-selected={sel} tabIndex={0} onClick={(e) => onSelect(p.id, e)} onDoubleClick={() => onOpen(p.id)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(p.id); }}
                  className={cn('absolute left-0 top-0 grid w-full cursor-default items-center gap-3 border-b border-border px-3 text-sm outline-none hover:bg-secondary/60 focus-visible:bg-secondary', cols, sel && 'bg-accent hover:bg-accent')} style={{ height: ROW, transform: `translateY(${row.start}px)` }}>
                  <Thumb thumb={p.thumb} projectId={p.id} className="size-10 overflow-hidden rounded-[10px]" />
                  <div className="min-w-0"><div className="truncate font-bold">{p.title} {p.offline && <Badge variant="outline" className="ml-1">{t('library.offline')}</Badge>}</div><div className="truncate font-mono text-[11px] text-muted-foreground">{p.rel_path || '/'}</div></div>
                  <div className="truncate font-semibold text-secondary-foreground">{p.creator ?? <span className="text-muted-foreground">—</span>}</div>
                  <div className="flex flex-wrap gap-1 overflow-hidden">{p.tags.slice(0, 4).map((tag) => <button key={tag} type="button" onClick={(e) => { e.stopPropagation(); onTag(tag); }} className="rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold hover:bg-accent hover:text-accent-foreground">{tag}</button>)}</div>
                  <div className="text-right text-muted-foreground tabular">{p.file_count}</div>
                  <div className="text-right text-muted-foreground tabular">{formatBytes(p.total_bytes, i18n.language)}</div>
                  <div className="text-right text-muted-foreground tabular">{formatDate(p.modified, i18n.language)}</div>
                  <button type="button" aria-pressed={p.favorite} aria-label={p.favorite ? t('favorites.remove') : t('favorites.add')} onClick={(e) => { e.stopPropagation(); actions.toggleFavorite(p); }} onDoubleClick={(e) => e.stopPropagation()} className={cn('grid size-7 place-items-center justify-self-end rounded-full text-muted-foreground/60 hover:text-warning', p.favorite && 'text-warning')}><Star className={cn('size-4', p.favorite && 'fill-current')} /></button>
                </div>
                </ProjectMenu>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
