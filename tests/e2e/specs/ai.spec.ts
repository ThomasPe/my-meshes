import { browser, $, $$, expect } from '@wdio/globals';

import fs from 'node:fs';
import path from 'node:path';

// AI assistance (ADR-0003, Epic 9) against the real app in test mode with MESHKEEP_AI_MOCK=ok:
// no call without a key, the key never lands in settings.json, and an applied suggestion is
// written through the normal sidecar save.
describe('Meshkeep AI assistance (mock provider)', () => {
  const dataDir = () => process.env.MESHKEEP_E2E_DATA_DIR!;
  const fixture = () => process.env.MESHKEEP_E2E_FIXTURE!;
  const KEY = 'sk-ant-e2e-secret-key-value';

  afterEach(async function () {
    fs.mkdirSync('logs', { recursive: true });
    const name = (this.currentTest?.title || 'test').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    try { await browser.saveScreenshot(`logs/${name}.png`); } catch { /* window may be gone */ }
  });

  it('refuses to call the provider without a key and keeps the key out of settings.json', async () => {
    await $('[data-testid="app"]').waitForDisplayed({ timeout: 30000 });
    await browser.url(await browser.getUrl().then((u) => u.split('#')[0] + '#/settings'));
    await $('[data-testid="settings"]').waitForDisplayed({ timeout: 20000 });
    await expect($('[data-testid="ai-key-status"]')).toHaveAttribute('data-state', 'missing');
    // the engine gate: a suggestion without a key fails before any provider is touched
    const gated = await browser.tauri.execute(({ core }) => core.invoke('suggest_metadata', { projectId: 'nope' }).then(() => 'ok', (e: { code: string }) => e.code));
    expect(gated).toBe('ai_disabled');
    // endpoint and model persist in settings.json
    await $('[data-testid="ai-model"]').setValue('e2e-model');
    await $('[data-testid="ai-save"]').click();
    const settingsFile = path.join(dataDir(), 'settings.json');
    await browser.waitUntil(() => fs.existsSync(settingsFile) && fs.readFileSync(settingsFile, 'utf8').includes('e2e-model'), { timeout: 10000, timeoutMsg: 'ai settings were not written' });
    // the key is stored (in memory in test mode), never written to settings.json
    await $('[data-testid="ai-key"]').setValue(KEY);
    await $('[data-testid="ai-key-save"]').click();
    await browser.waitUntil(async () => (await $('[data-testid="ai-key-status"]').getAttribute('data-state')) === 'stored', { timeout: 10000 });
    expect(await $('[data-testid="ai-key"]').getValue()).toBe('');
    await $('[data-testid="ai-test"]').click();
    await browser.waitUntil(async () => (await $('[data-testid="ai-test-status"]').getAttribute('data-state')) === 'ok', { timeout: 15000, timeoutMsg: 'connection test did not succeed' });
    const text = fs.readFileSync(settingsFile, 'utf8');
    expect(text).toContain('e2e-model');
    expect(text).not.toContain(KEY);
    expect(text.toLowerCase()).not.toContain('sk-ant');
  });

  it('applies a suggestion through the sidecar save and writes project.yaml', async () => {
    await browser.url(await browser.getUrl().then((u) => u.split('#')[0] + '#/library'));
    await $('[data-testid="library"]').waitForDisplayed({ timeout: 20000 });
    await $('[data-testid="search"]').setValue('Vase');
    const card = await $('[data-testid="project-card"][data-id$="Decor/Vase"]');
    await card.waitForDisplayed({ timeout: 15000 });
    await card.click();
    await expect($('[data-testid="inspector-title"]')).toHaveText('Vase');
    await $('[data-testid="inspector-suggest"]').click();
    await $('[data-testid="suggest-dialog"]').waitForDisplayed({ timeout: 10000 });
    await browser.waitUntil(async () => (await $$('[data-testid="suggest-field"]')).length >= 2, { timeout: 15000, timeoutMsg: 'no suggestion fields appeared' });
    expect(await $('[data-testid="suggest-meta"]').getText()).toContain('Model: mock');
    await $('[data-testid="suggest-apply"]').click();
    const sidecar = path.join(fixture(), 'Decor/Vase/project.yaml');
    await browser.waitUntil(() => fs.existsSync(sidecar), { timeout: 10000, timeoutMsg: 'project.yaml was not written' });
    const yaml = fs.readFileSync(sidecar, 'utf8');
    expect(yaml).toContain('Mock Creator');
    expect(yaml).toContain('- mock');
    await browser.waitUntil(async () => (await $('[data-testid="inspector"]').getText()).includes('project.yaml in sync'), { timeout: 15000 });
    // the answer is a cache entry in app data, never library content
    expect(fs.readdirSync(path.join(dataDir(), 'ai-cache')).filter((f) => f.endsWith('.json')).length).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(path.join(fixture(), 'Decor/Vase/ai-cache'))).toBe(false);
    fs.unlinkSync(sidecar); // leave the fixture as it was
    await $('[data-testid="search"]').clearValue();
    await browser.waitUntil(async () => (await $('[data-testid="search"]').getValue()) === '', { timeout: 5000 });
  });
});
