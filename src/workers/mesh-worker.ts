/// <reference lib="webworker" />
// Parses one model file (STL, OBJ, 3MF) off the main thread. Binary STL streams in slices so
// the viewer can draw while parsing (VIEW-1); other formats arrive as one slice.
//
// Messages out: { type: 'begin', triangles } -> { type: 'chunk', ... }* -> { type: 'done', triangles, parseMs }
//               or { type: 'error', error }.
import { parseModel } from '@/lib/mesh';
import { parseStlProgressive } from '@/lib/mesh/stl';

export type MeshWorkerMessage =
  | { type: 'begin'; triangles: number }
  | { type: 'chunk'; offset: number; triangles: number; positions: Float32Array; normals: Float32Array }
  | { type: 'done'; triangles: number; parseMs: number }
  | { type: 'error'; error: string };

const post = (m: MeshWorkerMessage, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

self.onmessage = (e: MessageEvent<{ buffer: ArrayBuffer; ext: string }>) => {
  const t0 = performance.now();
  try {
    let triangles = 0;
    if (e.data.ext.toLowerCase() === 'stl') {
      let begun = false;
      triangles = parseStlProgressive(e.data.buffer, (c, total) => {
        if (!begun) { post({ type: 'begin', triangles: total }); begun = true; }
        post({ type: 'chunk', offset: c.offset, triangles: c.triangles, positions: c.positions, normals: c.normals }, [c.positions.buffer, c.normals.buffer]);
      });
    } else {
      const m = parseModel(e.data.buffer, e.data.ext);
      triangles = m.triangles;
      post({ type: 'begin', triangles });
      post({ type: 'chunk', offset: 0, triangles, positions: m.positions, normals: m.normals }, [m.positions.buffer, m.normals.buffer]);
    }
    post({ type: 'done', triangles, parseMs: performance.now() - t0 });
  } catch (err) {
    post({ type: 'error', error: err instanceof Error ? err.message : String(err) });
  }
};
