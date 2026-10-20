// 3MF geometry: unzip (fflate), find the model part via _rels/.rels (fallback 3D/3dmodel.model),
// then scan the XML for <object>/<mesh>/<vertex>/<triangle>, <components> and <build><item>
// with their 3x4 transforms. A tolerant regex scanner is used because workers have no
// DOMParser and slicer 3MFs can be tens of megabytes; it ignores anything it does not know.
import { unzipSync } from 'fflate';
import { computeFlatNormals, DEFAULT_COLOR, hexToRgb, type ParsedMesh } from './types';

type Mat = number[]; // 12 numbers, 3MF column-major "m00 m01 m02 m10 m11 m12 m20 m21 m22 m30 m31 m32"
const IDENTITY: Mat = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

type Rgb = [number, number, number];
interface MeshDef {
  v: Float32Array;
  t: Uint32Array;
  /** Per-triangle colour from core materials (`pid`/`p1`), when any triangle has one. */
  colors?: Array<Rgb | null>;
  /** Per-triangle painting state (Bambu `paint_color`, Prusa `slic3rpe:mmu_segmentation`), 0 = unpainted. */
  paint?: Int16Array;
}
interface ObjectDef { mesh?: MeshDef; color?: Rgb | null; components: Array<{ id: string; transform: Mat; path?: string }> }

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

/**
 * Decodes one painted triangle (PrusaSlicer / Bambu Studio `TriangleSelector::serialize`):
 * hex characters, most significant nibble first, each nibble four bits LSB-first. A leaf is
 * two split bits (00) then its state; states >= 3 add 11 and one or more extra nibbles.
 * Split triangles recurse into their children. For the preview a split triangle takes the
 * state most of its leaves share. Returns 0 for "not painted".
 */
export function paintState(code: string): number {
  const bits: number[] = [];
  for (let i = code.length - 1; i >= 0; i--) {
    const n = parseInt(code[i]!, 16);
    if (Number.isNaN(n)) return 0;
    bits.push(n & 1, (n >> 1) & 1, (n >> 2) & 1, (n >> 3) & 1);
  }
  let pos = 0;
  const read = (k: number) => { let v = 0; for (let i = 0; i < k; i++) v |= (bits[pos++] ?? 0) << i; return v; };
  const votes = new Map<number, number>();
  const walk = (depth: number) => {
    if (pos >= bits.length || depth > 12) return;
    const splitSides = read(2);
    if (splitSides) {
      read(2); // special side
      for (let c = 0; c <= splitSides; c++) walk(depth + 1);
      return;
    }
    let n = read(2);
    if (n === 3) { let extra = read(4); while (extra === 15) { n += 15; extra = read(4); } n += extra; }
    votes.set(n, (votes.get(n) ?? 0) + 1);
  };
  walk(0);
  let best = 0, bestVotes = -1;
  for (const [state, count] of votes) if (count > bestVotes || (count === bestVotes && state > best)) { best = state; bestVotes = count; }
  return best;
}

