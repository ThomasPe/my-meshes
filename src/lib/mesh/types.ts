// Shared mesh shape produced by every parser: flat triangle soup with per-vertex normals.
// Used inside Web Workers (no DOM) and on the main thread.
export interface ParsedMesh {
  positions: Float32Array;
  normals: Float32Array;
  triangles: number;
  /** Per-vertex RGB in 0..1 (same length as `positions`); absent when the file carries no colours. */
  colors?: Float32Array;
}

/** Fallback surface colour for triangles without their own colour, as RGB in 0..1. */
export const DEFAULT_COLOR: [number, number, number] = [0x0f / 255, 0x8b / 255, 0x8d / 255];

/** Vertex colours in the parsers are sRGB (as in the files); renderers want linear values. */
export function srgbToLinear(colors: Float32Array): Float32Array {
  const out = new Float32Array(colors.length);
  for (let i = 0; i < colors.length; i++) { const c = colors[i]!; out[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  return out;
}

export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export const PREVIEWABLE = new Set(['stl', 'obj', '3mf']);

export function extOf(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

/** Flat normals from positions (one normal per face, repeated per vertex). */
export function computeFlatNormals(positions: Float32Array): Float32Array {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 9) {
    const ax = positions[i]!, ay = positions[i + 1]!, az = positions[i + 2]!;
    const ux = positions[i + 3]! - ax, uy = positions[i + 4]! - ay, uz = positions[i + 5]! - az;
    const vx = positions[i + 6]! - ax, vy = positions[i + 7]! - ay, vz = positions[i + 8]! - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    for (let v = 0; v < 3; v++) { normals[i + v * 3] = nx; normals[i + v * 3 + 1] = ny; normals[i + v * 3 + 2] = nz; }
  }
  return normals;
}
