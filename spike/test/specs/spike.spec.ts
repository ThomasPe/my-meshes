import { browser, $, expect } from '@wdio/globals';
import { writeFileSync, mkdirSync } from 'node:fs';

// Spike acceptance, run against the real Windows build:
//  (a) a 1M-triangle (50 MB) STL loads into Three.js inside WebView2,
//  (b) 20 thumbnails are rendered in a worker and written to disk by Rust,
//  (c) this very test proves WebDriver automation of the Tauri app works in CI.
describe('My Meshes spike', () => {
  afterEach(async function () {
    // Failure evidence, as the spec in docs/spec/04-quality.md demands.
    mkdirSync('logs', { recursive: true });
    const name = (this.currentTest?.title || 'test').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    try { await browser.saveScreenshot(`logs/${name}.png`); } catch { /* window may be gone */ }
  });

  it('shows the Tauri runtime, not browser mode', async () => {
    const mode = await $('#mode');
    await mode.waitForDisplayed();
    await browser.waitUntil(async () => (await mode.getText()).includes('Tauri runtime'), { timeout: 20000, timeoutMsg: 'app did not report the Tauri runtime' });
    expect(await mode.getText()).toContain('e2e build');
  });

  it('loads a 1M-triangle STL and writes 20 thumbnails', async () => {
    await $('[data-testid="tris"]').setValue('1000000');
    await $('[data-testid="thumb-count"]').setValue('20');
    await $('[data-testid="run-all"]').click();
    const status = await $('[data-testid="status"]');
    await browser.waitUntil(async () => /^(done|error)/.test(await status.getText()), { timeout: 240000, timeoutMsg: 'spike did not finish in 4 minutes' });
    const results = JSON.parse(await $('[data-testid="results"]').getText());
    mkdirSync('logs', { recursive: true });
    writeFileSync('logs/spike-results.json', JSON.stringify(results, null, 2));

    expect(await status.getText()).toBe('done');
    const tri = Number(await $('[data-testid="tri-count"]').getText());
    expect(tri).toBeGreaterThanOrEqual(1_000_000);
    expect(Number(await $('[data-testid="thumbs-written"]').getText())).toBe(20);

    // Disk-side assertion through the backend, independent of what the UI claims.
    const onDisk = await browser.tauri.execute(({ core }) => core.invoke('list_thumbnails')) as { count: number; bytes: number; dir: string };
    expect(onDisk.count).toBe(20);
    expect(onDisk.bytes).toBeGreaterThan(20 * 1024);

    // Soft performance expectations, reported rather than failed on slow CI GPUs (SwiftShader).
    const v = results.verdict as Record<string, boolean>;
    console.log('SPIKE VERDICT', JSON.stringify(v), 'load', JSON.stringify(results.load), 'thumbs', JSON.stringify(results.thumbnails));
    expect(v.stlLoads1M).toBe(true);
    expect(v.thumbnailsOnDisk).toBe(true);
  });
});
