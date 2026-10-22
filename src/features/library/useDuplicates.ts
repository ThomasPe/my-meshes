import { create } from 'zustand';
import { getBackend } from '@/lib/backend';
import { reportError } from '@/lib/errors';
import type { DuplicateReport, HashProgress } from '@/lib/types';

/** Last duplicate report and the running scan (LIB-8). One instance for sidebar and view. */
interface DupState {
  report: DuplicateReport | null;
  scanning: boolean;
  progress: HashProgress | null;
  scannedAt: number | null;
  scan: () => Promise<void>;
}

export const useDuplicates = create<DupState>((set, get) => ({
  report: null,
  scanning: false,
  progress: null,
  scannedAt: null,
  scan: async () => {
    if (get().scanning) return;
    set({ scanning: true, progress: null });
    let off: (() => void) | null = null;
    try {
      const b = await getBackend();
      off = await b.onDuplicateProgress((p) => set({ progress: p }));
      const report = await b.findDuplicates();
      set({ report, scannedAt: Date.now() });
    } catch (e) {
      reportError(e);
    } finally {
      off?.();
      set({ scanning: false, progress: null });
    }
  },
}));
