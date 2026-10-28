// Background thumbnail pipeline (VIEW-3). The engine decides *what* needs a preview
// (`thumbQueue`), this module decides *how*: embedded 3MF previews are extracted by the
// engine, images are cover-fitted, models are parsed and rendered in a worker (or on the
// main thread where workers have no WebGL). Results are written back through
// `storeThumbnail`; failures are recorded so the same file is not retried until it changes.
import { create } from 'zustand';
import { getBackend } from '@/lib/backend';
import { extOf } from '@/lib/mesh';
import type { ThumbJob } from '@/lib/types';
import ThumbWorker from '@/workers/thumb-worker?worker';
import MeshWorker from '@/workers/mesh-worker?worker';
import type { ThumbWorkerResponse } from '@/workers/thumb-worker';

/** Where "use this view as preview" saves its picture inside a project (engine `VIEW_PREVIEW_REL`). */
export const VIEW_PREVIEW_REL = '.meshkeep/preview.png';

export interface ThumbState {
  running: boolean;
  pending: number;
  done: number;
  failed: number;
  /** Rendering is impossible in this environment (no WebGL anywhere); images still work. */
  unavailable: string | null;
  /** Keys produced in this session, so cards update before the list refetches. */
  fresh: Record<string, string>;
}
export const useThumbs = create<ThumbState>(() => ({ running: false, pending: 0, done: 0, failed: 0, unavailable: null, fresh: {} }));

type Mode = 'worker' | 'main' | 'none';
let mode: Mode | null = null;
let worker: Worker | null = null;
let nextId = 1;
const waiting = new Map<number, { res: (png: ArrayBuffer) => void; rej: (e: Error) => void }>();
let mainRenderer: import('@/lib/thumbs/render').ThumbRenderer | null = null;
let mainCanvas: HTMLCanvasElement | null = null;
let loopRunning = false;
let rerun = false;
let onStored: ((projectId: string, key: string) => void) | null = null;

function ensureWorker(): Worker {
  if (!worker) {
    worker = new ThumbWorker();
    worker.onmessage = (e: MessageEvent<ThumbWorkerResponse>) => {
      const m = e.data;
      if (m.type !== 'done') return;
      const w = waiting.get(m.id);
      if (!w) return;
      waiting.delete(m.id);
      if (m.ok) w.res(m.png); else w.rej(Object.assign(new Error(m.error), { fatal: m.fatal }));
    };
    worker.onerror = (e) => { for (const w of waiting.values()) w.rej(new Error(e.message)); waiting.clear(); };
  }
  return worker;
}

/** Decides once where rendering happens: worker (OffscreenCanvas + WebGL), main thread, or nowhere. */
async function detectMode(): Promise<Mode> {
  if (mode) return mode;
  if (typeof OffscreenCanvas !== 'undefined' && typeof Worker !== 'undefined') {
    const w = ensureWorker();
    const ok = await new Promise<boolean>((res) => {
      const t = setTimeout(() => res(false), 8000);
      const on = (e: MessageEvent<ThumbWorkerResponse>) => { if (e.data.type === 'probe') { clearTimeout(t); w.removeEventListener('message', on); res(e.data.ok); } };
      w.addEventListener('message', on);
      w.postMessage({ type: 'probe' });
    });
    if (ok) return (mode = 'worker');
  }
  try {
    const { ThumbRenderer, THUMB_SIZE } = await import('@/lib/thumbs/render');
    mainCanvas = document.createElement('canvas');
    mainCanvas.width = THUMB_SIZE; mainCanvas.height = THUMB_SIZE;
    mainRenderer = new ThumbRenderer(mainCanvas);
    return (mode = 'main');
  } catch (e) {
    useThumbs.setState({ unavailable: e instanceof Error ? e.message : String(e) });
    return (mode = 'none');
  }
}

