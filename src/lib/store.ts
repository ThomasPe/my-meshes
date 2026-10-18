import { create } from 'zustand';
import type { SortKey } from '@/lib/types';

export type LibraryFilter = { kind: 'all' } | { kind: 'recent' } | { kind: 'favorites' } | { kind: 'root'; rootId: string } | { kind: 'folder'; rootId: string; path: string };
export type ViewMode = 'grid' | 'list';

interface UiState {
  filter: LibraryFilter;
  tags: string[];
  text: string;
  sort: SortKey;
  view: ViewMode;
  tile: number;
  selected: string[];
  setFilter: (f: LibraryFilter) => void;
  toggleTag: (t: string) => void;
  removeTag: (t: string) => void;
  setText: (t: string) => void;
  setSort: (s: SortKey) => void;
  setView: (v: ViewMode) => void;
  setTile: (n: number) => void;
  select: (ids: string[]) => void;
  clearFilters: () => void;
}

const persisted = (() => { try { return JSON.parse(localStorage.getItem('mm.ui') ?? '{}') as Partial<Pick<UiState, 'view' | 'tile' | 'sort'>>; } catch { return {}; } })();
const persist = (s: Partial<Pick<UiState, 'view' | 'tile' | 'sort'>>) => { try { const cur = JSON.parse(localStorage.getItem('mm.ui') ?? '{}'); localStorage.setItem('mm.ui', JSON.stringify({ ...cur, ...s })); } catch { /* ignore */ } };

export const useUi = create<UiState>((set) => ({
  filter: { kind: 'all' },
  tags: [],
  text: '',
  sort: persisted.sort ?? 'modified',
  view: persisted.view ?? 'grid',
  tile: persisted.tile ?? 230,
  selected: [],
  setFilter: (filter) => set({ filter, selected: [] }),
  toggleTag: (t) => set((s) => ({ tags: s.tags.includes(t) ? s.tags.filter((x) => x !== t) : [...s.tags, t] })),
  removeTag: (t) => set((s) => ({ tags: s.tags.filter((x) => x !== t) })),
  setText: (text) => set({ text }),
  setSort: (sort) => { persist({ sort }); set({ sort }); },
  setView: (view) => { persist({ view }); set({ view }); },
  setTile: (tile) => { persist({ tile }); set({ tile }); },
  select: (selected) => set({ selected }),
  clearFilters: () => set({ tags: [], text: '' }),
}));

export type Theme = 'light' | 'dark' | 'system';
export function applyTheme(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  try { localStorage.setItem('mm.theme', theme); } catch { /* ignore */ }
}
export function loadTheme(): Theme {
  try { return (localStorage.getItem('mm.theme') as Theme) || 'system'; } catch { return 'system'; }
}
