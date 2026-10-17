/// <reference lib="webworker" />
// Renders N thumbnails on an OffscreenCanvas (WebGL in a worker) and transfers PNG bytes back.
import { renderThumbnailSeries } from '../thumb-render';

interface Req { positions: Float32Array; normals: Float32Array; count: number; size: number }

self.onmessage = async (e: MessageEvent<Req>) => {
  const post = (m: unknown, t?: Transferable[]) => (self as unknown as Worker).postMessage(m, t || []);
  const { positions, normals, count, size } = e.data;
  if (typeof OffscreenCanvas === 'undefined') { post({ type: 'error', error: 'OffscreenCanvas is not available in this worker' }); return; }
  await renderThumbnailSeries(new OffscreenCanvas(size, size), positions, normals, count, size, (ev, t) => post(ev, t));
};
