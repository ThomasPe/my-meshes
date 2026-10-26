import { create } from 'zustand';
import type { SortKey } from '@/lib/types';

export type LibraryFilter =
  | { kind: 'all' }
  | { kind: 'recent' }
  | { kind: 'favorites' }
  | { kind: 'duplicates' }
  | { kind: 'creators' }
  | { kind: 'root'; rootId: string }
  | { kind: 'folder'; rootId: string; path: string }
  | { kind: 'inbox'; rootId: string }
  | { kind: 'collection'; id: string }
  | { kind: 'smart'; id: string };
export type ViewMode = 'grid' | 'list';

interface UiState {
  filter: LibraryFilter;
  tags: string[];
  text: string;
  creator: string | null;
  license: string | null;
  material: string | null;
  fileType: string | null;
  sort: SortKey;
  view: ViewMode;
  tile: number;
  selected: string[];
  setFilter: (f: LibraryFilter) => void;
  toggleTag: (t: string) => void;
  removeTag: (t: string) => void;
  setText: (t: string) => void;
  setCreator: (c: string | null) => void;
  setLicense: (c: string | null) => void;
  setMaterial: (c: string | null) => void;
  setFileType: (c: string | null) => void;
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
  creator: null,
  license: null,
  material: null,
  fileType: null,
  sort: persisted.sort ?? 'modified',
  view: persisted.view ?? 'grid',
  tile: persisted.tile ?? 230,
  selected: [],
  setFilter: (filter) => set({ filter, selected: [] }),
  toggleTag: (t) => set((s) => ({ tags: s.tags.includes(t) ? s.tags.filter((x) => x !== t) : [...s.tags, t] })),
  removeTag: (t) => set((s) => ({ tags: s.tags.filter((x) => x !== t) })),
  setText: (text) => set({ text }),
  setCreator: (creator) => set({ creator, selected: [] }),
  setLicense: (license) => set({ license, selected: [] }),
  setMaterial: (material) => set({ material, selected: [] }),
  setFileType: (fileType) => set({ fileType, selected: [] }),
  setSort: (sort) => { persist({ sort }); set({ sort }); },
  setView: (view) => { persist({ view }); set({ view }); },
  setTile: (tile) => { persist({ tile }); set({ tile }); },
  select: (selected) => set({ selected }),
  clearFilters: () => set({ tags: [], text: '', creator: null, license: null, material: null, fileType: null }),
}));

/** OS notifications for background work (APP-4); a per-machine preference, so it lives in localStorage. */
export function loadNotifications(): boolean {
  try { return localStorage.getItem('mm.notify') !== '0'; } catch { return true; }
}
export function saveNotifications(on: boolean) {
  try { localStorage.setItem('mm.notify', on ? '1' : '0'); } catch { /* ignore */ }
}

export type Theme = 'light' | 'dark' | 'system';
export function applyTheme(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  try { localStorage.setItem('mm.theme', theme); } catch { /* ignore */ }
}
export function loadTheme(): Theme {
  try { return (localStorage.getItem('mm.theme') as Theme) || 'system'; } catch { return 'system'; }
}

/**
 * Which tree rows are expanded (root id, or `root:rel_path`), remembered across collapses
 * of the root and across restarts like Explorer does. Rows without an entry use their
 * default (root and first level open, deeper levels closed).
 */
interface TreeState {
  open: Record<string, boolean>;
  setOpen: (key: string, open: boolean) => void;
}
const treePersisted = (() => { try { const v = JSON.parse(localStorage.getItem('mm.tree') ?? '{}'); return v && typeof v === 'object' ? (v as Record<string, boolean>) : {}; } catch { return {}; } })();
export const useTree = create<TreeState>((set) => ({
  open: treePersisted,
  setOpen: (key, open) => set((s) => { const next = { ...s.open, [key]: open }; try { localStorage.setItem('mm.tree', JSON.stringify(next)); } catch { /* ignore */ } return { open: next }; }),
}));
