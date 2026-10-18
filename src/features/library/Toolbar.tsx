import { Image as ImageIcon, LayoutGrid, List, RefreshCw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useUi } from '@/lib/store';
import type { SortKey } from '@/lib/types';

export function Toolbar({ title, count, onRescan, scanning }: { title: string; count: number; onRescan?: () => void; scanning?: boolean }) {
  const { t } = useTranslation();
  const { tags, removeTag, text, setText, sort, setSort, view, setView, tile, setTile } = useUi();
  return (
    <div className="flex flex-wrap items-center gap-2 px-5 pb-2 pt-3.5" data-testid="toolbar">
      <h1 className="mr-1 truncate text-lg font-extrabold tracking-tight">{title}</h1>
      <span className="text-sm font-semibold text-muted-foreground tabular" data-testid="result-count">{count}</span>
      {tags.map((tag) => (
        <span key={tag} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-accent px-3 text-[13px] font-bold text-accent-foreground" data-testid="tag-chip">
          {tag}<button type="button" aria-label={`remove ${tag}`} onClick={() => removeTag(tag)} className="rounded-full p-0.5 opacity-70 hover:bg-black/10 hover:opacity-100"><X className="size-3.5" /></button>
        </span>
      ))}
      {text && (
        <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-accent px-3 text-[13px] font-bold text-accent-foreground">“{text}”<button type="button" aria-label="clear search" onClick={() => setText('')} className="rounded-full p-0.5 opacity-70 hover:bg-black/10 hover:opacity-100"><X className="size-3.5" /></button></span>
      )}
      <div className="ml-auto flex items-center gap-2">
        <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
          <SelectTrigger size="sm" data-testid="sort"><span className="text-muted-foreground">{t('library.sort')}</span><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="modified">{t('library.sortModified')}</SelectItem>
            <SelectItem value="title">{t('library.sortTitle')}</SelectItem>
            <SelectItem value="creator">{t('library.sortCreator')}</SelectItem>
            <SelectItem value="size">{t('library.sortSize')}</SelectItem>
          </SelectContent>
        </Select>
        <ToggleGroup type="single" value={view} onValueChange={(v) => v && setView(v as 'grid' | 'list')} aria-label="view">
          <ToggleGroupItem value="grid" data-testid="view-grid"><LayoutGrid />{t('library.grid')}</ToggleGroupItem>
          <ToggleGroupItem value="list" data-testid="view-list"><List />{t('library.list')}</ToggleGroupItem>
        </ToggleGroup>
        {view === 'grid' && (
          <label className="flex items-center gap-2 text-muted-foreground" title={t('library.zoom')}>
            <ImageIcon className="size-4" />
            <Slider className="w-24" min={150} max={340} step={10} value={[tile]} onValueChange={([v]) => v && setTile(v)} aria-label={t('library.zoom')} />
          </label>
        )}
        {onRescan && <Button variant="outline" size="sm" onClick={onRescan} disabled={scanning} data-testid="rescan"><RefreshCw className={scanning ? 'animate-spin' : ''} />{t('library.rescan')}</Button>}
      </div>
    </div>
  );
}
