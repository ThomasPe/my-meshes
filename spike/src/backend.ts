// Thin backend facade. In the Tauri app it calls Rust commands; in a plain browser
// (vite dev/preview, Playwright) it falls back to an in-memory mock so the UI and the
// workers can be exercised without the shell. This split is the pattern the real app
// will use for its browser-mode UI tests.
import { generateStl } from './stl-shared';

export interface GenResult { path: string; bytes: number; triangles: number; millis: number }
export interface WriteResult { path: string; bytes: number }
export interface ThumbList { dir: string; count: number; bytes: number; files: string[] }
export interface HashResult { files: number; bytes: number; millis: number; mb_per_s: number; threads: number; sample: [string, string][] }
export interface SystemInfo { os: string; arch: string; webview: string; cpus: number; cache_dir: string; e2e_feature: boolean }

export interface Backend {
  kind: 'tauri' | 'browser-mock';
  generateTestStl(triangles: number): Promise<GenResult>;
  readFile(path: string): Promise<ArrayBuffer>;
  writeThumbnail(name: string, png: ArrayBuffer): Promise<WriteResult>;
  listThumbnails(): Promise<ThumbList>;
  clearThumbnails(): Promise<void>;
  scanAndHash(path: string): Promise<HashResult>;
  systemInfo(): Promise<SystemInfo>;
  pickFile(): Promise<string | null>;
  pickFolder(): Promise<string | null>;
}

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

async function tauriBackend(): Promise<Backend> {
  const { invoke } = await import('@tauri-apps/api/core');
  const { open } = await import('@tauri-apps/plugin-dialog');
  return {
    kind: 'tauri',
    generateTestStl: (triangles) => invoke<GenResult>('generate_test_stl', { triangles }),
    readFile: (path) => invoke<ArrayBuffer>('read_file', { path }),
    writeThumbnail: (name, png) => invoke<WriteResult>('write_thumbnail', new Uint8Array(png), { headers: { 'x-name': name } }),
    listThumbnails: () => invoke<ThumbList>('list_thumbnails'),
    clearThumbnails: () => invoke<void>('clear_thumbnails'),
    scanAndHash: (path) => invoke<HashResult>('scan_and_hash', { path }),
    systemInfo: () => invoke<SystemInfo>('system_info'),
    pickFile: async () => { const r = await open({ multiple: false, directory: false, filters: [{ name: '3D models', extensions: ['stl'] }] }); return typeof r === 'string' ? r : null; },
    pickFolder: async () => { const r = await open({ multiple: false, directory: true }); return typeof r === 'string' ? r : null; },
  };
}

function mockBackend(): Backend {
  const files = new Map<string, ArrayBuffer>();
  const thumbs = new Map<string, number>();
  return {
    kind: 'browser-mock',
    async generateTestStl(triangles) {
      const t = performance.now();
      const buf = generateStl(triangles);
      const path = `mock://test_${Math.round((buf.byteLength - 84) / 50 / 1000)}k_tris.stl`;
      files.set(path, buf);
      return { path, bytes: buf.byteLength, triangles: (buf.byteLength - 84) / 50, millis: Math.round(performance.now() - t) };
    },
    async readFile(path) { const b = files.get(path); if (!b) throw new Error('mock: no such file ' + path); return b.slice(0); },
    async writeThumbnail(name, png) { thumbs.set(name, png.byteLength); return { path: `mock://thumbs/${name}.png`, bytes: png.byteLength }; },
    async listThumbnails() { return { dir: 'mock://thumbs', count: thumbs.size, bytes: [...thumbs.values()].reduce((a, b) => a + b, 0), files: [...thumbs.keys()].map(k => k + '.png') }; },
    async clearThumbnails() { thumbs.clear(); },
    async scanAndHash() { throw new Error('Hashing needs the Rust backend (not available in browser mode)'); },
    async systemInfo() { return { os: navigator.platform, arch: 'n/a', webview: 'browser: ' + navigator.userAgent.split(') ').pop(), cpus: navigator.hardwareConcurrency || 0, cache_dir: 'in-memory', e2e_feature: false }; },
    async pickFile() { return null; },
    async pickFolder() { return null; },
  };
}

export async function createBackend(): Promise<Backend> {
  return isTauri ? tauriBackend() : mockBackend();
}
