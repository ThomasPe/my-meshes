import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createBackend, type Backend } from './backend';
import StlWorker from './workers/stl-worker?worker';
import ThumbWorker from './workers/thumb-worker?worker';
import { renderThumbnailSeries, type ThumbEvent } from './thumb-render';
import '@wdio/tauri-plugin';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const fmtMB = (b: number) => (b / 1e6).toFixed(1) + ' MB';
const fmtMs = (ms: number) => (ms >= 1000 ? (ms / 1000).toFixed(2) + ' s' : Math.round(ms) + ' ms');

function kv(id: string, rows: [string, string, string?][]) {
  $(id).innerHTML = rows.map(([k, v, cls]) => `<dt>${k}</dt><dd class="${cls || ''}" title="${v}">${v}</dd>`).join('');
}
const results: Record<string, unknown> = {};
function publish(section: string, data: unknown) {
  results[section] = data;
  $('results').textContent = JSON.stringify(results, null, 2);
}
function setStatus(s: string) { $('status').textContent = s; }

/* ---------------- viewer ---------------- */
const canvas = $<HTMLCanvasElement>('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 5000);
camera.position.set(140, -160, 110); camera.up.set(0, 0, 1);
const controls = new OrbitControls(camera, canvas); controls.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 1.1));
const key = new THREE.DirectionalLight(0xffffff, 1.5); key.position.set(100, 80, 160); scene.add(key);
const grid = new THREE.GridHelper(400, 40, 0x9ca3af, 0xd1d5db); grid.rotation.x = Math.PI / 2; scene.add(grid);
let mesh: THREE.Mesh | null = null;
let frames = 0; let fpsWindowStart = performance.now(); let fps = 0;
// While thumbnails render we stop drawing the big viewer scene so the main-thread probe measures
// only what the worker costs the UI, not the viewer's own frame time on slow GPUs.
let viewerPaused = false;
function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== w * renderer.getPixelRatio() || canvas.height !== h * renderer.getPixelRatio()) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
}
function tick() {
  resize(); controls.update();
  if (!viewerPaused) renderer.render(scene, camera);
  frames++; const now = performance.now();
  if (now - fpsWindowStart >= 1000) { fps = Math.round(frames * 1000 / (now - fpsWindowStart)); frames = 0; fpsWindowStart = now; $('hud').textContent = `${fps} fps · ${mesh ? (mesh.geometry.getAttribute('position').count / 3).toLocaleString() + ' triangles' : 'no model'} · drag to orbit`; }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

const glInfo = (() => { const gl = renderer.getContext(); const d = gl.getExtension('WEBGL_debug_renderer_info'); return { renderer: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), vendor: d ? gl.getParameter(d.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR), webgl2: gl instanceof WebGL2RenderingContext }; })();

/* ---------------- state ---------------- */
let backend: Backend;
let current: { positions: Float32Array; normals: Float32Array; triangles: number; path: string; bytes: number } | null = null;

