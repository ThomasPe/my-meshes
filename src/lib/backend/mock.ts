// In-memory backend for browser mode (vite dev / Playwright UI tests). Same contract as
// the Tauri commands, including error codes, so UI tests exercise real flows.
import type { Backend, Unlisten } from './index';
import { generate3mf, generateObj, generateStl } from '@/lib/mesh/generate';
import type { AppError, Collection, FacetCount, FileEntry, FileKind, ThumbLocation, FolderNode, ImportItem, ImportProgress, InboxFile, LibraryChanged, LibraryRoot, ListQuery, Project, ProjectSummary, ScanProgress, SidecarStamp, SmartCollection, TagCount, ThumbJob, UpdateMetadata } from '@/lib/types';

const kindOf = (name: string): FileKind => {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['stl', 'obj', '3mf', 'ply'].includes(ext)) return 'model';
  if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) return 'image';
  if (['pdf', 'txt', 'md', 'scad'].includes(ext)) return 'document';
  if (['zip', '7z', 'rar'].includes(ext)) return 'attachment';
  return 'other';
};
const f = (name: string, size: number, daysAgo = 10): FileEntry => ({ rel_path: name, name, kind: kindOf(name), size, modified: new Date(Date.now() - daysAgo * 864e5).toISOString(), slicer: name.endsWith('.3mf') && /plate|tower/.test(name) ? 'PrusaSlicer' : null, embedded_thumbnail: false });
const MB = 1024 * 1024;

type MockProject = Project & { has_sidecar: boolean; thumbKey?: string | null };
const err = (code: AppError['code'], message: string): AppError => ({ code, message });

function mk(root_id: string, rel_path: string, title: string, o: Partial<MockProject> & { files: FileEntry[]; daysAgo?: number }): MockProject {
  const files = o.files;
  const modified = new Date(Date.now() - (o.daysAgo ?? 7) * 864e5).toISOString();
  const has = o.has_sidecar ?? true;
  return {
    id: `${root_id}:${rel_path}`,
    root_id,
    rel_path,
    title,
    creator: o.creator ?? null,
    license: o.license ?? null,
    source_url: o.source_url ?? null,
    description: o.description ?? null,
    tags: o.tags ?? [],
    material: o.material ?? null,
    supports_required: o.supports_required ?? null,
    thumbnail: null,
    files,
    total_bytes: files.reduce((a, x) => a + x.size, 0),
    model_count: files.filter((x) => x.kind === 'model').length,
    modified,
    sidecar: has ? { state: 'ok' } : { state: 'missing' },
    sidecar_stamp: has ? { mtime_unix_nanos: Date.now() * 1e6, size: 200 } : null,
    warnings: o.warnings ?? [],
    offline: o.offline ?? false,
    has_sidecar: has,
    favorite: o.favorite ?? false,
    added: new Date(Date.now() - ((o.daysAgo ?? 7) + 30) * 864e5).toISOString(),
    thumb: null,
    slicer: files.find((x) => x.slicer)?.slicer ?? null,
  };
}

/** Mirrors the engine's thumbnail source choice (thumbs.rs). */
function thumbSourceOf(p: MockProject): ThumbJob | null {
  const renderable = p.files.filter((x) => x.kind === 'model' && /\.(stl|obj|3mf)$/i.test(x.name)).sort((a, b) => b.size - a.size)[0];
  if (renderable) return { project_id: p.id, rel_path: renderable.rel_path, source: 'render' };
  const img = p.files.find((x) => x.kind === 'image');
  return img ? { project_id: p.id, rel_path: img.rel_path, source: 'image' } : null;
}

async function generateImage(seed: number): Promise<ArrayBuffer> {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 192;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 256, 192);
  g.addColorStop(0, `hsl(${(seed * 47) % 360} 60% 70%)`);
  g.addColorStop(1, `hsl(${(seed * 47 + 90) % 360} 60% 40%)`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 192);
  const blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), 'image/png'));
  return blob.arrayBuffer();
}