/** Parses one .model XML into object definitions, material palettes and the build list. */
export function parseModelXml(xml: string): { objects: Map<string, ObjectDef>; build: Array<{ id: string; transform: Mat }>; materials: Map<string, Array<Rgb | null>> } {
  const materials = new Map<string, Array<Rgb | null>>();
  const matRe = /<(?:[\w-]+:)?(basematerials|colorgroup)\b([^>]*)>([\s\S]*?)<\/(?:[\w-]+:)?(?:basematerials|colorgroup)>/g;
  let mm: RegExpExecArray | null;
  while ((mm = matRe.exec(xml))) {
    const id = attr('<x' + mm[2], 'id');
    if (!id) continue;
    const list: Array<Rgb | null> = [];
    const entryRe = /<(?:[\w-]+:)?(?:base|color)\b([^>]*)\/?>/g;
    let em: RegExpExecArray | null;
    while ((em = entryRe.exec(mm[3]!))) {
      const tag = '<x' + em[1];
      list.push(hexToRgb(attr(tag, 'displaycolor') ?? attr(tag, 'color') ?? ''));
    }
    materials.set(id, list);
  }
  const material = (pid: string | undefined, index: string | undefined): Rgb | null => {
    if (!pid || index === undefined) return null;
    return materials.get(pid)?.[+index] ?? null;
  };
  const objects = new Map<string, ObjectDef>();
  const objRe = /<object\b([^>]*)>([\s\S]*?)<\/object>/g;
  let om: RegExpExecArray | null;
  while ((om = objRe.exec(xml))) {
    const otag = '<object' + om[1];
    const id = attr(otag, 'id');
    if (!id) continue;
    const body = om[2]!;
    const def: ObjectDef = { components: [], color: material(attr(otag, 'pid'), attr(otag, 'pindex')) };
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
      const colors: Array<Rgb | null> = [];
      const paint: number[] = [];
      let anyColor = false, anyPaint = false;
      const tRe = /<triangle\b([^>]*)\/?>/g;
      let tm: RegExpExecArray | null;
      while ((tm = tRe.exec(body))) {
        const tag = '<triangle' + tm[1];
        t.push(+(attr(tag, 'v1') ?? 0), +(attr(tag, 'v2') ?? 0), +(attr(tag, 'v3') ?? 0));
        const c = tag.includes('pid') || tag.includes('p1') ? material(attr(tag, 'pid') ?? attr(otag, 'pid'), attr(tag, 'p1')) : null;
        colors.push(c); if (c) anyColor = true;
        const code = tag.includes('paint_color') || tag.includes('mmu_segmentation') ? (attr(tag, 'paint_color') ?? attr(tag, 'slic3rpe:mmu_segmentation')) : undefined;
        const st = code ? paintState(code) : 0;
        paint.push(st); if (st) anyPaint = true;
      }
      if (t.length) def.mesh = { v: Float32Array.from(v), t: Uint32Array.from(t), colors: anyColor ? colors : undefined, paint: anyPaint ? Int16Array.from(paint) : undefined };
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
  return { objects, build, materials };
}

/** Filament colours and per-object/part extruders from slicer project files inside the package. */
function slicerPalette(files: Record<string, Uint8Array>): { filaments: Array<Rgb | null>; objectExtruder: Map<string, number>; partExtruder: Map<string, number>; volumes: Map<string, Array<{ first: number; last: number; extruder: number }>> } {
  const dec = (k: string) => (files[k] ? new TextDecoder().decode(files[k]) : null);
  const filaments: Array<Rgb | null> = [];
  const objectExtruder = new Map<string, number>();
  const partExtruder = new Map<string, number>();
  const volumes = new Map<string, Array<{ first: number; last: number; extruder: number }>>();
  // Bambu Studio / OrcaSlicer
  const project = dec('Metadata/project_settings.config');
  if (project) {
    const m = /"filament_colour"\s*:\s*\[([^\]]*)\]/.exec(project);
    if (m) for (const c of m[1]!.matchAll(/"([^"]*)"/g)) filaments.push(hexToRgb(c[1]!));
  }
  const model = dec('Metadata/model_settings.config');
  if (model) {
    const objRe = /<object\b([^>]*)>([\s\S]*?)<\/object>/g;
    let om: RegExpExecArray | null;
    while ((om = objRe.exec(model))) {
      const id = attr('<object' + om[1], 'id');
      const body = om[2]!;
      const own = /<metadata\b[^>]*key="extruder"[^>]*value="(\d+)"/.exec(body.split('<part')[0] ?? '');
      if (id && own) objectExtruder.set(id, +own[1]!);
      const partRe = /<part\b([^>]*)>([\s\S]*?)<\/part>/g;
      let pm: RegExpExecArray | null;
      while ((pm = partRe.exec(body))) {
        const pid = attr('<part' + pm[1], 'id');
        const ex = /<metadata\b[^>]*key="extruder"[^>]*value="(\d+)"/.exec(pm[2]!);
        if (pid && ex) partExtruder.set(pid, +ex[1]!);
      }
    }
  }
  // PrusaSlicer
  const prusa = dec('Metadata/Slic3r_PE.config');
  if (prusa && filaments.length === 0) {
    const m = /^;\s*filament_colour\s*=\s*(.+)$/m.exec(prusa);
    if (m) for (const c of m[1]!.split(';')) filaments.push(hexToRgb(c));
  }
  const prusaModel = dec('Metadata/Slic3r_PE_model.config');
  if (prusaModel) {
    const objRe = /<object\b([^>]*)>([\s\S]*?)<\/object>/g;
    let om: RegExpExecArray | null;
    while ((om = objRe.exec(prusaModel))) {
      const id = attr('<object' + om[1], 'id');
      if (!id) continue;
      const body = om[2]!;
      const own = /<metadata\b[^>]*type="object"[^>]*key="extruder"[^>]*value="(\d+)"/.exec(body);
      if (own) objectExtruder.set(id, +own[1]!);
      const vols: Array<{ first: number; last: number; extruder: number }> = [];
      const volRe = /<volume\b([^>]*)>([\s\S]*?)<\/volume>/g;
      let vm: RegExpExecArray | null;
      while ((vm = volRe.exec(body))) {
        const vtag = '<volume' + vm[1];
        const ex = /<metadata\b[^>]*key="extruder"[^>]*value="(\d+)"/.exec(vm[2]!);
        const first = +(attr(vtag, 'firstid') ?? -1), last = +(attr(vtag, 'lastid') ?? -1);
        if (ex && first >= 0 && last >= first) vols.push({ first, last, extruder: +ex[1]! });
      }
      if (vols.length) volumes.set(id, vols);
    }
  }
  return { filaments, objectExtruder, partExtruder, volumes };
}

