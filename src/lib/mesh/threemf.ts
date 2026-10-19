// 3MF geometry: unzip (fflate), find the model part via _rels/.rels (fallback 3D/3dmodel.model),
// then scan the XML for <object>/<mesh>/<vertex>/<triangle>, <components> and <build><item>
// with their 3x4 transforms. A tolerant regex scanner is used because workers have no
// DOMParser and slicer 3MFs can be tens of megabytes; it ignores anything it does not know.
import { unzipSync } from 'fflate';
import { computeFlatNormals, type ParsedMesh } from './types';

type Mat = number[]; // 12 numbers, 3MF column-major "m00 m01 m02 m10 m11 m12 m20 m21 m22 m30 m31 m32"
const IDENTITY: Mat = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

interface ObjectDef { mesh?: { v: Float32Array; t: Uint32Array }; components: Array<{ id: string; transform: Mat; path?: string }> }

function parseTransform(s: string | undefined): Mat {
  if (!s) return IDENTITY;
  const n = s.trim().split(/\s+/).map(Number);
  return n.length === 12 && n.every((x) => Number.isFinite(x)) ? n : IDENTITY;
}
function mul(a: Mat, b: Mat): Mat {
  // result = a ∘ b (apply b first, then a), both affine 3x4 in 3MF layout
  const r = new Array<number>(12);
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < 3; row++) {
      r[row * 3 + col] = b[row * 3]! * a[col]! + b[row * 3 + 1]! * a[3 + col]! + b[row * 3 + 2]! * a[6 + col]!;
    }
  }
  for (let col = 0; col < 3; col++) r[9 + col] = b[9]! * a[col]! + b[10]! * a[3 + col]! + b[11]! * a[6 + col]! + a[9 + col]!;
  return r;
}
function apply(m: Mat, x: number, y: number, z: number): [number, number, number] {
  return [
    x * m[0]! + y * m[3]! + z * m[6]! + m[9]!,
    x * m[1]! + y * m[4]! + z * m[7]! + m[10]!,
    x * m[2]! + y * m[5]! + z * m[8]! + m[11]!,
  ];
}

const attr = (tag: string, name: string): string | undefined => {
  const m = new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`).exec(tag) ?? new RegExp(`\\s${name}\\s*=\\s*'([^']*)'`).exec(tag);
  return m?.[1];
};

function findModelPath(files: Record<string, Uint8Array>): string {
  const rels = files['_rels/.rels'];
  if (rels) {
    const text = new TextDecoder().decode(rels);
    const re = /<Relationship\b[^>]*>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const type = attr(m[0], 'Type') ?? '';
      if (type.endsWith('/3dmodel')) {
        const target = (attr(m[0], 'Target') ?? '').replace(/^\//, '');
        if (files[target]) return target;
      }
    }
  }
  if (files['3D/3dmodel.model']) return '3D/3dmodel.model';
  const any = Object.keys(files).find((k) => k.toLowerCase().endsWith('.model'));
  if (any) return any;
  throw new Error('3MF has no 3D model part');
}

/** Parses one .model XML into object definitions and the build list. */
export function parseModelXml(xml: string): { objects: Map<string, ObjectDef>; build: Array<{ id: string; transform: Mat }> } {
  const objects = new Map<string, ObjectDef>();
  const objRe = /<object\b([^>]*)>([\s\S]*?)<\/object>/g;
  let om: RegExpExecArray | null;
  while ((om = objRe.exec(xml))) {
    const id = attr('<object' + om[1], 'id');
    if (!id) continue;
    const body = om[2]!;
    const def: ObjectDef = { components: [] };
    const meshStart = body.indexOf('<mesh');
    if (meshStart >= 0) {
      const v: number[] = [];
      const vRe = /<vertex\b([^>]*)\/?>/g;
      let vm: RegExpExecArray | null;
      while ((vm = vRe.exec(body))) {
        const t = '<vertex' + vm[1];
        v.push(+(attr(t, 'x') ?? 0), +(attr(t, 'y') ?? 0), +(attr(t, 'z') ?? 0));
      }
      const t: number[] = [];
      const tRe = /<triangle\b([^>]*)\/?>/g;
      let tm: RegExpExecArray | null;
      while ((tm = tRe.exec(body))) {
        const tag = '<triangle' + tm[1];
        t.push(+(attr(tag, 'v1') ?? 0), +(attr(tag, 'v2') ?? 0), +(attr(tag, 'v3') ?? 0));
      }
      if (t.length) def.mesh = { v: Float32Array.from(v), t: Uint32Array.from(t) };
    }
    const cRe = /<component\b([^>]*)\/?>/g;
    let cm: RegExpExecArray | null;
    while ((cm = cRe.exec(body))) {
      const tag = '<component' + cm[1];
      const cid = attr(tag, 'objectid');
      // production extension: the component lives in another model part of the package
      const path = /\s(?:[\w-]+:)?path\s*=\s*["']([^"']+)["']/.exec(tag)?.[1]?.replace(/^\//, '');
      if (cid) def.components.push({ id: cid, transform: parseTransform(attr(tag, 'transform')), path });
    }
    objects.set(id, def);
  }
  const build: Array<{ id: string; transform: Mat }> = [];
  const bm = /<build\b[^>]*>([\s\S]*?)<\/build>/.exec(xml);
  if (bm) {
    const iRe = /<item\b([^>]*)\/?>/g;
    let im: RegExpExecArray | null;
    while ((im = iRe.exec(bm[1]!))) {
      const tag = '<item' + im[1];
      const id = attr(tag, 'objectid');
      if (id) build.push({ id, transform: parseTransform(attr(tag, 'transform')) });
    }
  }
  return { objects, build };
}

export function parse3mf(buffer: ArrayBuffer): ParsedMesh {
  const files = unzipSync(new Uint8Array(buffer), { filter: (f) => /\.(model|rels)$/i.test(f.name) });
  const modelPath = findModelPath(files);
  const parts = new Map<string, ReturnType<typeof parseModelXml>>();
  const part = (path: string) => {
    let p = parts.get(path);
    if (!p) {
      const data = files[path] ?? files[decodeURIComponent(path)];
      p = data ? parseModelXml(new TextDecoder().decode(data)) : { objects: new Map(), build: [] };
      parts.set(path, p);
    }
    return p;
  };
  const { objects, build } = part(modelPath);
  const out: number[] = [];
  const emit = (id: string, m: Mat, depth: number, scope = objects) => {
    const def = scope.get(id);
    if (!def || depth > 16) return;
    if (def.mesh) {
      const { v, t } = def.mesh;
      for (let i = 0; i < t.length; i += 3) {
        for (let k = 0; k < 3; k++) {
          const vi = t[i + k]! * 3;
          const p = apply(m, v[vi] ?? 0, v[vi + 1] ?? 0, v[vi + 2] ?? 0);
          out.push(p[0], p[1], p[2]);
        }
      }
    }
    for (const c of def.components) emit(c.id, mul(m, c.transform), depth + 1, c.path ? part(c.path).objects : scope);
  };
  const items = build.length ? build : [...objects.keys()].map((id) => ({ id, transform: IDENTITY }));
  for (const it of items) emit(it.id, it.transform, 0);
  if (out.length === 0) throw new Error('3MF contains no mesh geometry');
  const positions = Float32Array.from(out);
  return { positions, normals: computeFlatNormals(positions), triangles: positions.length / 9 };
}
