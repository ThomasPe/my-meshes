// Minimal Wavefront OBJ parser: vertices, optional vertex normals, faces (triangles and
// polygons, fan-triangulated). Materials, textures and groups are ignored on purpose.
import { computeFlatNormals, type ParsedMesh } from './types';

export function parseObj(buffer: ArrayBuffer): ParsedMesh {
  const text = new TextDecoder().decode(buffer);
  const v: number[] = [];
  const vn: number[] = [];
  const faces: Array<[number, number][]> = [];
  let hasNormals = false;
  let start = 0;
  const len = text.length;
  while (start < len) {
    let end = text.indexOf('\n', start);
    if (end === -1) end = len;
    const line = text.slice(start, end).trim();
    start = end + 1;
    if (line.length < 3 || line[0] === '#') continue;
    const c0 = line.charCodeAt(0), c1 = line.charCodeAt(1), c2 = line.charCodeAt(2);
    if (c0 === 118 /* v */ && c1 === 32) {
      const p = line.slice(2).trim().split(/\s+/);
      v.push(+p[0]!, +p[1]!, +p[2]!);
    } else if (c0 === 118 && c1 === 110 /* n */ && c2 === 32) {
      const p = line.slice(3).trim().split(/\s+/);
      vn.push(+p[0]!, +p[1]!, +p[2]!);
    } else if (c0 === 102 /* f */ && c1 === 32) {
      const parts = line.slice(2).trim().split(/\s+/);
      const face: [number, number][] = [];
      for (const part of parts) {
        const seg = part.split('/');
        const vi = parseInt(seg[0]!, 10);
        const ni = seg.length >= 3 && seg[2] ? parseInt(seg[2], 10) : 0;
        if (Number.isNaN(vi)) continue;
        face.push([vi, ni]);
        if (ni) hasNormals = true;
      }
      if (face.length >= 3) faces.push(face);
    }
  }
  const vcount = v.length / 3;
  const ncount = vn.length / 3;
  const resolve = (i: number, count: number) => (i < 0 ? count + i : i - 1);
  let tri = 0;
  for (const f of faces) tri += f.length - 2;
  const positions = new Float32Array(tri * 9);
  const normals = hasNormals ? new Float32Array(tri * 9) : null;
  let k = 0;
  for (const f of faces) {
    for (let t = 1; t < f.length - 1; t++) {
      for (const [vi, ni] of [f[0]!, f[t]!, f[t + 1]!]) {
        const p = resolve(vi, vcount) * 3;
        positions[k] = v[p] ?? 0; positions[k + 1] = v[p + 1] ?? 0; positions[k + 2] = v[p + 2] ?? 0;
        if (normals) {
          const n = ni ? resolve(ni, ncount) * 3 : -1;
          normals[k] = n >= 0 ? vn[n] ?? 0 : 0; normals[k + 1] = n >= 0 ? vn[n + 1] ?? 0 : 0; normals[k + 2] = n >= 0 ? vn[n + 2] ?? 0 : 0;
        }
        k += 3;
      }
    }
  }
  if (tri === 0) throw new Error('OBJ contains no faces');
  return { positions, normals: normals ?? computeFlatNormals(positions), triangles: tri };
}
