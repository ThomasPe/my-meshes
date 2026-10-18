// Minimal STL parser (binary + ASCII). Used inside a Web Worker; no DOM access.
export interface ParsedMesh { positions: Float32Array; normals: Float32Array; triangles: number }

export function parseStl(buffer: ArrayBuffer): ParsedMesh {
  if (buffer.byteLength >= 84) {
    const n = new DataView(buffer).getUint32(80, true);
    if (84 + n * 50 === buffer.byteLength) return parseBinary(buffer, n);
  }
  return parseAscii(new TextDecoder().decode(buffer));
}

function parseBinary(buffer: ArrayBuffer, n: number): ParsedMesh {
  const view = new DataView(buffer);
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