function parseInWorker(buffer: ArrayBuffer, ext: string): Promise<import('@/lib/mesh').ParsedMesh> {
  return new Promise((res, rej) => {
    const w = new MeshWorker();
    w.onmessage = (e) => { w.terminate(); if (e.data.ok) res(e.data); else rej(new Error(e.data.error)); };
    w.onerror = (e) => { w.terminate(); rej(e.error ?? new Error(e.message)); };
    w.postMessage({ buffer, ext }, [buffer]);
  });
}

async function renderModel(buffer: ArrayBuffer, ext: string): Promise<ArrayBuffer> {
  const m = await detectMode();
  if (m === 'worker') {
    const id = nextId++;
    return new Promise((res, rej) => { waiting.set(id, { res, rej }); ensureWorker().postMessage({ type: 'render', id, buffer, ext }, [buffer]); });
  }
  if (m === 'main' && mainRenderer) {
    const parsed = await parseInWorker(buffer, ext);
    return mainRenderer.render(parsed);
  }
  throw new Error(useThumbs.getState().unavailable ?? 'rendering unavailable');
}

async function renderImage(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  const m = await detectMode();
  if (m === 'worker') {
    const id = nextId++;
    return new Promise((res, rej) => { waiting.set(id, { res, rej }); ensureWorker().postMessage({ type: 'image', id, buffer }, [buffer]); });
  }
  const { imageToThumb } = await import('@/lib/thumbs/render');
  mainCanvas ??= document.createElement('canvas');
  return imageToThumb(buffer, mainCanvas);
}

async function runJob(job: ThumbJob): Promise<void> {
  const b = await getBackend();
  let source = job.source;
  if (source === 'embedded') {
    try {
      const key = await b.storeEmbeddedThumbnail(job.project_id);
      return stored(job.project_id, key);
    } catch {
      source = 'render'; // broken/missing preview entry: render the geometry instead
    }
  }
  if (source === 'render' && useThumbs.getState().unavailable) throw Object.assign(new Error(useThumbs.getState().unavailable!), { fatal: true });
  const bytes = await b.readProjectFile(job.project_id, job.rel_path);
  const png = source === 'image' ? await renderImage(bytes) : await renderModel(bytes, extOf(job.rel_path));
  const key = await b.storeThumbnail(job.project_id, png);
  stored(job.project_id, key);
}

function stored(projectId: string, key: string) {
  useThumbs.setState((s) => ({ fresh: { ...s.fresh, [projectId]: key } }));
  onStored?.(projectId, key);
}

async function refreshStats() {
  try {
    const b = await getBackend();
    const s = await b.thumbStats();
    useThumbs.setState({ pending: s.pending, done: s.done, failed: s.failed });
  } catch { /* ignore */ }
}

/** Drains the engine's queue. Safe to call often: a run in progress is told to loop again. */
export async function kickThumbQueue(): Promise<void> {
  if (loopRunning) { rerun = true; return; }
  loopRunning = true;
  useThumbs.setState({ running: true });
  try {
    const b = await getBackend();
    for (;;) {
      rerun = false;
      await refreshStats();
      let jobs = await b.thumbQueue(24);
      // Without WebGL anywhere, model jobs are not failures of the file: leave them pending
      // (they render once a GPU/driver is back) and only process images and embedded previews.
      if (useThumbs.getState().unavailable) jobs = jobs.filter((j) => j.source !== 'render');
      if (jobs.length === 0) { if (!rerun) break; continue; }
      let progressed = false;
      for (const job of jobs) {
        try {
          await runJob(job);
          progressed = true;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const fatal = (e as { fatal?: boolean }).fatal || mode === 'none';
          if (fatal) { useThumbs.setState({ unavailable: msg }); if (job.source !== 'image') continue; }
          try { await b.thumbnailFailed(job.project_id, msg); progressed = true; } catch { /* project may be gone */ }
        }
      }
      await refreshStats();
      if (!progressed) break; // nothing moved: do not spin on the same jobs
    }
  } finally {
    loopRunning = false;
    useThumbs.setState({ running: false });
  }
}

/** Called once from the app shell: wires the "a thumbnail landed" callback and starts draining. */
export function startThumbnails(cb: (projectId: string, key: string) => void) {
  onStored = cb;
  void kickThumbQueue();
}
