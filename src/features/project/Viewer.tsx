import { RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getBackend } from '@/lib/backend';
import { isAppError, type FileEntry } from '@/lib/types';
import { PREVIEWABLE } from '@/lib/mesh';
import MeshWorker from '@/workers/mesh-worker?worker';
import type { MeshWorkerMessage } from '@/workers/mesh-worker';

/** Three.js viewport for one model file. Loads bytes through the backend, parses in a worker, renders on demand. */
export function Viewer({ projectId, files, offline }: { projectId: string; files: FileEntry[]; offline: boolean }) {
  const { t } = useTranslation();
  const models = files.filter((f) => f.kind === 'model');
  const [current, setCurrent] = useState(models[0]?.rel_path ?? '');
  const [status, setStatus] = useState<{ kind: 'idle' | 'loading' | 'ready' | 'error' | 'unsupported'; text?: string; triangles?: number; percent?: number }>({ kind: 'idle' });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<{ renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls; mesh: THREE.Mesh | null; frame: () => void; dispose: () => void } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch {
      setStatus({ kind: 'error', text: 'WebGL unavailable' });
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 10000);
    camera.up.set(0, 0, 1);
    camera.position.set(120, -140, 100);
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(100, 80, 160); scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.4); fill.position.set(-120, 40, -60); scene.add(fill);
    const grid = new THREE.GridHelper(400, 40, 0x9ca3af, 0xd1d5db); grid.rotation.x = Math.PI / 2; (grid.material as THREE.Material).transparent = true; (grid.material as THREE.Material).opacity = 0.35; scene.add(grid);
    let raf = 0;
    const frame = () => {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (canvas.width !== w * renderer.getPixelRatio() || canvas.height !== h * renderer.getPixelRatio()) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
      controls.update();
      renderer.render(scene, camera);
    };
    // render on demand: while damping settles, keep animating; otherwise one frame per change
    let active = 0;
    const kick = () => { active = 30; if (!raf) loop(); };
    const loop = () => { frame(); if (active-- > 0) raf = requestAnimationFrame(loop); else raf = 0; };
    controls.addEventListener('change', kick);
    const ro = new ResizeObserver(kick); ro.observe(canvas);
    kick();
    const state = { renderer, scene, camera, controls, mesh: null as THREE.Mesh | null, frame: kick, dispose: () => { ro.disconnect(); cancelAnimationFrame(raf); controls.dispose(); renderer.dispose(); } };
    sceneRef.current = state;
    return () => { state.dispose(); sceneRef.current = null; };
  }, []);

  useEffect(() => {
    const s = sceneRef.current;
    if (!s || !current) return;
    const file = models.find((m) => m.rel_path === current);
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!PREVIEWABLE.has(ext)) { setStatus({ kind: 'unsupported', text: t('project.unsupported', { ext: ext.toUpperCase() }) }); return; }
    if (offline) { setStatus({ kind: 'error', text: t('errors.root_offline') }); return; }
    let cancelled = false;
    let worker: Worker | null = null;
    setStatus({ kind: 'loading', text: t('project.loading', { name: file.name }) });
    const frameTo = (geom: THREE.BufferGeometry) => {
      geom.computeBoundingSphere();
      const bs = geom.boundingSphere!;
      if (!(bs.radius > 0)) return;
      s.controls.target.copy(bs.center);
      s.camera.position.copy(bs.center).add(new THREE.Vector3(bs.radius * 1.6, -bs.radius * 1.9, bs.radius * 1.3));
      s.camera.near = Math.max(bs.radius / 100, 0.01); s.camera.far = bs.radius * 50; s.camera.updateProjectionMatrix();
    };
    (async () => {
      const b = await getBackend();
      const buf = await b.readProjectFile(projectId, file.rel_path);
      if (cancelled) return;
      setStatus({ kind: 'loading', text: t('project.parsing', { name: file.name }) });
      // VIEW-1: the worker streams slices; geometry is pre-sized from 'begin' and the draw
      // range grows per slice, so big files appear progressively instead of after a freeze.
      await new Promise<void>((res, rej) => {
        const w = new MeshWorker();
        worker = w;
        let geom: THREE.BufferGeometry | null = null;
        let pos: THREE.BufferAttribute | null = null;
        let nrm: THREE.BufferAttribute | null = null;
        let total = 0, done = 0, framed = false;
        w.onmessage = (e: MessageEvent<MeshWorkerMessage>) => {
          const m = e.data;
          if (cancelled) { w.terminate(); return; }
          if (m.type === 'begin') {
            total = m.triangles;
            if (s.mesh) { s.scene.remove(s.mesh); s.mesh.geometry.dispose(); s.mesh = null; }
            geom = new THREE.BufferGeometry();
            pos = new THREE.BufferAttribute(new Float32Array(total * 9), 3);
            nrm = new THREE.BufferAttribute(new Float32Array(total * 9), 3);
            pos.setUsage(THREE.DynamicDrawUsage); nrm.setUsage(THREE.DynamicDrawUsage);
            geom.setAttribute('position', pos); geom.setAttribute('normal', nrm);
            geom.setDrawRange(0, 0);
            const mesh = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ color: 0x0f8b8d, roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide }));
            s.scene.add(mesh);
            s.mesh = mesh;
          } else if (m.type === 'chunk' && geom && pos && nrm) {
            (pos.array as Float32Array).set(m.positions, m.offset * 9);
            (nrm.array as Float32Array).set(m.normals, m.offset * 9);
            pos.addUpdateRange(m.offset * 9, m.triangles * 9); nrm.addUpdateRange(m.offset * 9, m.triangles * 9);
            pos.needsUpdate = true; nrm.needsUpdate = true;
            done = m.offset + m.triangles;
            geom.setDrawRange(0, done * 3);
            if (!framed) { frameTo(geom); framed = true; }
            s.frame();
            if (total > 0) setStatus({ kind: 'loading', text: t('project.loadingProgress', { name: file.name, percent: Math.round((done / total) * 100) }), percent: done / total });
          } else if (m.type === 'done') {
            w.terminate(); worker = null;
            if (geom) frameTo(geom);
            s.frame();
            res();
          } else if (m.type === 'error') {
            w.terminate(); worker = null;
            rej(new Error(m.error));
          }
        };
        w.onerror = (e) => { w.terminate(); worker = null; rej(e.error ?? new Error(e.message)); };
        w.postMessage({ buffer: buf, ext }, [buf]);
      });
      if (cancelled) return;
      setStatus({ kind: 'ready', triangles: s.mesh ? (s.mesh.geometry.drawRange.count / 3) : 0 });
    })().catch((e) => { if (!cancelled) setStatus({ kind: 'error', text: isAppError(e) ? e.message : e instanceof Error ? e.message : String(e) }); });
    return () => { cancelled = true; worker?.terminate(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, projectId, offline]);

  const reset = () => { const s = sceneRef.current; if (!s?.mesh) return; const bs = s.mesh.geometry.boundingSphere!; s.controls.target.copy(bs.center); s.camera.position.copy(bs.center).add(new THREE.Vector3(bs.radius * 1.6, -bs.radius * 1.9, bs.radius * 1.3)); s.frame(); };

  return (
    <div className="relative h-[440px] overflow-hidden rounded-2xl bg-background shadow-[inset_0_0_0_1px_var(--border)]" data-testid="viewer">
      <canvas ref={canvasRef} className="block size-full touch-none" />
      {models.length === 0 && <div className="absolute inset-0 grid place-items-center text-sm font-semibold text-muted-foreground">{t('project.noModels')}</div>}
      {status.kind !== 'ready' && status.kind !== 'idle' && models.length > 0 && (
        <div className={status.kind === 'loading' && status.percent !== undefined ? 'pointer-events-none absolute inset-x-6 top-3 grid gap-1 text-xs font-semibold text-muted-foreground' : 'absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm font-semibold text-muted-foreground'} data-testid="viewer-status" data-progress={status.percent !== undefined ? Math.round(status.percent * 100) : undefined}>
          <span className="truncate">{status.text}</span>
          {status.percent !== undefined && <span className="h-1 w-full overflow-hidden rounded-full bg-secondary"><span className="block h-full bg-primary transition-[width]" style={{ width: `${Math.round(status.percent * 100)}%` }} /></span>}
        </div>
      )}
      <div className="absolute left-3 right-3 bottom-3 flex items-center gap-3 text-xs font-semibold text-muted-foreground">
        {models.length > 1 && (
          <Select value={current} onValueChange={setCurrent}>
            <SelectTrigger size="sm" className="max-w-[260px]"><SelectValue /></SelectTrigger>
            <SelectContent>{models.map((m) => <SelectItem key={m.rel_path} value={m.rel_path}>{m.name}</SelectItem>)}</SelectContent>
          </Select>
        )}
        {models.length === 1 && <span className="rounded-full bg-card px-3 py-1 shadow-card">{models[0]!.name}</span>}
        {status.kind === 'ready' && <span data-testid="viewer-triangles">{t('project.triangles', { count: status.triangles ?? 0 })}</span>}
        <span className="ml-auto hidden sm:inline">{t('project.viewerHint')}</span>
        <Button size="icon-sm" variant="outline" onClick={reset} title="reset"><RotateCcw /></Button>
      </div>
    </div>
  );
}
