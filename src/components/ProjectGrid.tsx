import { useCallback, useRef, useState } from 'react';
import { Grid } from 'react-window';
import { useTranslation } from 'react-i18next';

interface ProjectItem {
  id: number;
  name: string;
  path: string;
  has_yaml: number;
  root_path: string;
}

interface ProjectGridProps {
  projects: ProjectItem[];
  onSelect: (project: ProjectItem) => void;
  selectedId?: number;
  thumbnailSize?: number;
}

const MIN_THUMB = 120;
const MAX_THUMB = 320;
const GAP = 8;

interface CellProps {
  projects: ProjectItem[];
  columns: number;
  onSelect: (p: ProjectItem) => void;
  selectedId?: number;
  thumbSize: number;
}

function ProjectCell({
  columnIndex,
  rowIndex,
  style,
  projects,
  columns,
  onSelect,
  selectedId,
  thumbSize,
}: {
  columnIndex: number;
  rowIndex: number;
  style: React.CSSProperties;
} & CellProps): React.JSX.Element | null {
  const index = rowIndex * columns + columnIndex;

  if (index >= projects.length) return null;

  const project = projects[index];
  const isSelected = project.id === selectedId;

  return (
    <div style={style}>
      <button
        className={`group flex h-full w-full flex-col items-center rounded-lg border p-2 text-left transition-colors hover:bg-accent ${
          isSelected ? 'border-primary bg-accent' : 'border-border'
        }`}
        onClick={() => onSelect(project)}
        data-testid={`project-card-${project.id}`}
      >
        <div
          className="flex w-full items-center justify-center rounded-md bg-muted"
          style={{ height: thumbSize - 40 }}
        >
          <span className="text-3xl text-muted-foreground">📦</span>
        </div>
        <p className="mt-1 w-full truncate text-center text-xs font-medium">{project.name}</p>
      </button>
    </div>
  );
}

export default function ProjectGrid({
  projects,
  onSelect,
  selectedId,
  thumbnailSize = 180,
}: ProjectGridProps): React.JSX.Element {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(800);
  const [thumbSize, setThumbSize] = useState(thumbnailSize);

  const columns = Math.max(1, Math.floor((containerWidth + GAP) / (thumbSize + GAP)));
  const rows = Math.ceil(projects.length / columns);

  const measureContainer = useCallback((node: HTMLDivElement | null) => {
    if (node) {
      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          setContainerWidth(entry.contentRect.width);
        }
      });
      observer.observe(node);
      setContainerWidth(node.clientWidth);
      containerRef.current = node;
    }
  }, []);

  if (projects.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center" data-testid="project-grid-empty">
        <p className="text-muted-foreground">{t('library.noProjects')}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col" data-testid="project-grid">
      <div className="mb-2 flex items-center gap-2 px-1">
        <label className="text-xs text-muted-foreground">{t('library.thumbnailSize')}</label>
        <input
          type="range"
          min={MIN_THUMB}
          max={MAX_THUMB}
          value={thumbSize}
          onChange={(e) => setThumbSize(Number(e.target.value))}
          className="w-32"
          data-testid="thumbnail-slider"
        />
      </div>
      <div ref={measureContainer} className="flex-1">
        {containerWidth > 0 && (
          <Grid<CellProps>
            cellComponent={ProjectCell}
            cellProps={{ projects, columns, onSelect, selectedId, thumbSize }}
            columnCount={columns}
            columnWidth={thumbSize + GAP}
            rowCount={rows}
            rowHeight={thumbSize + GAP}
            overscanCount={3}
            style={{ width: containerWidth, height: 600 }}
          />
        )}
      </div>
    </div>
  );
}
