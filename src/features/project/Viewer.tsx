import { RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getBackend } from '@/lib/backend';
import { isAppError, type FileEntry } from '@/lib/types';
import StlWorker from '@/workers/stl-worker?worker';

const SUPPORTED = new Set(['stl']);

/** Three.js viewport for one model file. Loads bytes through the backend, parses in a worker, renders on demand. */
export function Viewer({ projectId, files, offline }: { projectId: string; files: FileEntry[]; offline: boolean }) {
  const { t } = useTranslation();
  const models = files.filter((f) => f.kind === 'model');
  const [current, setCurrent] = useState(models[0]?.rel_path ?? '');
  const [status, setStatus] = useState<{ kind: 'idle' | 'loading' | 'ready' | 'error' | 'unsupported'; text?: string; triangles?: number }>({ kind: 'idle' });
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
    if (!SUPPORTED.has(ext)) { setStatus({ kind: 'unsupported', text: t('project.unsupported', { ext: ext.toUpperCase() }) }); return; }
    if (offline) { setStatus({ kind: 'error', text: t('errors.root_offline') }); return; }
    let cancelled = false;
    setStatus({ kind: 'loading', text: t('project.loading', { name: file.name }) });
    (async () => {
      const b = await getBackend();
      const buf = await b.readProjectFile(projectId, file.rel_path);
      const parsed = await new Promise<{ positions: Float32Array; normals: Float32Array; triangles: number }>((res, rej) => {
        const w = new StlWorker();
        w.onmessage = (e) => { w.terminate(); e.data.ok ? res(e.data) : rej(new Error(e.data.error)); };
        w.onerror = (e) => { w.terminate(); rej(e.error ?? new Error(e.message)); };
        w.postMessage({ buffer: buf }, [buf]);
      });
      if (cancelled) return;
      if (s.mesh) { s.scene.remove(s.mesh); s.mesh.geometry.dispose(); }
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(parsed.positions, 3));
      geom.setAttribute('normal', new THREE.BufferAttribute(parsed.normals, 3));
      geom.computeBoundingSphere();
      const mesh = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ color: 0x0f8b8d, roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide }));
      s.scene.add(mesh);
      s.mesh = mesh;
      const bs = geom.boundingSphere!;
      s.controls.target.copy(bs.center);
      s.camera.position.copy(bs.center).add(new THREE.Vector3(bs.radius * 1.6, -bs.radius * 1.9, bs.radius * 1.3));
      s.camera.near = Math.max(bs.radius / 100, 0.01); s.camera.far = bs.radius * 50; s.camera.updateProjectionMatrix();
      s.frame();
      setStatus({ kind: 'ready', triangles: parsed.triangles });
    })().catch((e) => { if (!cancelled) setStatus({ kind: 'error', text: isAppError(e) ? e.message : e instanceof Error ? e.message : String(e) }); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, projectId, offline]);

  const reset = () => { const s = sceneRef.current; if (!s?.mesh) return; const bs = s.mesh.geometry.boundingSphere!; s.controls.target.copy(bs.center); s.camera.position.copy(bs.center).add(new THREE.Vector3(bs.radius * 1.6, -bs.radius * 1.9, bs.radius * 1.3)); s.frame(); };

  return (
    <div className="relative h-[440px] overflow-hidden rounded-2xl bg-background shadow-[inset_0_0_0_1px_var(--border)]" data-testid="viewer">
      <canvas ref={canvasRef} className="block size-full touch-none" />
      {models.length === 0 && <div className="absolute inset-0 grid place-items-center text-sm font-semibold text-muted-foreground">{t('project.noModels')}</div>}
      {status.kind !== 'ready' && status.kind !== 'idle' && models.length > 0 && <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm font-semibold text-muted-foreground" data-testid="viewer-status">{status.text}</div>}
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
