import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useRef, useState } from 'react';
import { ProjectCard } from '@/features/library/ProjectCard';
import type { ProjectSummary } from '@/lib/types';

interface Props {
  projects: ProjectSummary[];
  tile: number;
  selected: Set<string>;
  onSelect: (id: string, e: React.MouseEvent) => void;
  onOpen: (id: string) => void;
  onTag: (tag: string) => void;
}

const GAP = 18;
const META_HEIGHT = 112;

/** Virtualized by row: TanStack Virtual measures rows, each row renders `columns` cards. */
export function ProjectGrid({ projects, tile, selected, onSelect, onOpen, onTag }: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
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
  const virt = useVirtualizer({ count: rows, getScrollElement: () => parentRef.current, estimateSize: () => rowHeight, overscan: 3 });
  useEffect(() => { virt.measure(); }, [rowHeight, virt]);

  return (
    <div ref={parentRef} className="h-full overflow-auto px-5 pb-6 pt-3" data-testid="project-grid">
      <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
        {virt.getVirtualItems().map((row) => (
          <div key={row.key} data-index={row.index} ref={virt.measureElement} className="absolute left-0 top-0 grid w-full" style={{ transform: `translateY(${row.start}px)`, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: GAP, paddingBottom: GAP }}>
            {projects.slice(row.index * columns, row.index * columns + columns).map((p) => (
              <ProjectCard key={p.id} project={p} selected={selected.has(p.id)} onSelect={(e) => onSelect(p.id, e)} onOpen={() => onOpen(p.id)} onTag={onTag} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