async function loadPath(path: string) {
  setStatus('reading file…');
  const t0 = performance.now();
  const buf = await backend.readFile(path);
  const ipcMs = performance.now() - t0;
  setStatus('parsing in worker…');
  const t1 = performance.now();
  const parsed = await new Promise<{ positions: Float32Array; normals: Float32Array; triangles: number; parseMs: number }>((res, rej) => {
    const w = new StlWorker(); w.onmessage = (e) => { w.terminate(); e.data.ok ? res(e.data) : rej(new Error(e.data.error)); }; w.onerror = (e) => { w.terminate(); rej(e.error || new Error(e.message)); };
    w.postMessage({ buffer: buf }, [buf]);
  });
  const workerRoundtripMs = performance.now() - t1;
  setStatus('uploading to GPU…');
  const t2 = performance.now();
  if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(parsed.positions.slice(), 3));
  geom.setAttribute('normal', new THREE.BufferAttribute(parsed.normals.slice(), 3));
  geom.computeBoundingSphere();
  mesh = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ color: 0x0f8b8d, roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide }));
  scene.add(mesh);
  renderer.compile(scene, camera); renderer.render(scene, camera);
  const uploadMs = performance.now() - t2;
  const r = geom.boundingSphere!.radius; controls.target.copy(geom.boundingSphere!.center); camera.position.copy(geom.boundingSphere!.center).add(new THREE.Vector3(r * 1.6, -r * 1.9, r * 1.3)); controls.update();
  current = { positions: parsed.positions, normals: parsed.normals, triangles: parsed.triangles, path, bytes: buf.byteLength || parsed.triangles * 50 + 84 };
  $<HTMLButtonElement>('thumbs').disabled = false;
  $('triCount').textContent = String(parsed.triangles);
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  const stats = { path, bytes: current.bytes, triangles: parsed.triangles, ipcReadMs: Math.round(ipcMs), parseMs: Math.round(parsed.parseMs), workerRoundtripMs: Math.round(workerRoundtripMs), gpuUploadMs: Math.round(uploadMs), jsHeapMB: mem ? Math.round(mem.usedJSHeapSize / 1e6) : null };
  kv('loadStats', [['File', path.split(/[\\/]/).pop() || path], ['Size', fmtMB(current.bytes)], ['Triangles', parsed.triangles.toLocaleString()], ['IPC read (Rust → webview)', fmtMs(ipcMs), ipcMs < 1500 ? 'ok' : 'warn'], ['Parse (worker)', fmtMs(parsed.parseMs)], ['Worker round trip', fmtMs(workerRoundtripMs)], ['GPU upload + first frame', fmtMs(uploadMs)], ['JS heap', mem ? Math.round(mem.usedJSHeapSize / 1e6) + ' MB' : 'n/a']]);
  publish('load', stats);
  setStatus('loaded');
  // sample FPS for 2 seconds while auto-rotating
  controls.autoRotate = true; controls.autoRotateSpeed = 6;
  await new Promise(r => setTimeout(r, 2200));
  controls.autoRotate = false;
  publish('load', { ...stats, fpsWhileOrbiting: fps, gl: glInfo });
  kv('loadStats', [...Array.from($('loadStats').querySelectorAll('dt')).map((dt, i) => [dt.textContent || '', $('loadStats').querySelectorAll('dd')[i].textContent || '', $('loadStats').querySelectorAll('dd')[i].className] as [string, string, string]), ['FPS while orbiting', String(fps), fps >= 50 ? 'ok' : fps >= 25 ? 'warn' : 'err']]);
  return stats;
}

async function generate() {
  const tris = Number($<HTMLInputElement>('tris').value) || 1_000_000;
  setStatus('generating STL in Rust…');
  const g = await backend.generateTestStl(tris);
  publish('generate', g);
  kv('loadStats', [['Generated', g.path], ['Size', fmtMB(g.bytes)], ['Triangles', g.triangles.toLocaleString()], ['Write time', fmtMs(g.millis)]]);
  return loadPath(g.path);
}