const BAD_NAME = /[\\/:*?"<>|]/;

export function createMockBackend(): Backend {
  const roots: LibraryRoot[] = [
    { id: 'r1', path: 'D:\\3D Models', mode: 'watch', poll_interval_secs: 900, added_at: '2026-01-10T10:00:00Z', last_scan_at: new Date(Date.now() - 120_000).toISOString(), status: 'online', last_scan: { projects: 72, files: 131, ignored: 12, warnings: ['Projects/Robotics/Arm v4: nested project.yaml ignored: parts/project.yaml'], warning_count: 1, millis: 340, trigger: 'startup' }, last_error: null },
    { id: 'r2', path: '\\\\nas\\models', mode: 'poll', poll_interval_secs: 900, added_at: '2026-02-01T10:00:00Z', last_scan_at: new Date(Date.now() - 3 * 864e5).toISOString(), status: 'offline', last_scan: { projects: 1, files: 3, ignored: 0, warnings: [], warning_count: 0, millis: 1200, trigger: 'poll' }, last_error: 'folder not reachable: \\\\nas\\models' },
  ];
  const projects: MockProject[] = [
    mk('r1', 'Projects/Gridfinity/Baseplates', 'Gridfinity Baseplates', { creator: 'Zach Freedman', license: 'CC-BY-NC-SA-4.0', source_url: 'https://thangs.com/designer/ZackFreedman', tags: ['gridfinity', 'organizer'], material: 'PLA', supports_required: false, description: 'Parametric baseplates for the Gridfinity storage system.', files: [f('Baseplate_2x2.stl', 6.1 * MB), f('Baseplate_3x3.stl', 13.4 * MB), f('Baseplate_4x4.stl', 23.9 * MB), f('plate.3mf', 4 * MB), f('photo_desk.png', 0.7 * MB), f('README.md', 2048), f('original_download.zip', 41 * MB)], daysAgo: 3 }),
    mk('r1', 'Projects/Calibration/Benchy', 'Low-Poly Benchy', { creator: 'CreativeTools', license: 'CC-BY-4.0', tags: ['benchmark'], material: 'PLA', favorite: true, files: [f('benchy_lowpoly.stl', 3.1 * MB)], daysAgo: 9 }),
    mk('r1', 'Projects/Robotics/Arm v4', 'Robotic Arm v4', { creator: 'ExampleCreator', license: 'GPL-3.0', source_url: 'https://www.printables.com/model/123456', tags: ['robotics', 'functional'], material: 'PETG', supports_required: true, description: '6-axis desktop arm.', files: [f('base.stl', 18 * MB), f('shoulder.stl', 22 * MB), f('upper_arm.stl', 31 * MB), f('forearm.stl', 27 * MB), f('wrist.3mf', 9 * MB), f('BOM.pdf', 1.2 * MB), f('assembly.jpg', 3.4 * MB), f('firmware.zip', 84 * MB)], daysAgo: 1 }),
    mk('r1', 'Projects/Decor/Vase', 'Decorative Vase', { creator: 'Lena Hofer', tags: ['vase', 'decor'], has_sidecar: false, files: [f('vase_twist.stl', 9.8 * MB)], daysAgo: 20 }),
    mk('r1', 'Projects/Desk/Phone Stand', 'Phone Stand', { creator: 'PrintTools', license: 'CC0-1.0', tags: ['desk', 'functional'], material: 'PLA', favorite: true, files: [f('stand_body.obj', 4.1 * MB), f('stand_foot.stl', 1.4 * MB)], daysAgo: 30 }),
    mk('r2', 'Props/Helmets/MK2', 'Cosplay Helmet', { creator: 'Props Workshop', license: 'Personal use', tags: ['cosplay', 'props'], material: 'PLA', supports_required: true, offline: true, files: [f('helmet_part1.stl', 72 * MB), f('helmet_part2.stl', 70 * MB), f('visor.stl', 18 * MB)], daysAgo: 60 }),
    mk('r1', 'Projects/Desk/Cable Clips', 'Cable Clips', { creator: 'Maker Mia', tags: ['cable', 'organizer'], material: 'TPU', has_sidecar: false, files: [f('clip_6mm.stl', 0.4 * MB), f('clip_8mm.stl', 0.4 * MB), f('clip_10mm.stl', 0.4 * MB)], daysAgo: 0 }),
    mk('r1', 'Projects/Tabletop/Dice Tower', 'Dice Tower', { creator: 'TableTop Forge', license: 'CC-BY-NC-SA-4.0', tags: ['tabletop', 'gaming'], material: 'PLA', files: [f('tower.3mf', 31 * MB)], daysAgo: 45 }),
    mk('r1', 'Projects/Gridfinity/Rugged Box', 'Gridfinity Rugged Box', { creator: 'Pred', license: 'CC-BY-NC-SA-4.0', tags: ['gridfinity', 'storage'], material: 'PETG', files: [f('box_body.stl', 44 * MB), f('box_lid.stl', 31 * MB), f('latch_x2.stl', 3 * MB)], daysAgo: 2 }),
    mk('r1', 'Projects/Mechanical/Planetary Gearbox', 'Planetary Gearbox', { creator: 'GearWorks', license: 'MIT', tags: ['mechanical', 'functional'], material: 'PETG', files: [f('ring.stl', 9 * MB), f('sun.stl', 3 * MB), f('planet_x3.stl', 6 * MB), f('carrier.stl', 9 * MB), f('Planetary_Gearbox_Complete_Assembly_v3_final_export_for_printing.stl', 12 * MB)], daysAgo: 80 }),
    mk('r1', 'Projects/Decor/Planter', 'Self-watering Planter', { creator: 'Lena Hofer', tags: ['decor', 'garden'], has_sidecar: false, files: [f('planter_outer.stl', 9 * MB), f('planter_inner.stl', 5 * MB)], daysAgo: 100 }),
    mk('r1', 'Projects/Gridfinity/Bins', 'Gridfinity Bins 1×1 to 2×3', { creator: 'Zach Freedman', license: 'CC-BY-NC-SA-4.0', tags: ['gridfinity', 'organizer'], material: 'PLA', files: [f('bin_1x1.stl', 3 * MB), f('bin_1x2.stl', 5 * MB), f('bin_2x2.stl', 9 * MB), f('bin_2x3.stl', 14 * MB)], daysAgo: 120 }),
  ];
  // a few more to make virtualization matter
  for (let i = 1; i <= 60; i++) {
    projects.push(mk('r1', `Projects/Misc/Part ${String(i).padStart(2, '0')}`, `Misc Part ${i}`, { creator: i % 3 ? 'Various' : null, tags: i % 2 ? ['misc'] : ['misc', 'spare'], has_sidecar: i % 4 !== 0, files: [f(`part_${i}.stl`, (i % 7 + 1) * MB)], daysAgo: 130 + i }));
  }
  let ignore = ['.git', '__MACOSX', '.DS_Store', 'Thumbs.db', '*.gcode'];
  let containers = ['files', 'stl', 'stls', 'models', '3d'];
  let thumbLocation: ThumbLocation = 'app_data';
  const facet = (values: Array<string | null | undefined>): FacetCount[] => {
    const m = new Map<string, number>();
    for (const v of values) if (v) m.set(v, (m.get(v) ?? 0) + 1);
    return [...m.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  };
  const thumbs = new Map<string, ArrayBuffer>(); // key -> png
  const failed = new Set<string>();
  const listeners = { scan: new Set<(p: ScanProgress) => void>(), lib: new Set<(e: LibraryChanged) => void>(), proj: new Set<(e: { projectId: string }) => void>(), imp: new Set<(p: ImportProgress) => void>(), coll: new Set<() => void>(), inbox: new Set<(e: { rootId: string }) => void>() };
  const collections: Collection[] = [{ id: 'c_desk', name: 'Desk setup', projects: ['r1:Projects/Desk/Phone Stand', 'r1:Projects/Desk/Cable Clips'] }];
  const smart: SmartCollection[] = [{ id: 's_grid', name: 'Gridfinity PLA', query: { tags: ['gridfinity'], sort: 'title' } }];
  const inbox = new Map<string, InboxFile[]>([['r1', [{ name: 'quick_download.stl', kind: 'model', size: 2.2 * MB, modified: new Date(Date.now() - 864e5).toISOString() }, { name: 'reference.jpg', kind: 'image', size: 0.4 * MB, modified: new Date(Date.now() - 2 * 864e5).toISOString() }]]]);
  const collChanged = () => listeners.coll.forEach((cb) => cb());
  const applyQuery = (list: MockProject[], q: ListQuery) => {
    if (q.root_id) list = list.filter((p) => p.root_id === q.root_id);
    if (q.path_prefix) list = list.filter((p) => p.rel_path === q.path_prefix || p.rel_path.startsWith(q.path_prefix + '/'));
    if (q.favorites) list = list.filter((p) => p.favorite);
    if (q.creator) list = list.filter((p) => (p.creator ?? '').toLowerCase() === q.creator!.toLowerCase());
    if (q.license) list = list.filter((p) => (p.license ?? '').toLowerCase() === q.license!.toLowerCase());
    if (q.material) list = list.filter((p) => (p.material ?? '').toLowerCase() === q.material!.toLowerCase());
    if (q.file_type) list = list.filter((p) => p.files.some((x) => x.kind === 'model' && x.name.split('.').pop()?.toLowerCase() === q.file_type!.toLowerCase()));
    for (const t of q.tags ?? []) list = list.filter((p) => p.tags.includes(t.toLowerCase()));
    if (q.text?.trim()) {
      const terms = q.text.toLowerCase().split(/\s+/).filter(Boolean);
      list = list.filter((p) => { const hay = [p.title, p.creator ?? '', p.description ?? '', ...p.tags, ...p.files.map((x) => x.name)].join(' ').toLowerCase(); return terms.every((t) => hay.split(/[^a-z0-9äöüß]+/i).some((w) => w.startsWith(t))); });
    }
    const sort = q.sort ?? 'modified';
    list.sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title) : sort === 'creator' ? (a.creator ?? '~').localeCompare(b.creator ?? '~') : sort === 'size' ? b.total_bytes - a.total_bytes : sort === 'added' ? b.added.localeCompare(a.added) : b.modified.localeCompare(a.modified));
    if (q.limit) list = list.slice(q.offset ?? 0, (q.offset ?? 0) + q.limit);
    return list;
  };
  const sub = <T>(set: Set<(x: T) => void>, cb: (x: T) => void): Promise<Unlisten> => { set.add(cb); return Promise.resolve(() => set.delete(cb)); };
  const summary = (p: MockProject): ProjectSummary => ({ id: p.id, root_id: p.root_id, rel_path: p.rel_path, title: p.title, creator: p.creator, tags: p.tags, thumbnail: p.thumbnail, file_count: p.files.length, model_count: p.model_count, total_bytes: p.total_bytes, modified: p.modified, has_sidecar: p.has_sidecar, offline: p.offline, favorite: p.favorite, added: p.added, thumb: p.thumb, slicer: p.slicer });
  const delay = (ms = 30) => new Promise((r) => setTimeout(r, ms));
  const find = (id: string) => { const p = projects.find((x) => x.id === id); if (!p) throw err('not_found', `project not found: ${id}`); return p; };

  return {
    kind: 'mock',
    async appInfo() { return { version: '0.1.0-mock', dataDir: 'in-memory', testMode: false, e2eBuild: false, updater: true, store: false, channel: 'stable', os: 'browser', arch: 'n/a', webview: navigator.userAgent.split(') ').pop() ?? '' }; },
    async getRoots() { await delay(); return roots.map((r) => ({ ...r })); },
    async addRoot(path, mode = 'watch') {
      if (roots.some((r) => r.path === path)) throw err('root_exists', `root already registered: ${path}`);
      const r: LibraryRoot = { id: 'r' + (roots.length + 1), path, mode, poll_interval_secs: 900, added_at: new Date().toISOString(), last_scan_at: null, status: 'online', last_scan: null, last_error: null };
      roots.push(r);
      return r;
    },
    async removeRoot(id) {
      const i = roots.findIndex((r) => r.id === id);
      if (i < 0) throw err('not_found', id);
      const [r] = roots.splice(i, 1);
      for (let k = projects.length - 1; k >= 0; k--) if (projects[k]!.root_id === id) projects.splice(k, 1);
      listeners.lib.forEach((cb) => cb({ rootId: id, report: null, reason: 'root_removed' }));
      return r!;
    },
    async setRootMode(id, mode, pollIntervalSecs) { const r = roots.find((x) => x.id === id); if (!r) throw err('not_found', id); r.mode = mode; if (pollIntervalSecs) r.poll_interval_secs = pollIntervalSecs; return { ...r }; },
    async scanRoot(id) {
      const r = roots.find((x) => x.id === id);
      if (!r) throw err('not_found', id);
      if (r.status === 'offline') throw err('root_offline', `root is offline: ${r.path}`);
      const n = projects.filter((p) => p.root_id === id).length;
      for (let i = 1; i <= 5; i++) { await delay(60); listeners.scan.forEach((cb) => cb({ root_id: id, projects_found: Math.round((n * i) / 5) })); }
      r.last_scan_at = new Date().toISOString();
      const report = { root_id: id, projects: n, files: projects.filter((p) => p.root_id === id).reduce((a, p) => a + p.files.length, 0), ignored: 12, warnings: [], millis: 340 };
      listeners.lib.forEach((cb) => cb({ rootId: id, report, reason: 'scan' }));
      return report;
    },
    async listProjects(q: ListQuery) {
      await delay(15);
      let list = projects.slice();
      if (q.collection_id) {
        const c = collections.find((x) => x.id === q.collection_id);
        if (!c) throw err('not_found', `collection ${q.collection_id}`);
        list = list.filter((p) => c.projects.includes(p.id));
        if ((q.sort ?? 'collection') === 'collection') { list.sort((a, b) => c.projects.indexOf(a.id) - c.projects.indexOf(b.id)); return list.map(summary); }
      }
      return applyQuery(list, q).map(summary);
    },
    async getProject(id) { await delay(10); return { ...find(id) }; },
    async tagCounts(rootId) {
      const m = new Map<string, number>();
      for (const p of projects) if (!rootId || p.root_id === rootId) for (const t of p.tags) m.set(t, (m.get(t) ?? 0) + 1);
      return [...m.entries()].map(([tag, count]): TagCount => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
    },
    async facets(rootId) {
      const l = projects.filter((p) => !rootId || p.root_id === rootId);
      return {
        creators: facet(l.map((p) => p.creator)),
        licenses: facet(l.map((p) => p.license)),
        materials: facet(l.map((p) => p.material)),
        file_types: facet(l.map((p) => [...new Set(p.files.filter((x) => x.kind === 'model').map((x) => x.name.split('.').pop()!.toLowerCase()))]).flat()),
      };
    },
    async batchUpdateMetadata(ids, u) {
      await delay(100);
      const report = { updated: 0, failed: [] as Array<{ project_id: string; message: string }> };
      const add = (u.add_tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean);
      const remove = (u.remove_tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean);
      for (const id of ids) {
        const p = projects.find((x) => x.id === id);
        if (!p) { report.failed.push({ project_id: id, message: `project not found: ${id}` }); continue; }
        if (p.offline) { report.failed.push({ project_id: id, message: 'root is offline' }); continue; }
        if (u.creator !== undefined) p.creator = u.creator.trim() || null;
        if (u.license !== undefined) p.license = u.license.trim() || null;
        p.tags = [...new Set([...p.tags, ...add])].filter((t) => !remove.includes(t)).sort();
        p.has_sidecar = true; p.sidecar = { state: 'ok' }; p.modified = new Date().toISOString();
        report.updated++;
        listeners.proj.forEach((cb) => cb({ projectId: id }));
      }
      return report;
    },
    async getThumbLocation() { return thumbLocation; },
    async setThumbLocation(l) { thumbLocation = l; return l; },
    async notify(title, body) {
      const w = window as unknown as { __mockNotifications?: Array<{ title: string; body: string }> };
      (w.__mockNotifications ??= []).push({ title, body });
      return true;
    },
    async folderTree(rootId) {
      type N = { count: number; children: Map<string, N> };
      const root: N = { count: 0, children: new Map() };
      for (const p of projects.filter((x) => x.root_id === rootId)) {
        let cur = root; cur.count++;
        for (const seg of p.rel_path.split('/').filter(Boolean)) { if (!cur.children.has(seg)) cur.children.set(seg, { count: 0, children: new Map() }); cur = cur.children.get(seg)!; cur.count++; }
      }
      const build = (prefix: string, n: N): FolderNode[] => [...n.children.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, c]) => { const rel = prefix ? `${prefix}/${name}` : name; return { name, rel_path: rel, project_count: c.count, children: build(rel, c) }; });
      return build('', root);
    },
    async libraryStats(rootId) { const l = projects.filter((p) => !rootId || p.root_id === rootId); return { projects: l.length, totalBytes: l.reduce((a, p) => a + p.total_bytes, 0), favorites: projects.filter((p) => p.favorite).length }; },
    // Browser mode has no disk: synthesize plausible bytes per extension so parsers, viewer and thumbnails run for real.
    async readProjectFile(projectId, relPath) {
      const p = find(projectId);
      const file = p.files.find((x) => x.rel_path === relPath);
      if (!file) throw err('not_found', relPath);
      const seed = [...relPath].reduce((a, c) => a + c.charCodeAt(0), 0);
      // `?mesh=<triangles>` forces a mesh size (stress tests of the viewer and thumbnails)
      const forced = Number(new URLSearchParams(location.search).get('mesh'));
      const tri = forced > 0 ? forced : Math.min(20000, Math.max(200, Math.round(file.size / 4096)));
      const ext = relPath.split('.').pop()?.toLowerCase();
      if (ext === 'stl') return generateStl(tri, seed);
      if (ext === 'obj') return generateObj(tri, seed);
      if (ext === '3mf') return generate3mf();
      if (file.kind === 'image') return generateImage(seed);
      throw err('mock', 'no file contents in browser mode');
    },
    async updateMetadata(projectId, u: UpdateMetadata) {
      await delay(120);
      const p = find(projectId);
      if (p.offline) throw err('root_offline', 'root is offline');
      const onDisk: SidecarStamp | null = p.sidecar_stamp;
      const same = (a: SidecarStamp | null | undefined, b: SidecarStamp | null) => (!a && !b) || (!!a && !!b && a.mtime_unix_nanos === b.mtime_unix_nanos && a.size === b.size);
      if (!u.force && !same(u.expected_stamp ?? null, onDisk)) throw err('sidecar_conflict', 'project.yaml changed on disk since it was read; reload before saving');
      if (u.title !== undefined) p.title = u.title.trim() || p.rel_path.split('/').pop()!;
      if (u.creator !== undefined) p.creator = u.creator.trim() || null;
      if (u.license !== undefined) p.license = u.license.trim() || null;
      if (u.source_url !== undefined) p.source_url = u.source_url.trim() || null;
      if (u.description !== undefined) p.description = u.description.trim() || null;
      if (u.tags) p.tags = [...new Set(u.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].sort();
      if (u.recommended_material !== undefined) p.material = u.recommended_material.trim() || null;
      if (u.supports_required !== undefined) p.supports_required = u.supports_required;
      p.has_sidecar = true; p.sidecar = { state: 'ok' }; p.sidecar_stamp = { mtime_unix_nanos: Date.now() * 1e6, size: 300 + Math.floor(Math.random() * 100) }; p.modified = new Date().toISOString();
      listeners.proj.forEach((cb) => cb({ projectId }));
      return { ...p };
    },
    async revealProject() {},
    async revealFolder(rootId, relPath) { const w = window as unknown as { __mockRevealed?: string[] }; (w.__mockRevealed ??= []).push(`${rootId}:${relPath}`); },
    async openProjectFile() {},
    async setFavorite(projectId, favorite) { const p = find(projectId); p.favorite = favorite; listeners.proj.forEach((cb) => cb({ projectId })); return { ...p }; },
    async renameProject(projectId, newName) {
      await delay(80);
      const p = find(projectId);
      const name = newName.trim();
      if (!name || name === '.' || name === '..' || BAD_NAME.test(name) || /[. ]$/.test(name)) throw err('invalid_name', `invalid name: ${newName}`);
      const parent = p.rel_path.includes('/') ? p.rel_path.slice(0, p.rel_path.lastIndexOf('/') + 1) : '';
      const newRel = parent + name;
      if (newRel === p.rel_path) return { ...p };
      if (projects.some((x) => x.root_id === p.root_id && x.rel_path.toLowerCase() === newRel.toLowerCase() && x !== p)) throw err('already_exists', `a file or folder named ${name} already exists`);
      const oldId = p.id;
      p.rel_path = newRel; p.id = `${p.root_id}:${newRel}`;
      for (const c of collections) c.projects = c.projects.map((x) => (x === oldId ? p.id : x));
      if (!p.has_sidecar) p.title = name;
      listeners.lib.forEach((cb) => cb({ rootId: p.root_id, report: null, reason: 'rename', oldId, newId: p.id }));
      return { ...p };
    },
    async deleteProject(projectId) {
      await delay(80);
      const i = projects.findIndex((x) => x.id === projectId);
      if (i < 0) throw err('not_found', projectId);
      const [p] = projects.splice(i, 1);
      for (const c of collections) c.projects = c.projects.filter((x) => x !== projectId);
      listeners.lib.forEach((cb) => cb({ rootId: p!.root_id, report: null, reason: 'delete', oldId: projectId }));
    },
    async deleteFile(projectId, relPath) {
      await delay(60);
      const p = find(projectId);
      if (relPath.endsWith('project.yaml')) throw err('not_allowed', 'project.yaml is managed by the app');
      const i = p.files.findIndex((x) => x.rel_path === relPath);
      if (i < 0) throw err('not_found', relPath);
      p.files.splice(i, 1);
      p.model_count = p.files.filter((x) => x.kind === 'model').length;
      p.total_bytes = p.files.reduce((a, x) => a + x.size, 0);
      if (p.model_count === 0 && !p.has_sidecar) {
        projects.splice(projects.indexOf(p), 1);
        listeners.lib.forEach((cb) => cb({ rootId: p.root_id, report: null, reason: 'delete', oldId: projectId }));
        return null;
      }
      listeners.proj.forEach((cb) => cb({ projectId }));
      return { ...p };
    },
    async thumbQueue(limit = 50) {
      const jobs: ThumbJob[] = [];
      for (const p of projects) {
        if (p.offline || p.thumb || failed.has(p.id)) continue;
        const job = thumbSourceOf(p);
        if (job) jobs.push(job);
        if (jobs.length >= limit) break;
      }
      return jobs;
    },
    async thumbStats() {
      const withSource = projects.filter((p) => !p.offline && thumbSourceOf(p));
      const done = withSource.filter((p) => p.thumb).length;
      const f = withSource.filter((p) => !p.thumb && failed.has(p.id)).length;
      return { pending: withSource.length - done - f, done, failed: f };
    },
    async storeThumbnail(projectId, png) {
      const p = find(projectId);
      const key = `${projectId.replace(/[^a-z0-9]/gi, '_')}.png`;
      thumbs.set(key, png);
      p.thumb = key;
      failed.delete(projectId);
      return key;
    },
    async storeEmbeddedThumbnail(projectId) { throw err('not_allowed', `${projectId}: no embedded preview in browser mode`); },
    async thumbnailFailed(projectId) { failed.add(projectId); },
    async readThumbnail(key) { const b = thumbs.get(key); if (!b) throw err('not_found', key); return b.slice(0); },
    async pickImportFiles() { return ['C:\\Downloads\\Cable Clip.zip', 'C:\\Downloads\\loose_hook.stl', 'C:\\Downloads\\notes.7z']; },
    async analyzeImport(paths) {
      await delay(80);
      return paths.map((source): ImportItem => {
        const base = source.split(/[\\/]/).pop() ?? source;
        const ext = base.split('.').pop()?.toLowerCase() ?? '';
        const name = base.replace(/\.[^.]+$/, '');
        if (ext === 'zip') return { source, kind: 'archive', name, action: 'project', model_count: 2, file_count: 3, total_bytes: 4.2 * MB, strip_prefix: name, warnings: [] };
        if (!ext) return { source, kind: 'folder', name, action: 'project', model_count: 3, file_count: 5, total_bytes: 9 * MB, strip_prefix: null, warnings: [] };
        const model = ['stl', 'obj', '3mf'].includes(ext);
        return { source, kind: 'file', name, action: 'inbox', model_count: model ? 1 : 0, file_count: 1, total_bytes: 1.1 * MB, strip_prefix: null, warnings: ext === '7z' ? ['.7z archives are not extracted yet; extract manually or keep it in the inbox'] : [] };
      });
    },
    async executeImport(req) {
      const root = roots.find((r) => r.id === req.root_id);
      if (!root) throw err('not_found', req.root_id);
      const report = { root_id: req.root_id, projects: [] as string[], inbox_files: 0, skipped: 0, errors: [] as string[] };
      for (const it of req.items.filter((x) => x.action === 'project')) {
        if (!it.name.trim() || /[\\/:*?"<>|]/.test(it.name)) throw err('invalid_name', `invalid name: ${it.name}`);
        if (projects.some((p) => p.root_id === req.root_id && p.rel_path.toLowerCase() === it.name.trim().toLowerCase())) throw err('already_exists', `a file or folder named ${it.name} already exists`);
      }
      for (const [i, it] of req.items.entries()) {
        await delay(120);
        listeners.imp.forEach((cb) => cb({ index: i, total: req.items.length, name: it.name }));
        if (it.action === 'skip') { report.skipped++; continue; }
        if (it.action === 'inbox') { const list = inbox.get(req.root_id) ?? []; list.unshift({ name: it.source.split(/[\\/]/).pop()!, kind: kindOf(it.source), size: 1.1 * MB, modified: new Date().toISOString() }); inbox.set(req.root_id, list); report.inbox_files++; continue; }
        const files = [f('part_a.stl', 2 * MB, 0), f('part_b.stl', 2.2 * MB, 0), f('README.md', 1024, 0)];
        if (req.archive_policy === 'keep' && it.source.endsWith('.zip')) files.push(f(it.source.split(/[\\/]/).pop()!, 4.2 * MB, 0));
        projects.unshift(mk(req.root_id, it.name.trim(), it.name.trim(), { files, daysAgo: 0, has_sidecar: false }));
        report.projects.push(it.name.trim());
      }
      listeners.lib.forEach((cb) => cb({ rootId: req.root_id, report: null, reason: 'import' }));
      return report;
    },
    async listInbox(rootId) { return (inbox.get(rootId) ?? []).slice(); },
    async promoteInbox(rootId, files, name) {
      await delay(80);
      if (!name.trim() || /[\\/:*?"<>|]/.test(name)) throw err('invalid_name', `invalid name: ${name}`);
      if (projects.some((p) => p.root_id === rootId && p.rel_path.toLowerCase() === name.trim().toLowerCase())) throw err('already_exists', `a file or folder named ${name} already exists`);
      const list = inbox.get(rootId) ?? [];
      const moved = list.filter((x) => files.includes(x.name));
      if (moved.length === 0) throw err('not_allowed', 'no files selected');
      inbox.set(rootId, list.filter((x) => !files.includes(x.name)));
      const p = mk(rootId, name.trim(), name.trim(), { files: moved.map((x) => f(x.name, x.size, 0)), daysAgo: 0, has_sidecar: false });
      projects.unshift(p);
      listeners.lib.forEach((cb) => cb({ rootId, report: null, reason: 'import', newId: p.id }));
      return { ...p };
    },
    async deleteInboxFile(rootId, name) { inbox.set(rootId, (inbox.get(rootId) ?? []).filter((x) => x.name !== name)); listeners.inbox.forEach((cb) => cb({ rootId })); },
    async getCollections() { return collections.map((c) => ({ ...c, projects: c.projects.slice() })); },
    async createCollection(name) { if (!name.trim()) throw err('invalid_name', 'collection name is empty'); const c = { id: 'c_' + Math.random().toString(36).slice(2, 8), name: name.trim(), projects: [] }; collections.push(c); collChanged(); return { ...c }; },
    async renameCollection(id, name) { const c = collections.find((x) => x.id === id); if (!c) throw err('not_found', id); if (!name.trim()) throw err('invalid_name', 'collection name is empty'); c.name = name.trim(); collChanged(); return { ...c }; },
    async deleteCollection(id) { const i = collections.findIndex((x) => x.id === id); if (i < 0) throw err('not_found', id); collections.splice(i, 1); collChanged(); },
    async addToCollection(id, ids) { const c = collections.find((x) => x.id === id); if (!c) throw err('not_found', id); for (const p of ids) if (!c.projects.includes(p)) c.projects.push(p); collChanged(); return { ...c }; },
    async removeFromCollection(id, ids) { const c = collections.find((x) => x.id === id); if (!c) throw err('not_found', id); c.projects = c.projects.filter((p) => !ids.includes(p)); collChanged(); return { ...c }; },
    async reorderCollection(id, order) { const c = collections.find((x) => x.id === id); if (!c) throw err('not_found', id); const next = order.filter((p) => c.projects.includes(p)); for (const p of c.projects) if (!next.includes(p)) next.push(p); c.projects = next; collChanged(); return { ...c }; },
    async getSmartCollections() { return smart.map((s) => ({ ...s })); },
    async createSmartCollection(name, query) { if (!name.trim()) throw err('invalid_name', 'collection name is empty'); const s = { id: 's_' + Math.random().toString(36).slice(2, 8), name: name.trim(), query: { ...query, limit: undefined, offset: undefined, collection_id: undefined } }; smart.push(s); collChanged(); return { ...s }; },
    async updateSmartCollection(id, name, query) { const s = smart.find((x) => x.id === id); if (!s) throw err('not_found', id); if (name !== undefined) s.name = name; if (query) s.query = query; collChanged(); return { ...s }; },
    async deleteSmartCollection(id) { const i = smart.findIndex((x) => x.id === id); if (i < 0) throw err('not_found', id); smart.splice(i, 1); collChanged(); },
    async listSmartCollection(id, overrides) { const s = smart.find((x) => x.id === id); if (!s) throw err('not_found', id); return applyQuery(projects.slice(), { ...s.query, sort: overrides?.sort ?? s.query.sort, text: overrides?.text ?? s.query.text }).map(summary); },
    onImportProgress: (cb) => sub(listeners.imp, cb),
    onCollectionsChanged: (cb) => sub(listeners.coll, cb),
    onInboxChanged: (cb) => sub(listeners.inbox, cb),
    async onWatchError() { return () => {}; },
    async checkUpdate() { await delay(300); return { available: true, version: '0.2.0', notes: 'Mock release notes', date: null }; },
    async installUpdate() { await delay(300); },
    async onFileDrop() { return () => {}; },
    async clearThumbnails() { thumbs.clear(); failed.clear(); for (const p of projects) p.thumb = null; listeners.lib.forEach((cb) => cb({ rootId: null, report: null, reason: 'thumbs_cleared' })); },
    async pickFolder() { return 'E:\\More Models'; },
    async getIgnorePatterns() { return ignore.slice(); },
    async setIgnorePatterns(p) { ignore = p.slice(); return ignore.slice(); },
    async getContainerDirs() { return containers.slice(); },
    async setContainerDirs(n) { containers = n.map((x) => x.trim()).filter(Boolean); return containers.slice(); },
    onScanProgress: (cb) => sub(listeners.scan, cb),
    onLibraryChanged: (cb) => sub(listeners.lib, cb),
    onProjectChanged: (cb) => sub(listeners.proj, cb),
  };
}
