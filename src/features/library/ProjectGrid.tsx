import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useRef, useState } from 'react';
import { ProjectCard } from '@/features/library/ProjectCard';
import type { ProjectActions } from '@/features/library/ProjectMenu';
import type { ProjectSummary } from '@/lib/types';

interface Props {
  projects: ProjectSummary[];
  tile: number;
  selected: Set<string>;
  onSelect: (id: string, e: React.MouseEvent) => void;
  onOpen: (id: string) => void;
  onTag: (tag: string) => void;
  actions: ProjectActions;
  /** When set, cards can be dragged to reorder (manual collections). */
  onReorder?: (ids: string[]) => void;
}

const GAP = 18;
const META_HEIGHT = 112;

/** Virtualized by row: TanStack Virtual measures rows, each row renders `columns` cards. */
export function ProjectGrid({ projects, tile, selected, onSelect, onOpen, onTag, actions, onReorder }: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const drop = (targetId: string) => {
    if (!onReorder || !dragId || dragId === targetId) { setDragId(null); setOverId(null); return; }
    const ids = projects.map((p) => p.id);
    const from = ids.indexOf(dragId), to = ids.indexOf(targetId);
    ids.splice(from, 1);
    ids.splice(to, 0, dragId);
    onReorder(ids);
    setDragId(null); setOverId(null);
  };
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const inner = Math.max(width - 40, tile);
  const columns = Math.max(1, Math.floor((inner + GAP) / (tile + GAP)));
  const cardWidth = (inner - GAP * (columns - 1)) / columns;
  const rowHeight = cardWidth + META_HEIGHT + GAP;
  const rows = Math.ceil(projects.length / columns);
  // Rows are measured by the virtualizer's ResizeObserver; `estimateSize` only seeds unmeasured
  // rows. Calling `virt.measure()` on every width change threw the fresh measurements away
  // after the observer had already delivered them, leaving rows at the (shorter) estimate and
  // cards overlapping until the next resize.
  const virt = useVirtualizer({ count: rows, getScrollElement: () => parentRef.current, estimateSize: () => rowHeight, overscan: 3 });

  return (
    <div ref={parentRef} className="h-full overflow-auto px-5 pb-6 pt-3" data-testid="project-grid">
      <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
        {virt.getVirtualItems().map((row) => (
          <div key={row.key} data-index={row.index} ref={virt.measureElement} className="absolute left-0 top-0 grid w-full" style={{ transform: `translateY(${row.start}px)`, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: GAP, paddingBottom: GAP }}>
            {projects.slice(row.index * columns, row.index * columns + columns).map((p) => (
              <div key={p.id} draggable={!!onReorder} data-testid={onReorder ? 'reorder-handle' : undefined} className={overId === p.id && dragId !== p.id ? 'rounded-2xl outline outline-2 outline-primary' : undefined}
                onDragStart={(e) => { if (!onReorder) return; setDragId(p.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', p.id); }}
                onDragOver={(e) => { if (!onReorder || !dragId) return; e.preventDefault(); if (overId !== p.id) setOverId(p.id); }}
                onDragLeave={() => { if (overId === p.id) setOverId(null); }}
                onDrop={(e) => { if (!onReorder) return; e.preventDefault(); drop(p.id); }}
                onDragEnd={() => { setDragId(null); setOverId(null); }}>
                <ProjectCard project={p} selected={selected.has(p.id)} onSelect={(e) => onSelect(p.id, e)} onOpen={() => onOpen(p.id)} onTag={onTag} actions={actions} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