async function renderThumbnails() {
  if (!current) throw new Error('load a model first');
  const count = Number($<HTMLInputElement>('thumbCount').value) || 20;
  const size = Number($<HTMLInputElement>('thumbSize').value) || 512;
  await backend.clearThumbnails();
  $('thumbgrid').innerHTML = '';
  $('thumbsWritten').textContent = '0';
  setStatus(`rendering ${count} thumbnails in worker…`);
  viewerPaused = true;
  const t0 = performance.now();
  const per: { renderMs: number; encodeMs: number; ipcMs: number; bytes: number }[] = [];
  let written = 0; let glRenderer = ''; let setupMs = 0;
  // main-thread responsiveness probe: how long do rAF ticks stall while the worker renders?
  let worstFrameGap = 0; let last = performance.now(); let probing = true;
  const probe = () => { const now = performance.now(); worstFrameGap = Math.max(worstFrameGap, now - last); last = now; if (probing) requestAnimationFrame(probe); };
  requestAnimationFrame(probe);
  let mode: 'worker' | 'main-thread-fallback' = 'worker';
  const handle = async (m: ThumbEvent) => {
    if (m.type === 'ready') { glRenderer = m.glRenderer; setupMs = m.setupMs; }
    if (m.type === 'thumb') {
      const ti = performance.now();
      const blob = new Blob([m.png], { type: 'image/png' });
      const img = document.createElement('img'); img.src = URL.createObjectURL(blob); img.alt = `thumbnail ${m.index + 1}`; $('thumbgrid').appendChild(img);
      const res = await backend.writeThumbnail(`thumb-${String(m.index + 1).padStart(2, '0')}`, m.png);
      written++; $('thumbsWritten').textContent = String(written);
      per.push({ renderMs: m.renderMs, encodeMs: m.encodeMs, ipcMs: performance.now() - ti, bytes: res.bytes });
      setStatus(`thumbnail ${written}/${count}${mode === 'worker' ? '' : ' (main-thread fallback)'}`);
    }
  };
  const workerError = await new Promise<string | null>((resolve, reject) => {
    const w = new ThumbWorker();
    w.onerror = (e) => { w.terminate(); reject(e.error || new Error(e.message)); };
    w.onmessage = async (e) => {
      const m = e.data as ThumbEvent;
      if (m.type === 'error') { w.terminate(); resolve(m.error); return; }
      await handle(m);
      if (m.type === 'thumb') w.postMessage({ type: 'ack', index: m.index });
      if (m.type === 'done') { w.terminate(); resolve(null); }
    };
    const positions = current!.positions.slice(), normals = current!.normals.slice();
    w.postMessage({ positions, normals, count, size }, [positions.buffer, normals.buffer]);
  });
  if (workerError) {
    // No WebGL in workers (e.g. WebKitGTK): same renderer on a hidden canvas on the main thread.
    console.warn('worker thumbnails unavailable, falling back to main thread:', workerError);
    mode = 'main-thread-fallback';
    $('thumbgrid').innerHTML = ''; written = 0; per.length = 0;
    const hidden = document.createElement('canvas'); hidden.width = size; hidden.height = size;
    await renderThumbnailSeries(hidden, current!.positions.slice(), current!.normals.slice(), count, size, async (ev) => { if (ev.type === 'error') throw new Error(ev.error); await handle(ev); });
  }
  probing = false;
  viewerPaused = false;
  const totalMs = performance.now() - t0;
  const onDisk = await backend.listThumbnails();
  const avg = (k: keyof typeof per[0]) => per.reduce((a, p) => a + (p[k] as number), 0) / Math.max(per.length, 1);
  const stats = { mode, workerError, count, size, written, onDisk: onDisk.count, onDiskBytes: onDisk.bytes, dir: onDisk.dir, workerGlRenderer: glRenderer, workerSetupMs: Math.round(setupMs), avgRenderMs: +avg('renderMs').toFixed(1), avgEncodeMs: +avg('encodeMs').toFixed(1), avgIpcWriteMs: +avg('ipcMs').toFixed(1), avgPngKB: Math.round(avg('bytes') / 1024), totalMs: Math.round(totalMs), perThumbMs: Math.round(totalMs / count), worstMainThreadFrameGapMs: Math.round(worstFrameGap) };
  kv('thumbStats', [['Mode', mode === 'worker' ? 'worker (OffscreenCanvas)' : 'main-thread fallback: ' + workerError, mode === 'worker' ? 'ok' : 'warn'], ['Written / on disk', `${written} / ${onDisk.count}`, onDisk.count === count ? 'ok' : 'err'], ['Worker GL renderer', glRenderer], ['Worker setup', fmtMs(setupMs)], ['Avg render', fmtMs(stats.avgRenderMs)], ['Avg PNG encode', fmtMs(stats.avgEncodeMs)], ['Avg IPC write (webview → Rust)', fmtMs(stats.avgIpcWriteMs)], ['Avg PNG size', stats.avgPngKB + ' KB'], ['Total', fmtMs(totalMs)], ['Per thumbnail', fmtMs(stats.perThumbMs)], ['Worst UI frame gap', fmtMs(worstFrameGap), worstFrameGap < 50 ? 'ok' : worstFrameGap < 200 ? 'warn' : 'err'], ['Folder', onDisk.dir]]);
  publish('thumbnails', stats);
  setStatus('thumbnails done');
  return stats;
}

