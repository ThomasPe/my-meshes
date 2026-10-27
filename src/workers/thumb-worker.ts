/// <reference lib="webworker" />
// Thumbnail worker: parses a model and renders it on an OffscreenCanvas, or cover-fits an
// image. Replies {id, ok, png} or {id, ok:false, error}. A 'probe' message answers whether
// WebGL is available here at all, so the main thread can fall back early.
import { parseModel } from '@/lib/mesh';
import { imageToThumb, ThumbRenderer, THUMB_SIZE } from '@/lib/thumbs/render';

export type ThumbWorkerRequest =
  | { type: 'probe' }
  | { type: 'render'; id: number; buffer: ArrayBuffer; ext: string }
  | { type: 'image'; id: number; buffer: ArrayBuffer };
export type ThumbWorkerResponse =
  | { type: 'probe'; ok: boolean; glRenderer?: string; error?: string }
  | { type: 'done'; id: number; ok: true; png: ArrayBuffer; ms: number }
  | { type: 'done'; id: number; ok: false; error: string; fatal?: boolean };

let renderer: ThumbRenderer | null = null;
let fatal: string | null = null;
let imageCanvas: OffscreenCanvas | null = null;

function getRenderer(): ThumbRenderer {
  if (fatal) throw new Error(fatal);
  if (!renderer) {
    if (typeof OffscreenCanvas === 'undefined') { fatal = 'OffscreenCanvas is not available in this worker'; throw new Error(fatal); }
    try { renderer = new ThumbRenderer(new OffscreenCanvas(THUMB_SIZE, THUMB_SIZE)); } catch (e) { fatal = 'WebGL unavailable in worker: ' + (e instanceof Error ? e.message : String(e)); throw new Error(fatal, { cause: e }); }
  }
  return renderer;
}

const post = (m: ThumbWorkerResponse, t?: Transferable[]) => (self as unknown as Worker).postMessage(m, t ?? []);

self.onmessage = async (e: MessageEvent<ThumbWorkerRequest>) => {
  const msg = e.data;
  if (msg.type === 'probe') {
    try { const r = getRenderer(); post({ type: 'probe', ok: true, glRenderer: r.glRenderer }); } catch (err) { post({ type: 'probe', ok: false, error: err instanceof Error ? err.message : String(err) }); }
    return;
  }
  const t0 = performance.now();
  try {
    let png: ArrayBuffer;
    if (msg.type === 'image') {
      imageCanvas ??= new OffscreenCanvas(THUMB_SIZE, THUMB_SIZE);
      png = await imageToThumb(msg.buffer, imageCanvas);
    } else {
      const parsed = parseModel(msg.buffer, msg.ext);
      png = await getRenderer().render(parsed);
    }
    post({ type: 'done', id: msg.id, ok: true, png, ms: performance.now() - t0 }, [png]);
  } catch (err) {
    post({ type: 'done', id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err), fatal: !!fatal });
  }
};
