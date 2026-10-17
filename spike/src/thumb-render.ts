// Thumbnail rendering shared by the worker (OffscreenCanvas) and the main-thread fallback
// (hidden <canvas>, used where a webview has no WebGL in workers, e.g. WebKitGTK).
import * as THREE from 'three';

export type ThumbEvent =
  | { type: 'ready'; setupMs: number; glRenderer: string }
  | { type: 'thumb'; index: number; png: ArrayBuffer; renderMs: number; encodeMs: number }
  | { type: 'done'; totalMs: number }
  | { type: 'error'; error: string };

type CanvasLike = OffscreenCanvas | { width: number; height: number; toBlob(cb: (b: Blob | null) => void, type?: string): void };

async function encodePng(canvas: CanvasLike): Promise<ArrayBuffer> {
  const blob = 'convertToBlob' in canvas
    ? await canvas.convertToBlob({ type: 'image/png' })
    : await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob returned null'))), 'image/png'));
  return blob.arrayBuffer();
}

export async function renderThumbnailSeries(
  canvas: CanvasLike, positions: Float32Array, normals: Float32Array, count: number, size: number,
  emit: (ev: ThumbEvent, transfer?: Transferable[]) => void | Promise<void>,
): Promise<void> {
  const t0 = performance.now();
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: canvas as unknown as OffscreenCanvas, antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  } catch (err) { await emit({ type: 'error', error: 'WebGL context failed: ' + String(err) }); return; }
  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);
  renderer.setClearColor(0x000000, 0);
  const gl = renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const glRenderer = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geom.computeBoundingSphere();
  const bs = geom.boundingSphere!;
  const mesh = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ color: 0x0f8b8d, roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide }));
  mesh.position.sub(bs.center);
  const scene = new THREE.Scene();
  scene.add(mesh, new THREE.HemisphereLight(0xffffff, 0x334155, 1.2));
  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(1, 1.2, 1.5); scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.5); fill.position.set(-1.5, 0.4, -1); scene.add(fill);
  const camera = new THREE.PerspectiveCamera(35, 1, bs.radius * 0.01, bs.radius * 20);
  await emit({ type: 'ready', setupMs: performance.now() - t0, glRenderer });

  for (let i = 0; i < count; i++) {
    const tr = performance.now();
    const a = (i / count) * Math.PI * 2;
    const el = 0.35 + 0.5 * Math.sin(i * 0.9);
    const d = bs.radius * 2.9;
    camera.position.set(Math.cos(a) * Math.cos(el) * d, Math.sin(el) * d, Math.sin(a) * Math.cos(el) * d);
    camera.up.set(0, 0, 1);
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
    gl.finish();
    const renderMs = performance.now() - tr;
    const te = performance.now();
    const png = await encodePng(canvas);
    const encodeMs = performance.now() - te;
    await emit({ type: 'thumb', index: i, png, renderMs, encodeMs }, [png]);
    // Give the event loop a tick on the main-thread fallback so the UI can repaint.
    if (!('convertToBlob' in canvas)) await new Promise((r) => setTimeout(r, 0));
  }
  renderer.dispose();
  geom.dispose();
  await emit({ type: 'done', totalMs: performance.now() - t0 });
}
