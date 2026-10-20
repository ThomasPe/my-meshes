// Offscreen thumbnail renderer shared by the worker (OffscreenCanvas) and the main-thread
// fallback (hidden <canvas>, for webviews without WebGL in workers, e.g. WebKitGTK).
// One renderer per canvas is kept alive; each call swaps the mesh, frames it, renders a
// single frame and encodes a PNG. Ported from the spike's thumb-render.ts.
import * as THREE from 'three';
import { srgbToLinear } from '@/lib/mesh/types';
import type { ParsedMesh } from '@/lib/mesh/types';

export const THUMB_SIZE = 512;

// Structural type so this file compiles under both the DOM and the WebWorker lib:
// an OffscreenCanvas, or a main-thread <canvas> (which has toBlob instead of convertToBlob).
interface MainCanvas { width: number; height: number; getContext(id: '2d'): unknown; toBlob(cb: (b: Blob | null) => void, type?: string): void }
export type CanvasLike = OffscreenCanvas | MainCanvas;

async function encodePng(canvas: CanvasLike): Promise<ArrayBuffer> {
  const blob = 'convertToBlob' in canvas
    ? await canvas.convertToBlob({ type: 'image/png' })
    : await new Promise<Blob>((res, rej) => canvas.toBlob((b: Blob | null) => (b ? res(b) : rej(new Error('toBlob returned null'))), 'image/png'));
  return blob.arrayBuffer();
}

export class ThumbRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.1, 1000);
  private material = new THREE.MeshStandardMaterial({ color: 0x0f8b8d, roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide });
  private colored = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide });
  private mesh: THREE.Mesh | null = null;
  readonly glRenderer: string;

  constructor(private canvas: CanvasLike, size = THUMB_SIZE) {
    this.renderer = new THREE.WebGLRenderer({ canvas: canvas as OffscreenCanvas, antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(size, size, false);
    this.renderer.setClearColor(0x000000, 0);
    const gl = this.renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    this.glRenderer = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 1.2));
    const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(1, 1.2, 1.5); this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.5); fill.position.set(-1.5, 0.4, -1); this.scene.add(fill);
  }

  /** Renders one mesh from a three-quarter view and returns PNG bytes. */
  async render(parsed: ParsedMesh): Promise<ArrayBuffer> {
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh = null; }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(parsed.positions, 3));
    geom.setAttribute('normal', new THREE.BufferAttribute(parsed.normals, 3));
    if (parsed.colors) geom.setAttribute('color', new THREE.BufferAttribute(srgbToLinear(parsed.colors), 3));
    geom.computeBoundingSphere();
    const bs = geom.boundingSphere!;
    if (!Number.isFinite(bs.radius) || bs.radius <= 0) { geom.dispose(); throw new Error('degenerate geometry'); }
    const mesh = new THREE.Mesh(geom, parsed.colors ? this.colored : this.material);
    mesh.position.sub(bs.center);
    this.scene.add(mesh);
    this.mesh = mesh;
    const d = bs.radius * 3.1;
    // Z-up models (3D printing): look from front-right, slightly above.
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(d * 0.62, -d * 0.66, d * 0.42);
    this.camera.near = Math.max(bs.radius / 100, 0.01);
    this.camera.far = bs.radius * 20;
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
    const png = await encodePng(this.canvas);
    this.scene.remove(mesh);
    geom.dispose();
    this.mesh = null;
    return png;
  }

  dispose() {
    this.material.dispose();
    this.renderer.dispose();
  }
}

/** Draws an image (photo, embedded preview) cover-fitted into a square PNG. */
export async function imageToThumb(bytes: ArrayBuffer, canvas: CanvasLike, size = THUMB_SIZE): Promise<ArrayBuffer> {
  const bitmap = await createImageBitmap(new Blob([bytes]));
  try {
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | null;
    if (!ctx) throw new Error('2d context unavailable');
    ctx.clearRect(0, 0, size, size);
    const scale = Math.max(size / bitmap.width, size / bitmap.height);
    const w = bitmap.width * scale, h = bitmap.height * scale;
    ctx.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h);
    return await encodePng(canvas);
  } finally {
    bitmap.close();
  }
}
