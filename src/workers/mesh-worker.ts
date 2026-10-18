/// <reference lib="webworker" />
// Parses one model file (STL, OBJ, 3MF) off the main thread and transfers the geometry back.
import { parseModel } from '@/lib/mesh';

self.onmessage = (e: MessageEvent<{ buffer: ArrayBuffer; ext: string }>) => {
  const t0 = performance.now();
  try {
    const { positions, normals, triangles } = parseModel(e.data.buffer, e.data.ext);
    (self as unknown as Worker).postMessage({ ok: true, positions, normals, triangles, parseMs: performance.now() - t0 }, [positions.buffer, normals.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
