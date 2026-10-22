import { Check, CloudOff, FileBox, Star } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { ProjectMenu, type ProjectActions } from '@/features/library/ProjectMenu';
import { Thumb } from '@/features/library/Thumb';
import { formatBytes, formatDate, initials } from '@/lib/format';
import type { ProjectSummary } from '@/lib/types';
import { Truncated } from '@/components/ui/truncated';
import { cn } from '@/lib/utils';

interface Props {
  project: ProjectSummary;
  selected: boolean;
  /** Current selection (summaries), so the context menu can act on all of it. */
  selection?: ProjectSummary[];
  onSelect: (e: React.MouseEvent) => void;
  onOpen: () => void;
  onTag: (tag: string) => void;
  actions: ProjectActions;
}

export const ProjectCard = memo(function ProjectCard({ project: p, selected, selection, onSelect, onOpen, onTag, actions }: Props) {
  const { t, i18n } = useTranslation();
  return (
    <ProjectMenu project={p} selection={selection} actions={actions}>
      <article
        data-testid="project-card"
        data-id={p.id}
        aria-selected={selected}
        tabIndex={0}
        onClick={onSelect}
        onContextMenu={(e) => { if (!selected) onSelect(e); }}
        onDoubleClick={onOpen}
        onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); if (e.key === ' ') { e.preventDefault(); onSelect(e as unknown as React.MouseEvent); } }}
        className={cn('group relative flex h-full flex-col overflow-hidden rounded-2xl border-2 border-transparent bg-card shadow-card outline-none transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-card-hover focus-visible:border-ring', selected && 'border-primary', p.offline && 'opacity-75')}
      >
        <Thumb thumb={p.thumb} projectId={p.id} className="aspect-square shrink-0">
          <span className={cn('absolute left-3 top-3 grid size-5.5 place-items-center rounded-full bg-card text-primary opacity-0 shadow-card transition-opacity group-hover:opacity-100', selected && 'bg-primary text-primary-foreground opacity-100')}><Check className="size-3.5" /></span>
          <button
            type="button"
            data-testid="card-favorite"
            aria-pressed={p.favorite}
            aria-label={p.favorite ? t('favorites.remove') : t('favorites.add')}
            onClick={(e) => { e.stopPropagation(); actions.toggleFavorite(p); }}
            onDoubleClick={(e) => e.stopPropagation()}
            className={cn('absolute bottom-2.5 right-2.5 grid size-7 place-items-center rounded-full bg-card/90 text-muted-foreground opacity-0 shadow-card transition-opacity hover:text-warning group-hover:opacity-100 focus-visible:opacity-100', p.favorite && 'text-warning opacity-100')}
          >
            <Star className={cn('size-4', p.favorite && 'fill-current')} />
          </button>
          <span className="absolute right-2.5 top-2.5 flex gap-1">
            {p.offline && <Badge variant="outline"><CloudOff />{t('library.offline')}</Badge>}
            {p.slicer && <Badge variant="accent" title={p.slicer} data-testid="slicer-badge">{t('library.slicerProject')}</Badge>}
            {p.file_count > 1 && <Badge><FileBox />{p.file_count}</Badge>}
          </span>
        </Thumb>
        <div className="grid gap-1.5 p-3.5">
          <Truncated as="h4" text={p.title} className="text-[15px] font-extrabold tracking-tight" />
          <div className="flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground">
            {p.creator ? <button type="button" className="flex min-w-0 items-center gap-1.5 hover:text-foreground" title={t('library.filterByCreator', { creator: p.creator })} onClick={(e) => { e.stopPropagation(); actions.filterByCreator(p.creator!); }} onDoubleClick={(e) => e.stopPropagation()} data-testid="card-creator"><span className="grid size-4.5 place-items-center rounded-full bg-accent text-[9px] font-extrabold text-accent-foreground">{initials(p.creator)}</span><span className="truncate">{p.creator}</span></button> : <span className="italic">{t('library.unknownCreator')}</span>}
          </div>
          <div className="flex min-h-5.5 flex-wrap gap-1.5">
            {p.tags.slice(0, 3).map((tag) => (
              <button key={tag} type="button" onClick={(e) => { e.stopPropagation(); onTag(tag); }} className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-semibold text-secondary-foreground hover:bg-accent hover:text-accent-foreground">{tag}</button>
            ))}
            {p.tags.length > 3 && <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold text-muted-foreground">+{p.tags.length - 3}</span>}
          </div>
          <div className="flex justify-between text-xs font-semibold text-muted-foreground/80 tabular">
            <span>{formatBytes(p.total_bytes, i18n.language)}</span>
            <span>{formatDate(p.modified, i18n.language)}</span>
          </div>
        </div>
      </article>
    </ProjectMenu>
  );
});
