// Shared between the main thread and workers: minimal binary/ASCII STL parser and a
// synthetic generator (used by the browser-mode mock when no Tauri backend is present).

export interface ParsedStl { positions: Float32Array; normals: Float32Array; triangles: number; }

export function parseStl(buffer: ArrayBuffer): ParsedStl {
  const isBinary = (() => {
    if (buffer.byteLength < 84) return false;
    const view = new DataView(buffer);
    const n = view.getUint32(80, true);
    return 84 + n * 50 === buffer.byteLength;
  })();
  return isBinary ? parseBinary(buffer) : parseAscii(new TextDecoder().decode(buffer));
}

function parseBinary(buffer: ArrayBuffer): ParsedStl {
  const view = new DataView(buffer);
  const n = view.getUint32(80, true);
  const positions = new Float32Array(n * 9);
  const normals = new Float32Array(n * 9);
  let off = 84;
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

function parseAscii(text: string): ParsedStl {
  const pos: number[] = []; const nrm: number[] = [];
  const re = /facet\s+normal\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)[\s\S]*?vertex\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)\s+vertex\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)\s+vertex\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const f = m.slice(1).map(Number);
    for (let v = 0; v < 3; v++) { pos.push(f[3 + v * 3], f[4 + v * 3], f[5 + v * 3]); nrm.push(f[0], f[1], f[2]); }
  }
  return { positions: new Float32Array(pos), normals: new Float32Array(nrm), triangles: pos.length / 9 };
}

/** Same height-field as the Rust generator, so browser mode produces comparable geometry. */
export function generateStl(triangles: number): ArrayBuffer {
  const n = Math.ceil(Math.sqrt(Math.max(triangles, 2) / 2));
  const count = 2 * n * n;
  const buf = new ArrayBuffer(84 + count * 50);
  const view = new DataView(buf);
  view.setUint32(80, count, true);
  const size = 120, step = size / n;
  const h = (x: number, y: number) => 6 * Math.sin(x * 0.12) * Math.cos(y * 0.12) + 2 * Math.sin(x * 0.5 + y * 0.3) + Math.cos(y * 0.9);
  let off = 84;
  const tri = (a: number[], b: number[], c: number[]) => {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const nn = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const len = Math.hypot(nn[0], nn[1], nn[2]) || 1;
    for (const f of [nn[0] / len, nn[1] / len, nn[2] / len, ...a, ...b, ...c]) { view.setFloat32(off, f, true); off += 4; }
    off += 2;
  };
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x0 = i * step - size / 2, x1 = x0 + step, y0 = j * step - size / 2, y1 = y0 + step;
    const p00 = [x0, y0, h(x0, y0)], p10 = [x1, y0, h(x1, y0)], p01 = [x0, y1, h(x0, y1)], p11 = [x1, y1, h(x1, y1)];
    tri(p00, p10, p11); tri(p00, p11, p01);
  }
  return buf;
}
