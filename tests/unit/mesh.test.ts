import { strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { parseModel } from '@/lib/mesh';
import { generate3mf, generateObj, generateStl } from '@/lib/mesh/generate';
import { parseObj } from '@/lib/mesh/obj';
import { parse3mf, parseModelXml } from '@/lib/mesh/threemf';
import { computeFlatNormals } from '@/lib/mesh/types';

const bounds = (p: Float32Array) => {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k]!, p[i + k]!); max[k] = Math.max(max[k]!, p[i + k]!); }
  return { min, max };
};

describe('OBJ', () => {
  it('parses triangles, quads (fan), negative indices and vertex normals', () => {
    const text = ['v 0 0 0', 'v 1 0 0', 'v 1 1 0', 'v 0 1 0', 'vn 0 0 1', 'f 1//1 2//1 3//1 4//1', 'f -4 -3 -2', '# comment', 'usemtl ignored'].join('\n');
    const m = parseObj(new TextEncoder().encode(text).buffer as ArrayBuffer);
    expect(m.triangles).toBe(3);
    expect(m.positions.length).toBe(27);
    expect(Array.from(m.normals.slice(0, 3))).toEqual([0, 0, 1]);
    // the second face has no normal index -> zero normal is kept per-vertex (renderer tolerates it)
    expect(Array.from(m.positions.slice(18, 21))).toEqual([0, 0, 0]);
  });
  it('computes flat normals when the file has none', () => {
    const m = parseObj(new TextEncoder().encode('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n').buffer as ArrayBuffer);
    expect(Array.from(m.normals.slice(0, 3))).toEqual([0, 0, 1]);
  });
  it('rejects files without faces', () => {
    expect(() => parseObj(new TextEncoder().encode('v 0 0 0\n').buffer as ArrayBuffer)).toThrow(/no faces/);
  });
  it('round-trips the generated surface', () => {
    const m = parseObj(generateObj(400, 1));
    expect(m.triangles).toBeGreaterThanOrEqual(400);
    expect(m.normals.length).toBe(m.positions.length);
  });
});

describe('3MF', () => {
  it('parses objects, components and build transforms', () => {
    const m = parse3mf(generate3mf());
    // cube (12) + object 2 = two component instances of the cube (24) -> 36 triangles
    expect(m.triangles).toBe(36);
    const { min, max } = bounds(m.positions);
    expect(min).toEqual([0, 0, 0]);
    // second item: cube at x+30 (component) lifted by z+25 (build item) -> max x 50, z 45
    expect(max[0]).toBe(50);
    expect(max[2]).toBe(45);
  });
  it('falls back to all objects when there is no build section', () => {
    const { objects, build } = parseModelXml('<model><resources><object id="7"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources></model>');
    expect(objects.get('7')?.mesh?.t.length).toBe(3);
    expect(build).toEqual([]);
  });
  it('finds the model part through _rels and ignores unrelated entries', () => {
    const buf = generate3mf({ 'Metadata/Slic3r_PE.config': strToU8('; prusa'), 'Metadata/thumbnail.png': new Uint8Array([137, 80, 78, 71]) });
    expect(parse3mf(buf).triangles).toBe(36);
  });
  it('reports archives without geometry', () => {
    expect(() => parse3mf(generate3mf({ '3D/3dmodel.model': strToU8('<model></model>') }))).toThrow(/no mesh geometry/);
  });
});

describe('parseModel', () => {
  it('dispatches by extension and rejects unknown formats', () => {
    expect(parseModel(generateStl(100), 'STL').triangles).toBeGreaterThanOrEqual(100);
    expect(parseModel(generateObj(100), 'obj').triangles).toBeGreaterThanOrEqual(100);
    expect(parseModel(generate3mf(), '3mf').triangles).toBe(36);
    expect(() => parseModel(new ArrayBuffer(8), 'step')).toThrow(/no parser/);
  });
  it('flat normals are unit length', () => {
    const n = computeFlatNormals(Float32Array.from([0, 0, 0, 2, 0, 0, 0, 2, 0]));
    expect(Math.hypot(n[0]!, n[1]!, n[2]!)).toBeCloseTo(1);
  });
});

describe('STL progressive (VIEW-1)', () => {
  it('streams binary files in slices that add up to the whole mesh', async () => {
    const { parseStlProgressive } = await import('@/lib/mesh/stl');
    const buf = generateStl(2500, 3);
    const whole = parseModel(buf.slice(0), 'stl');
    const chunks: Array<{ offset: number; triangles: number; positions: Float32Array }> = [];
    let total = 0;
    const n = parseStlProgressive(buf, (c, t) => { chunks.push(c); total = t; }, 1000);
    expect(n).toBe(whole.triangles);
    expect(total).toBe(whole.triangles);
    expect(chunks.length).toBe(Math.ceil(whole.triangles / 1000));
    expect(chunks.map((c) => c.offset)).toEqual(chunks.map((_, i) => i * 1000));
    const joined = new Float32Array(whole.triangles * 9);
    for (const c of chunks) joined.set(c.positions, c.offset * 9);
    expect(joined).toEqual(whole.positions);
  });
  it('delivers ASCII files as one slice', async () => {
    const { parseStlProgressive } = await import('@/lib/mesh/stl');
    const ascii = 'solid a\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid a\n';
    const chunks: number[] = [];
    const n = parseStlProgressive(new TextEncoder().encode(ascii).buffer as ArrayBuffer, (c) => chunks.push(c.triangles));
    expect(n).toBe(1);
    expect(chunks).toEqual([1]);
  });
});

describe('3MF production extension (Bambu Studio / OrcaSlicer)', () => {
  it('follows p:path components into 3D/Objects/*.model', () => {
    const part = '<?xml version="1.0"?><model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="0" y="10" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources></model>';
    const root = '<?xml version="1.0"?><model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06"><resources><object id="2" type="model"><components><component p:path="/3D/Objects/part_1.model" objectid="1" transform="1 0 0 0 1 0 0 0 1 5 0 0"/></components></object></resources><build><item objectid="2" transform="1 0 0 0 1 0 0 0 1 0 0 100"/></build></model>';
    const buf = generate3mf({ '3D/3dmodel.model': strToU8(root), '3D/Objects/part_1.model': strToU8(part) });
    const m = parse3mf(buf);
    expect(m.triangles).toBe(1);
    expect(Array.from(m.positions.slice(0, 3))).toEqual([5, 0, 100]);
  });
});
