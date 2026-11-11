// Previews of single model files (VIEW-8). The project previews are driven by the engine's
// queue; these are made on demand: a tile that scrolls into view asks for its file, the
// request is rendered through the same worker (one rendering at a time) and stored by the
// engine, which answers from its cache from then on. Leaving the project drops what is
// still waiting, so a folder with hundreds of models costs only what was looked at.
import { create } from 'zustand';
import { getBackend } from '@/lib/backend';
import { extOf, PREVIEWABLE } from '@/lib/mesh';
import { exclusive, renderingGone, renderModel, useThumbs } from '@/lib/thumbs/queue';
import { forgetThumbnail } from '@/lib/thumbs/useThumbnail';
import type { FileEntry } from '@/lib/types';

export interface FileThumbEntry {
  key: string | null;
  failed: boolean;
  /** File state the entry belongs to; a changed file is rendered again. */
  stamp: string;
  /** Grows with every stored picture, so one stored under a key already on screen is read again. */
  rev: number;
}
/** What this session produced, so tiles update without waiting for the engine's listing. */
export const useFileThumbStore = create<{ entries: Record<string, FileThumbEntry> }>(() => ({ entries: {} }));

export const fileThumbId = (projectId: string, rel: string) => `${projectId}\n${rel}`;
export const fileStamp = (f: Pick<FileEntry, 'size' | 'modified'>) => `${f.size}@${f.modified}`;
/** Formats the app can draw; other model files (STEP, CAD sources) keep their glyph. */
export const canRender = (name: string) => PREVIEWABLE.has(extOf(name));

interface Job { projectId: string; rel: string; embedded: boolean; stamp: string }
const waiting: Job[] = [];
const asked = new Set<string>(); // id + stamp, waiting or running
let draining = false;
let revs = 0;

const put = (id: string, entry: Omit<FileThumbEntry, 'rev'>) => useFileThumbStore.setState((s) => ({ entries: { ...s.entries, [id]: { ...entry, rev: ++revs } } }));

async function produce(job: Job): Promise<string> {
  const b = await getBackend();
  if (job.embedded) {
    try { return await b.storeEmbeddedFileThumbnail(job.projectId, job.rel); } catch { /* no usable picture inside: render the geometry */ }
  }
  const unavailable = useThumbs.getState().unavailable;
  if (unavailable) throw Object.assign(new Error(unavailable), { fatal: true });
  const bytes = await b.readProjectFile(job.projectId, job.rel);
  const png = await renderModel(bytes, extOf(job.rel));
  return b.storeFileThumbnail(job.projectId, job.rel, png);
}

async function drain() {
  if (draining) return;
  draining = true;
  try {
    for (let job = waiting.shift(); job; job = waiting.shift()) {
      const id = fileThumbId(job.projectId, job.rel);
      try {
        const key = await exclusive(() => produce(job));
        forgetThumbnail(key);
        put(id, { key, failed: false, stamp: job.stamp });
      } catch (e) {
        // without WebGL the file is not at fault: nothing is recorded, a later session tries again
        if (!renderingGone(e)) {
          try { await (await getBackend()).fileThumbnailFailed(job.projectId, job.rel, e instanceof Error ? e.message : String(e)); } catch { /* the file may be gone */ }
        }
        put(id, { key: null, failed: true, stamp: job.stamp });
      } finally {
        asked.delete(`${id}\n${job.stamp}`);
      }
    }
  } finally {
    draining = false;
  }
}

/** Asks for one file's preview; repeated calls for the same file state are free. */
export function requestFileThumb(projectId: string, file: FileEntry) {
  const id = fileThumbId(projectId, file.rel_path);
  const stamp = fileStamp(file);
  const have = useFileThumbStore.getState().entries[id];
  if (asked.has(`${id}\n${stamp}`) || (have && have.stamp === stamp)) return;
  asked.add(`${id}\n${stamp}`);
  waiting.push({ projectId, rel: file.rel_path, embedded: file.embedded_thumbnail, stamp });
  void drain();
}

/** Drops what is still waiting for a project (the page was left); a running job finishes. */
export function cancelFileThumbs(projectId: string) {
  for (let i = waiting.length - 1; i >= 0; i--) {
    const job = waiting[i]!;
    if (job.projectId !== projectId) continue;
    waiting.splice(i, 1);
    asked.delete(`${fileThumbId(projectId, job.rel)}\n${job.stamp}`);
  }
}

/** Forgets what this session knows of a project's file previews ("render again"). */
export function forgetFileThumbs(projectId: string) {
  cancelFileThumbs(projectId);
  useFileThumbStore.setState((s) => {
    const entries: Record<string, FileThumbEntry> = {};
    for (const [id, e] of Object.entries(s.entries)) {
      if (id.startsWith(`${projectId}\n`)) { if (e.key) forgetThumbnail(e.key); } else entries[id] = e;
    }
    return { entries };
  });
}

/** The whole cache was cleared: nothing this session produced exists any more. */
export function forgetAllFileThumbs() {
  for (const job of waiting.splice(0)) asked.delete(`${fileThumbId(job.projectId, job.rel)}\n${job.stamp}`);
  useFileThumbStore.setState({ entries: {} });
}
