// In-memory backend for browser mode (vite dev / Playwright UI tests). Same contract as
// the Tauri commands, including error codes, so UI tests exercise real flows.
import type { Backend, Unlisten } from './index';
import type { AppError, FileEntry, FileKind, FolderNode, LibraryChanged, LibraryRoot, ListQuery, Project, ProjectSummary, ScanProgress, SidecarStamp, TagCount, UpdateMetadata } from '@/lib/types';

const kindOf = (name: string): FileKind => {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['stl', 'obj', '3mf', 'ply'].includes(ext)) return 'model';
  if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) return 'image';
  if (['pdf', 'txt', 'md', 'scad'].includes(ext)) return 'document';
  if (['zip', '7z', 'rar'].includes(ext)) return 'attachment';
  return 'other';
};
const f = (name: string, size: number, daysAgo = 10): FileEntry => ({ rel_path: name, name, kind: kindOf(name), size, modified: new Date(Date.now() - daysAgo * 864e5).toISOString() });
const MB = 1024 * 1024;

type MockProject = Project & { has_sidecar: boolean };
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
  };
}

export function createMockBackend(): Backend {
  const roots: LibraryRoot[] = [
    { id: 'r1', path: 'D:\\3D Models', mode: 'watch', poll_interval_secs: 900, added_at: '2026-01-10T10:00:00Z', last_scan_at: new Date(Date.now() - 120_000).toISOString(), status: 'online' },
    { id: 'r2', path: '\\\\nas\\models', mode: 'poll', poll_interval_secs: 900, added_at: '2026-02-01T10:00:00Z', last_scan_at: new Date(Date.now() - 3 * 864e5).toISOString(), status: 'offline' },
  ];
  const projects: MockProject[] = [
    mk('r1', 'Projects/Gridfinity/Baseplates', 'Gridfinity Baseplates', { creator: 'Zach Freedman', license: 'CC-BY-NC-SA-4.0', source_url: 'https://thangs.com/designer/ZackFreedman', tags: ['gridfinity', 'organizer'], material: 'PLA', supports_required: false, description: 'Parametric baseplates for the Gridfinity storage system.', files: [f('Baseplate_2x2.stl', 6.1 * MB), f('Baseplate_3x3.stl', 13.4 * MB), f('Baseplate_4x4.stl', 23.9 * MB), f('plate.3mf', 4 * MB), f('photo_desk.png', 0.7 * MB), f('README.md', 2048), f('original_download.zip', 41 * MB)], daysAgo: 3 }),
    mk('r1', 'Projects/Calibration/Benchy', 'Low-Poly Benchy', { creator: 'CreativeTools', license: 'CC-BY-4.0', tags: ['benchmark'], material: 'PLA', files: [f('benchy_lowpoly.stl', 3.1 * MB)], daysAgo: 9 }),
    mk('r1', 'Projects/Robotics/Arm v4', 'Robotic Arm v4', { creator: 'ExampleCreator', license: 'GPL-3.0', source_url: 'https://www.printables.com/model/123456', tags: ['robotics', 'functional'], material: 'PETG', supports_required: true, description: '6-axis desktop arm.', files: [f('base.stl', 18 * MB), f('shoulder.stl', 22 * MB), f('upper_arm.stl', 31 * MB), f('forearm.stl', 27 * MB), f('wrist.3mf', 9 * MB), f('BOM.pdf', 1.2 * MB), f('assembly.jpg', 3.4 * MB), f('firmware.zip', 84 * MB)], daysAgo: 1 }),
    mk('r1', 'Projects/Decor/Vase', 'Decorative Vase', { creator: 'Lena Hofer', tags: ['vase', 'decor'], has_sidecar: false, files: [f('vase_twist.stl', 9.8 * MB)], daysAgo: 20 }),
    mk('r1', 'Projects/Desk/Phone Stand', 'Phone Stand', { creator: 'PrintTools', license: 'CC0-1.0', tags: ['desk', 'functional'], material: 'PLA', files: [f('stand_body.stl', 4.1 * MB), f('stand_foot.stl', 1.4 * MB)], daysAgo: 30 }),
    mk('r2', 'Props/Helmets/MK2', 'Cosplay Helmet', { creator: 'Props Workshop', license: 'Personal use', tags: ['cosplay', 'props'], material: 'PLA', supports_required: true, offline: true, files: [f('helmet_part1.stl', 72 * MB), f('helmet_part2.stl', 70 * MB), f('visor.stl', 18 * MB)], daysAgo: 60 }),
    mk('r1', 'Projects/Desk/Cable Clips', 'Cable Clips', { creator: 'Maker Mia', tags: ['cable', 'organizer'], material: 'TPU', has_sidecar: false, files: [f('clip_6mm.stl', 0.4 * MB), f('clip_8mm.stl', 0.4 * MB), f('clip_10mm.stl', 0.4 * MB)], daysAgo: 0 }),
    mk('r1', 'Projects/Tabletop/Dice Tower', 'Dice Tower', { creator: 'TableTop Forge', license: 'CC-BY-NC-SA-4.0', tags: ['tabletop', 'gaming'], material: 'PLA', files: [f('tower.3mf', 31 * MB)], daysAgo: 45 }),
    mk('r1', 'Projects/Gridfinity/Rugged Box', 'Gridfinity Rugged Box', { creator: 'Pred', license: 'CC-BY-NC-SA-4.0', tags: ['gridfinity', 'storage'], material: 'PETG', files: [f('box_body.stl', 44 * MB), f('box_lid.stl', 31 * MB), f('latch_x2.stl', 3 * MB)], daysAgo: 2 }),
    mk('r1', 'Projects/Mechanical/Planetary Gearbox', 'Planetary Gearbox', { creator: 'GearWorks', license: 'MIT', tags: ['mechanical', 'functional'], material: 'PETG', files: [f('ring.stl', 9 * MB), f('sun.stl', 3 * MB), f('planet_x3.stl', 6 * MB), f('carrier.stl', 9 * MB)], daysAgo: 80 }),
    mk('r1', 'Projects/Decor/Planter', 'Self-watering Planter', { creator: 'Lena Hofer', tags: ['decor', 'garden'], has_sidecar: false, files: [f('planter_outer.stl', 9 * MB), f('planter_inner.stl', 5 * MB)], daysAgo: 100 }),
    mk('r1', 'Projects/Gridfinity/Bins', 'Gridfinity Bins 1×1 to 2×3', { creator: 'Zach Freedman', license: 'CC-BY-NC-SA-4.0', tags: ['gridfinity', 'organizer'], material: 'PLA', files: [f('bin_1x1.stl', 3 * MB), f('bin_1x2.stl', 5 * MB), f('bin_2x2.stl', 9 * MB), f('bin_2x3.stl', 14 * MB)], daysAgo: 120 }),
  ];
  // a few more to make virtualization matter
  for (let i = 1; i <= 60; i++) {
    projects.push(mk('r1', `Projects/Misc/Part ${String(i).padStart(2, '0')}`, `Misc Part ${i}`, { creator: i % 3 ? 'Various' : null, tags: i % 2 ? ['misc'] : ['misc', 'spare'], has_sidecar: i % 4 !== 0, files: [f(`part_${i}.stl`, (i % 7 + 1) * MB)], daysAgo: 130 + i }));
  }
  let ignore = ['.git', '__MACOSX', '.DS_Store', 'Thumbs.db', '*.gcode'];
  const listeners = { scan: new Set<(p: ScanProgress) => void>(), lib: new Set<(e: LibraryChanged) => void>(), proj: new Set<(e: { projectId: string }) => void>() };
  const sub = <T>(set: Set<(x: T) => void>, cb: (x: T) => void): Promise<Unlisten> => { set.add(cb); return Promise.resolve(() => set.delete(cb)); };
  const summary = (p: MockProject): ProjectSummary => ({ id: p.id, root_id: p.root_id, rel_path: p.rel_path, title: p.title, creator: p.creator, tags: p.tags, thumbnail: p.thumbnail, file_count: p.files.length, model_count: p.model_count, total_bytes: p.total_bytes, modified: p.modified, has_sidecar: p.has_sidecar, offline: p.offline });
  const delay = (ms = 30) => new Promise((r) => setTimeout(r, ms));
  const find = (id: string) => { const p = projects.find((x) => x.id === id); if (!p) throw err('not_found', `project not found: ${id}`); return p; };

  return {
    kind: 'mock',
    async appInfo() { return { version: '0.1.0-mock', dataDir: 'in-memory', testMode: false, e2eBuild: false, os: 'browser', arch: 'n/a', webview: navigator.userAgent.split(') ').pop() ?? '' }; },
    async getRoots() { await delay(); return roots.map((r) => ({ ...r })); },
    async addRoot(path, mode = 'watch') {
      if (roots.some((r) => r.path === path)) throw err('root_exists', `root already registered: ${path}`);
      const r: LibraryRoot = { id: 'r' + (roots.length + 1), path, mode, poll_interval_secs: 900, added_at: new Date().toISOString(), last_scan_at: null, status: 'online' };
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
      if (q.root_id) list = list.filter((p) => p.root_id === q.root_id);
      if (q.path_prefix) list = list.filter((p) => p.rel_path === q.path_prefix || p.rel_path.startsWith(q.path_prefix + '/'));
      for (const t of q.tags ?? []) list = list.filter((p) => p.tags.includes(t.toLowerCase()));
      if (q.text?.trim()) {
        const terms = q.text.toLowerCase().split(/\s+/).filter(Boolean);
        list = list.filter((p) => { const hay = [p.title, p.creator ?? '', p.description ?? '', ...p.tags, ...p.files.map((x) => x.name)].join(' ').toLowerCase(); return terms.every((t) => hay.split(/[^a-z0-9äöüß]+/i).some((w) => w.startsWith(t))); });
      }
      const sort = q.sort ?? 'modified';
      list.sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title) : sort === 'creator' ? (a.creator ?? '~').localeCompare(b.creator ?? '~') : sort === 'size' ? b.total_bytes - a.total_bytes : b.modified.localeCompare(a.modified));
      if (q.limit) list = list.slice(q.offset ?? 0, (q.offset ?? 0) + q.limit);
      return list.map(summary);
    },
    async getProject(id) { await delay(10); return { ...find(id) }; },
    async tagCounts(rootId) {
      const m = new Map<string, number>();
      for (const p of projects) if (!rootId || p.root_id === rootId) for (const t of p.tags) m.set(t, (m.get(t) ?? 0) + 1);
      return [...m.entries()].map(([tag, count]): TagCount => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
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
    async libraryStats(rootId) { const l = projects.filter((p) => !rootId || p.root_id === rootId); return { projects: l.length, totalBytes: l.reduce((a, p) => a + p.total_bytes, 0) }; },
    async readProjectFile() { throw err('mock', 'no file contents in browser mode'); },
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
    async openProjectFile() {},
    async pickFolder() { return 'E:\\More Models'; },
    async getIgnorePatterns() { return ignore.slice(); },
    async setIgnorePatterns(p) { ignore = p.slice(); return ignore.slice(); },
    onScanProgress: (cb) => sub(listeners.scan, cb),
    onLibraryChanged: (cb) => sub(listeners.lib, cb),
    onProjectChanged: (cb) => sub(listeners.proj, cb),
  };
}