async function hashFolder(path: string) {
  setStatus('hashing in Rust…');
  const h = await backend.scanAndHash(path);
  kv('hashStats', [['Folder', path], ['Files', h.files.toLocaleString()], ['Bytes', fmtMB(h.bytes)], ['Time', fmtMs(h.millis)], ['Throughput', h.mb_per_s.toFixed(0) + ' MB/s on ' + h.threads + ' threads'], ...h.sample.map(([f, hx]) => [f.split(/[\\/]/).pop() || f, hx] as [string, string])]);
  publish('hash', { path, ...h });
  setStatus('hash done');
}

function wire() {
  $('gen').onclick = () => generate().catch(fail);
  $('open').onclick = async () => { const p = await backend.pickFile(); if (p) await loadPath(p).catch(fail); };
  $('thumbs').onclick = () => renderThumbnails().catch(fail);
  $('hash').onclick = async () => { const p = await backend.pickFolder(); if (p) await hashFolder(p).catch(fail); };
  $('hashCache').onclick = async () => { const info = await backend.systemInfo(); await hashFolder(info.cache_dir).catch(fail); };
  $('runAll').onclick = async () => {
    const btn = $<HTMLButtonElement>('runAll'); btn.disabled = true;
    try {
      setStatus('running');
      await generate();
      await renderThumbnails();
      if (backend.kind === 'tauri') { const info = await backend.systemInfo(); await hashFolder(info.cache_dir); }
      publish('verdict', verdict());
      setStatus('done');
    } catch (e) { fail(e); } finally { btn.disabled = false; }
  };
}
function verdict() {
  const l = results.load as { triangles: number; fpsWhileOrbiting: number; ipcReadMs: number } | undefined;
  const t = results.thumbnails as { mode: string; onDisk: number; count: number; perThumbMs: number; worstMainThreadFrameGapMs: number } | undefined;
  return {
    stlLoads1M: !!l && l.triangles >= 1_000_000,
    orbitFpsOk: !!l && l.fpsWhileOrbiting >= 30,
    ipcReadUnder2s: !!l && l.ipcReadMs < 2000,
    thumbnailsOnDisk: !!t && t.onDisk === t.count,
    thumbnailsOffUiThread: !!t && t.mode === 'worker',
    thumbnailsUnder2sEach: !!t && t.perThumbMs < 2000,
    uiStayedResponsive: !!t && t.mode === 'worker' && t.worstMainThreadFrameGapMs < 200,
  };
}
function fail(e: unknown) { viewerPaused = false; console.error(e); setStatus('error: ' + (e instanceof Error ? e.message : String(e))); publish('error', String(e)); }

(async () => {
  backend = await createBackend();
  const info = await backend.systemInfo();
  $('mode').textContent = backend.kind === 'tauri' ? `Tauri runtime · ${info.os} ${info.arch} · webview ${info.webview}${info.e2e_feature ? ' · e2e build' : ''}` : 'Browser mode: Rust commands are mocked in memory, workers and WebGL are real.';
  const offscreen = typeof OffscreenCanvas !== 'undefined';
  kv('envStats', [['Runtime', backend.kind], ['OS', `${info.os} ${info.arch}`], ['WebView', info.webview], ['CPUs', String(info.cpus)], ['User agent', navigator.userAgent], ['WebGL', glInfo.webgl2 ? 'WebGL2' : 'WebGL1', glInfo.webgl2 ? 'ok' : 'warn'], ['GL renderer', String(glInfo.renderer)], ['OffscreenCanvas', offscreen ? 'yes' : 'no', offscreen ? 'ok' : 'err'], ['Cache dir', info.cache_dir]]);
  publish('env', { runtime: backend.kind, ...info, userAgent: navigator.userAgent, gl: glInfo, offscreenCanvas: offscreen, hardwareConcurrency: navigator.hardwareConcurrency });
  wire();
})();
