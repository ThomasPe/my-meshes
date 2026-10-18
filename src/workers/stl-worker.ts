/// <reference lib="webworker" />
import { parseStl } from '@/lib/stl-parse';

self.onmessage = (e: MessageEvent<{ buffer: ArrayBuffer }>) => {
  const t0 = performance.now();
  try {
    const { positions, normals, triangles } = parseStl(e.data.buffer);
    (self as unknown as Worker).postMessage({ ok: true, positions, normals, triangles, parseMs: performance.now() - t0 }, [positions.buffer, normals.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: String(err) });
  }
};
