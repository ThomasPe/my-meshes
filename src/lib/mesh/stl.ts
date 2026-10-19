// Minimal STL parser (binary + ASCII). Used inside a Web Worker; no DOM access.
import type { ParsedMesh } from './types';

export function parseStl(buffer: ArrayBuffer): ParsedMesh {
  if (buffer.byteLength >= 84) {
    const n = new DataView(buffer).getUint32(80, true);
    if (84 + n * 50 === buffer.byteLength) return parseBinary(buffer, n);
  }
  return parseAscii(new TextDecoder().decode(buffer));
}

/** A slice of triangles `[offset, offset + triangles)` of a mesh being parsed. */
export interface MeshChunk {
  offset: number;
  triangles: number;
  positions: Float32Array;
  normals: Float32Array;
}

/**
 * VIEW-1: parses a binary STL in slices so a viewer can draw the first triangles while the
 * rest is still being read. Returns the triangle count; ASCII files come as one chunk.
 */
export function parseStlProgressive(buffer: ArrayBuffer, onChunk: (c: MeshChunk, total: number) => void, chunkTriangles = 100_000): number {
  if (buffer.byteLength >= 84) {
    const n = new DataView(buffer).getUint32(80, true);
    if (84 + n * 50 === buffer.byteLength) {
      for (let start = 0; start < n || (n === 0 && start === 0); start += chunkTriangles) {
        const count = Math.min(chunkTriangles, n - start);
        const part = parseBinaryRange(buffer, start, count);
        onChunk({ offset: start, triangles: count, positions: part.positions, normals: part.normals }, n);
        if (n === 0) break;
      }
      return n;
    }
  }
  const whole = parseAscii(new TextDecoder().decode(buffer));
  onChunk({ offset: 0, triangles: whole.triangles, positions: whole.positions, normals: whole.normals }, whole.triangles);
  return whole.triangles;
}

function parseBinary(buffer: ArrayBuffer, n: number): ParsedMesh {
  return parseBinaryRange(buffer, 0, n);
}

function parseBinaryRange(buffer: ArrayBuffer, start: number, n: number): ParsedMesh {
  const view = new DataView(buffer);
  const positions = new Float32Array(n * 9);
  const normals = new Float32Array(n * 9);
  let off = 84 + start * 50;
  for (let i = 0; i < n; i++) {
    const nx = view.getFloat32(off, true), ny = view.getFloat32(off + 4, true), nz = view.getFloat32(off + 8, true);
    off += 12;
    for (let v = 0; v < 3; v++) {
      const k = i * 9 + v * 3;
      positions[k] = view.getFloat32(off, true); positions[k + 1] = view.getFloat32(off + 4, true); positions[k + 2] = view.getFloat32(off + 8, true);
      normals[k] = nx; normals[k + 1] = ny; normals[k + 2] = nz;
      off += 12;
    }
    off += 2;
  }
  return { positions, normals, triangles: n };
}

function parseAscii(text: string): ParsedMesh {
  const pos: number[] = [];
  const nrm: number[] = [];
  const re = /facet\s+normal\s+(\S+)\s+(\S+)\s+(\S+)[\s\S]*?vertex\s+(\S+)\s+(\S+)\s+(\S+)\s+vertex\s+(\S+)\s+(\S+)\s+(\S+)\s+vertex\s+(\S+)\s+(\S+)\s+(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const v = m.slice(1).map(Number);
    for (let i = 0; i < 3; i++) { pos.push(v[3 + i * 3]!, v[4 + i * 3]!, v[5 + i * 3]!); nrm.push(v[0]!, v[1]!, v[2]!); }
  }
  return { positions: new Float32Array(pos), normals: new Float32Array(nrm), triangles: pos.length / 9 };
}