export function parse3mf(buffer: ArrayBuffer): ParsedMesh {
  const files = unzipSync(new Uint8Array(buffer), { filter: (f) => /\.(model|rels)$/i.test(f.name) || /^Metadata\/(project_settings|model_settings|Slic3r_PE|Slic3r_PE_model)\.config$/.test(f.name) });
  const modelPath = findModelPath(files);
  const parts = new Map<string, ReturnType<typeof parseModelXml>>();
  const part = (path: string) => {
    let p = parts.get(path);
    if (!p) {
      const data = files[path] ?? files[decodeURIComponent(path)];
      p = data ? parseModelXml(new TextDecoder().decode(data)) : { objects: new Map(), build: [], materials: new Map() };
      parts.set(path, p);
    }
    return p;
  };
  const { objects, build } = part(modelPath);
  const palette = slicerPalette(files);
  const filament = (n: number): Rgb | null => (n >= 1 ? palette.filaments[n - 1] ?? null : null);
  const out: number[] = [];
  const cols: number[] = [];
  let anyColor = false;
  // Colour of one triangle: painting > core material on the triangle > material on the object >
  // extruder of the part/volume/object (slicer projects) > none.
  const emit = (id: string, m: Mat, depth: number, scope = objects, inherited: Rgb | null = null, rootId = id) => {
    const def = scope.get(id);
    if (!def || depth > 16) return;
    const partColor = filament(palette.partExtruder.get(id) ?? 0) ?? filament(palette.objectExtruder.get(rootId) ?? 0);
    const base = def.color ?? partColor ?? inherited;
    if (def.mesh) {
      const { v, t, colors, paint } = def.mesh;
      const vols = palette.volumes.get(id);
      for (let i = 0, tri = 0; i < t.length; i += 3, tri++) {
        let c: Rgb | null = null;
        const st = paint ? paint[tri]! : 0;
        if (st) c = filament(st);
        if (!c && colors) c = colors[tri] ?? null;
        if (!c && vols) { const vol = vols.find((r) => tri >= r.first && tri <= r.last); if (vol) c = filament(vol.extruder); }
        if (!c) c = base;
        if (c) anyColor = true;
        const [r, g, b] = c ?? DEFAULT_COLOR;
        for (let k = 0; k < 3; k++) {
          const vi = t[i + k]! * 3;
          const p = apply(m, v[vi] ?? 0, v[vi + 1] ?? 0, v[vi + 2] ?? 0);
          out.push(p[0], p[1], p[2]);
          cols.push(r, g, b);
        }
      }
    }
    for (const comp of def.components) emit(comp.id, mul(m, comp.transform), depth + 1, comp.path ? part(comp.path).objects : scope, base, rootId);
  };
  const items = build.length ? build : [...objects.keys()].map((id) => ({ id, transform: IDENTITY }));
  for (const it of items) emit(it.id, it.transform, 0);
  if (out.length === 0) throw new Error('3MF contains no mesh geometry');
  const positions = Float32Array.from(out);
  return { positions, normals: computeFlatNormals(positions), triangles: positions.length / 9, colors: anyColor ? Float32Array.from(cols) : undefined };
}
