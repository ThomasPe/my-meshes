// Browser-mode smoke test: serves dist/ and drives the page in headless Chromium.
// Validates the worker + OffscreenCanvas + PNG path without a Tauri shell.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const root = new URL('../dist/', import.meta.url).pathname;
// Prefer the project's playwright; fall back to a path from the environment (e.g. a preinstalled copy).
const { chromium } = await import('playwright').catch(async () => {
  const { pathToFileURL } = await import('node:url');
  return import(pathToFileURL(process.env.PLAYWRIGHT_PATH || '/usr/lib/node_modules/playwright/index.mjs').href);
});
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  let p = join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!existsSync(p) || statSync(p).isDirectory()) p = join(root, 'index.html');
  res.setHeader('Content-Type', types[extname(p)] || 'application/octet-stream');
  res.end(readFileSync(p));
}).listen(0);
const port = server.address().port;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`http://127.0.0.1:${port}/`);
await page.fill('[data-testid="tris"]', String(process.env.SPIKE_TRIS || 200000));
await page.fill('[data-testid="thumb-count"]', '20');
await page.click('[data-testid="run-all"]');
await page.waitForFunction(() => /^(done|error)/.test(document.querySelector('[data-testid="status"]').textContent), null, { timeout: 180000 });
const status = await page.textContent('[data-testid="status"]');
const results = JSON.parse(await page.textContent('[data-testid="results"]'));
await page.screenshot({ path: process.env.SPIKE_SHOT || 'spike-browser.png' });
await browser.close(); server.close();
console.log(JSON.stringify({ status, verdict: results.verdict, load: results.load, thumbnails: results.thumbnails, errors }, null, 2));
if (!status.startsWith('done') || results.thumbnails?.onDisk !== 20) { console.error('SMOKE FAILED'); process.exit(1); }
