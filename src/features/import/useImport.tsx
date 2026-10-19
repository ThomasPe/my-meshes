import { create } from 'zustand';
import { getBackend } from '@/lib/backend';
import { reportError } from '@/lib/errors';
import type { ImportItem, ImportProgress } from '@/lib/types';

/**
 * Import staging state (IMP-1). Opened by a native file drop or the picker; the dialog
 * edits the proposals and confirms. One global instance so a drop works on every page.
 */
interface ImportState {
  open: boolean;
  dragging: boolean;
  analyzing: boolean;
  items: ImportItem[];
  progress: ImportProgress | null;
  openWith: (paths: string[]) => Promise<void>;
  pick: () => Promise<void>;
  setItem: (index: number, patch: Partial<ImportItem>) => void;
  close: () => void;
}

export const useImport = create<ImportState>((set) => ({
  open: false,
  dragging: false,
  analyzing: false,
  items: [],
  progress: null,
  openWith: async (paths) => {
    if (paths.length === 0) return;
    set({ open: true, analyzing: true, items: [], progress: null, dragging: false });
    try {
      const b = await getBackend();
      set({ items: await b.analyzeImport(paths), analyzing: false });
    } catch (e) {
      reportError(e);
      set({ open: false, analyzing: false });
    }
  },
  pick: async () => {
    try {
      const b = await getBackend();
      const paths = await b.pickImportFiles();
      await useImport.getState().openWith(paths);
    } catch (e) {
      reportError(e);
    }
  },
  setItem: (index, patch) => set((s) => ({ items: s.items.map((it, i) => (i === index ? { ...it, ...patch } : it)) })),
  close: () => set({ open: false, items: [], progress: null }),
}));

let wired = false;
/** Subscribes once to native drops and import progress. */
export function wireImportEvents() {
  if (wired) return;
  wired = true;
  getBackend().then(async (b) => {
    await b.onFileDrop((e) => {
      if (e.type === 'enter') useImport.setState({ dragging: true });
      else if (e.type === 'leave') useImport.setState({ dragging: false });
      else void useImport.getState().openWith(e.paths);
    });
    await b.onImportProgress((p) => useImport.setState({ progress: p }));
  });
}
