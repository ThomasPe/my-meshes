/// <reference lib="webworker" />
// Renders N thumbnails on an OffscreenCanvas (WebGL in a worker) and transfers PNG bytes back.
import { renderThumbnailSeries } from '../thumb-render';

interface Req { positions: Float32Array; normals: Float32Array; count: number; size: number }

const acks = new Map<number, () => void>();

self.onmessage = async (e: MessageEvent<Req | { type: 'ack'; index: number }>) => {
  if ('type' in e.data && e.data.type === 'ack') { acks.get(e.data.index)?.(); acks.delete(e.data.index); return; }
  const post = (m: unknown, t?: Transferable[]) => (self as unknown as Worker).postMessage(m, t || []);
  const { positions, normals, count, size } = e.data as Req;
  if (typeof OffscreenCanvas === 'undefined') { post({ type: 'error', error: 'OffscreenCanvas is not available in this worker' }); return; }
  // Backpressure: after posting a thumbnail, wait until the main thread has written it to disk
  // before rendering the next one. Keeps memory flat and makes per-thumbnail timings honest.
  await renderThumbnailSeries(new OffscreenCanvas(size, size), positions, normals, count, size, (ev, t) => {
    post(ev, t);
    if (ev.type === 'thumb') return new Promise<void>((resolve) => acks.set(ev.index, resolve));
  });
};
