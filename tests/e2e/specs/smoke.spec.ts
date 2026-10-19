import { browser, $, $$, expect } from '@wdio/globals';

import fs from 'node:fs';
import path from 'node:path';

// Acceptance for the walking skeleton against the real app (docs/spec/04-quality.md):
// the window becomes interactive, the seeded fixture root is indexed, and a metadata edit
// lands on disk as project.yaml.
describe('Meshkeep (test mode, fixture library)', () => {
  afterEach(async function () {
    fs.mkdirSync('logs', { recursive: true });
    const name = (this.currentTest?.title || 'test').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    try { await browser.saveScreenshot(`logs/${name}.png`); } catch { /* window may be gone */ }
  });

  it('starts, is a test-mode build and shows the fixture projects', async () => {
    await $('[data-testid="app"]').waitForDisplayed({ timeout: 30000 });
    await browser.url(await browser.getUrl().then((u) => u.split('#')[0] + '#/library'));
    await $('[data-testid="library"]').waitForDisplayed({ timeout: 20000 });
    await browser.waitUntil(async () => (await $$('[data-testid="project-card"]')).length >= 5, { timeout: 30000, timeoutMsg: 'fixture projects did not appear' });
    const titles = await $$('[data-testid="project-card"] h4').map((h) => h.getText());
    expect(titles).toContain('Gridfinity Bins');   // from project.yaml
    expect(titles).toContain('Baseplates');        // derived from the folder name
    expect(titles).toContain('Arm v4');            // nested project.yaml is a warning, not a project
    expect(titles).toContain('Broken');            // malformed sidecar still indexed
    expect(titles).not.toContain('Docs');
  });

  it('adds a tag through the inspector and writes project.yaml on disk', async () => {
    const card = await $('[data-testid="project-card"][data-id$="Decor/Vase"]');
    await card.click();
    await expect($('[data-testid="inspector-title"]')).toHaveText('Vase');
    await $('[data-testid="tag-add"]').click();
    await $('[data-testid="tag-input"]').setValue('e2e-tag');
    await browser.keys('Enter');
    await browser.waitUntil(async () => (await $('[data-testid="inspector"]').getText()).includes('project.yaml in sync'), { timeout: 15000 });
    const sidecar = path.join(process.env.MESHKEEP_E2E_FIXTURE!, 'Decor/Vase/project.yaml');
    await browser.waitUntil(() => fs.existsSync(sidecar), { timeout: 10000, timeoutMsg: 'project.yaml was not written' });
    const text = fs.readFileSync(sidecar, 'utf8');
    expect(text).toContain('e2e-tag');
    fs.unlinkSync(sidecar); // leave the fixture as it was
  });

  it('opens a project and renders the STL in the viewer', async () => {
    await $('[data-testid="inspector-open"]').click();
    await $('[data-testid="project-page"]').waitForDisplayed();
    await browser.waitUntil(async () => (await $$('[data-testid="viewer-triangles"]')).length > 0, { timeout: 30000, timeoutMsg: 'viewer did not report triangles' });
    const tri = await $('[data-testid="viewer-triangles"]').getText();
    expect(tri).toMatch(/\d+ (triangles|Dreiecke)/);
  });

  it('settings shows the isolated data dir and test mode', async () => {
    await $('[data-testid="nav-settings"]').click();
    await $('[data-testid="settings"]').waitForDisplayed();
    const dir = await $('[data-testid="data-dir"]').getText();
    expect(dir).toContain('meshkeep-e2e-');
    expect(await $('[data-testid="root-scan-summary"]').getText()).toMatch(/^\d+ projects · \d+ files/);
    const info = await browser.tauri.execute(({ core }) => core.invoke('app_info')) as { testMode: boolean; e2eBuild: boolean };
    expect(info.testMode).toBe(true);
    expect(info.e2eBuild).toBe(true);
  });
});

// ---- D2: thumbnails, favorites, rename against the real engine --------------------------
describe('Meshkeep D2 (thumbnails, favorites, rename, 3MF)', () => {
  const fixture = () => process.env.MESHKEEP_E2E_FIXTURE!;

  it('renders thumbnails into the app data cache and shows them on cards', async () => {
    await browser.url(await browser.getUrl().then((u) => u.split('#')[0] + '#/library'));
    await $('[data-testid="library"]').waitForDisplayed({ timeout: 20000 });
    await browser.waitUntil(async () => (await $$('[data-testid="thumb-img"]')).length >= 3, { timeout: 90000, timeoutMsg: 'no thumbnails appeared' });
    const dataDir = (await browser.tauri.execute(({ core }) => core.invoke('app_info')) as { dataDir: string }).dataDir;
    const thumbs = fs.readdirSync(path.join(dataDir, 'thumbs')).filter((f) => f.endsWith('.png'));
    expect(thumbs.length).toBeGreaterThanOrEqual(3);
    // the slicer 3MF got its embedded preview (no rendering) and a badge
    const plate = await $('[data-testid="project-card"][data-id$="Slicer/Plate"]');
    await expect(plate.$('[data-testid="slicer-badge"]')).toBeDisplayed();
    await browser.waitUntil(async () => plate.$('[data-testid="thumb-img"]').isDisplayed(), { timeout: 60000, timeoutMsg: 'embedded 3MF preview did not appear' });
  });

  it('favorites persist in collections.json and survive a rescan', async () => {
    const card = await $('[data-testid="project-card"][data-id$="Gridfinity/Bins"]');
    await card.moveTo();
    await card.$('[data-testid="card-favorite"]').click();
    await browser.waitUntil(async () => (await $('[data-testid="favorites-count"]').getText()) === '1', { timeout: 10000 });
    const dataDir = (await browser.tauri.execute(({ core }) => core.invoke('app_info')) as { dataDir: string }).dataDir;
    const file = path.join(dataDir, 'collections.json');
    await browser.waitUntil(() => fs.existsSync(file), { timeout: 5000 });
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).favorites.some((id: string) => id.endsWith('Gridfinity/Bins'))).toBe(true);
    await $('[data-testid="rescan"]').click();
    await browser.pause(1500);
    await $('[data-testid="filter-favorites"]').click();
    await browser.waitUntil(async () => (await $('[data-testid="result-count"]').getText()) === '1', { timeout: 10000 });
    await $('[data-testid="filter-all"]').click();
  });

  it('renames the project directory on disk and refuses collisions', async () => {
    const card = await $('[data-testid="project-card"][data-id$="Gridfinity/Baseplates"]');
    await card.click();
    await $('[data-testid="inspector-rename"]').click();
    await $('[data-testid="rename-input"]').waitForDisplayed();
    await $('[data-testid="rename-input"]').setValue('Bins');
    await $('[data-testid="rename-confirm"]').click();
    await $('[data-testid="rename-error"]').waitForDisplayed();
    await $('[data-testid="rename-input"]').setValue('Baseplates E2E');
    await $('[data-testid="rename-confirm"]').click();
    const renamed = path.join(fixture(), 'Gridfinity/Baseplates E2E');
    await browser.waitUntil(() => fs.existsSync(renamed), { timeout: 10000, timeoutMsg: 'directory was not renamed' });
    await browser.waitUntil(async () => (await $$('[data-testid="project-card"][data-id$="Gridfinity/Baseplates E2E"]')).length === 1, { timeout: 10000 });
    // rename back through the UI so the fixture is left untouched
    await $('[data-testid="inspector-rename"]').click();
    await $('[data-testid="rename-input"]').waitForDisplayed();
    await $('[data-testid="rename-input"]').setValue('Baseplates');
    await $('[data-testid="rename-confirm"]').click();
    await browser.waitUntil(() => fs.existsSync(path.join(fixture(), 'Gridfinity/Baseplates')) && !fs.existsSync(renamed), { timeout: 10000 });
  });

  it('opens the 3MF project and renders its geometry in the viewer', async () => {
    await $('[data-testid="filter-all"]').click();
    const card = await $('[data-testid="project-card"][data-id$="Slicer/Plate"]');
    await card.scrollIntoView();
    await card.click();
    await $('[data-testid="inspector-open"]').click();
    await $('[data-testid="project-page"]').waitForDisplayed();
    await browser.waitUntil(async () => (await $$('[data-testid="viewer-triangles"]')).length > 0, { timeout: 30000 });
    expect(await $('[data-testid="viewer-triangles"]').getText()).toMatch(/24 /);
  });
});

// ---- D3: import, inbox, collections against the real engine ----------------------------
describe('Meshkeep D3 (import, inbox, collections)', () => {
  const fixture = () => process.env.MESHKEEP_E2E_FIXTURE!;
  const dataDir = async () => (await browser.tauri.execute(({ core }) => core.invoke('app_info')) as { dataDir: string }).dataDir;

  it('imports a bundle zip as a project and a loose file into the inbox', async () => {
    await browser.url(await browser.getUrl().then((u) => u.split('#')[0] + '#/library'));
    await $('[data-testid="library"]').waitForDisplayed({ timeout: 20000 });
    await $('[data-testid="filter-all"]').click();
    await $('[data-testid="import-open"]').click(); // MESHKEEP_PICK_FILES answers the picker
    await $('[data-testid="import-dialog"]').waitForDisplayed();
    await browser.waitUntil(async () => (await $$('[data-testid="import-item"]')).length === 2, { timeout: 10000 });
    const names = await $$('[data-testid="import-item"]').map((r) => r.getText());
    expect(names.join('\n')).toContain('Cable Clip.zip');
    expect(names.join('\n')).toContain('loose_hook.stl');
    await $('[data-testid="import-confirm"]').click();
    await browser.waitUntil(async () => !(await $('[data-testid="import-dialog"]').isDisplayed()), { timeout: 30000 });
    const project = path.join(fixture(), 'Cable Clip');
    await browser.waitUntil(() => fs.existsSync(path.join(project, 'files/clip_6mm.stl')), { timeout: 10000, timeoutMsg: 'archive was not extracted' });
    expect(fs.existsSync(path.join(project, 'Cable Clip.zip'))).toBe(true); // kept as attachment (default policy)
    expect(fs.existsSync(path.join(fixture(), '_Inbox/loose_hook.stl'))).toBe(true);
    await browser.waitUntil(async () => (await $$('[data-testid="project-card"][data-id$="Cable Clip"]')).length === 1, { timeout: 10000 });
    await $('[data-testid="filter-inbox"]').click();
    await $('[data-testid="inbox"]').waitForDisplayed();
    await browser.waitUntil(async () => (await $$('[data-testid="inbox-row"]')).length === 1, { timeout: 10000 });
  });

  it('promotes the inbox file to a project directory', async () => {
    await $('[data-testid="inbox-row"]').click();
    await $('[data-testid="inbox-promote"]').click();
    await $('[data-testid="promote-name"]').waitForDisplayed();
    await $('[data-testid="promote-name"]').setValue('Hook');
    await $('[data-testid="promote-confirm"]').click();
    await $('[data-testid="project-page"]').waitForDisplayed({ timeout: 15000 });
    expect(fs.existsSync(path.join(fixture(), 'Hook/loose_hook.stl'))).toBe(true);
    expect(fs.existsSync(path.join(fixture(), '_Inbox/loose_hook.stl'))).toBe(false);
    await $('[data-testid="back"]').click();
    await $('[data-testid="library"]').waitForDisplayed();
  });

  it('collections persist in collections.json', async () => {
    await $('[data-testid="filter-all"]').click();
    await $('[data-testid="collection-new"]').click();
    await $('[data-testid="collection-name"]').waitForDisplayed();
    await $('[data-testid="collection-name"]').setValue('E2E Set');
    await $('[data-testid="collection-confirm"]').click();
    await browser.waitUntil(async () => (await $$('[data-testid="filter-collection"]')).length === 1, { timeout: 10000 });
    const file = path.join(await dataDir(), 'collections.json');
    await browser.waitUntil(() => fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).collections?.length === 1, { timeout: 5000 });
    // clean up the fixture: remove what the import created
    fs.rmSync(path.join(fixture(), 'Cable Clip'), { recursive: true, force: true });
    fs.rmSync(path.join(fixture(), 'Hook'), { recursive: true, force: true });
    fs.rmSync(path.join(fixture(), '_Inbox'), { recursive: true, force: true });
  });
});

// ---- D5: facets, batch edits, persisted settings, project-side previews -----------------
describe('Meshkeep D5 (facets, batch edit, settings)', () => {
  const fixture = () => process.env.MESHKEEP_E2E_FIXTURE!;
  const dataDir = async () => (await browser.tauri.execute(({ core }) => core.invoke('app_info')) as { dataDir: string }).dataDir;

  it('filters by file type from the inspector facets', async () => {
    await $('[data-testid="nav-library"]').click();
    await $('[data-testid="filter-all"]').click();
    await browser.keys('Escape');
    const obj = await $('[data-testid="facet-filetype"]=OBJ 1');
    await obj.waitForDisplayed();
    await obj.click();
    await browser.waitUntil(async () => (await $('[data-testid="result-count"]').getText()) === '1', { timeout: 10000 });
    expect(await $('[data-testid="project-card"]').getText()).toContain('Arm v4');
    await $('button[aria-label="clear file type"]').click();
    await browser.waitUntil(async () => Number(await $('[data-testid="result-count"]').getText()) > 1, { timeout: 10000 });
  });

  it('batch edit writes project.yaml for every selected project', async () => {
    const ids = (await browser.tauri.execute(({ core }) => core.invoke('list_projects', { query: { text: 'bin' } })) as Array<{ id: string }>).map((p) => p.id);
    expect(ids.length).toBeGreaterThanOrEqual(1);
    const report = await browser.tauri.execute(({ core }, ids) => core.invoke('batch_update_metadata', { projectIds: ids, update: { add_tags: ['Batch-E2E'] } }), ids) as { updated: number; failed: unknown[] };
    expect(report.updated).toBe(ids.length);
    expect(report.failed).toEqual([]);
    const yaml = fs.readFileSync(path.join(fixture(), 'Gridfinity', 'Bins', 'project.yaml'), 'utf8');
    expect(yaml).toContain('batch-e2e');
    await $('[data-testid="nav-library"]').click();
    await browser.waitUntil(async () => (await $$('[data-testid="project-card"] button=batch-e2e')).length >= ids.length, { timeout: 10000 });
  });

  it('preview location persists in settings.json and renders into <project>/.cache/thumbs', async () => {
    await $('[data-testid="nav-settings"]').click();
    await $('[data-testid="thumb-location-project"]').click();
    const file = path.join(await dataDir(), 'settings.json');
    await browser.waitUntil(() => fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).thumb_location === 'project', { timeout: 10000 });
    await $('[data-testid="clear-thumbs"]').click();
    const cache = path.join(fixture(), 'Gridfinity', 'Bins', '.cache', 'thumbs');
    await browser.waitUntil(() => fs.existsSync(cache) && fs.readdirSync(cache).some((f) => f.endsWith('.png')), { timeout: 60000, timeoutMsg: 'no project-side thumbnail rendered' });
    // back to the default: the project-side files are removed by the next cache clear
    await $('[data-testid="thumb-location-app"]').click();
    await browser.waitUntil(() => JSON.parse(fs.readFileSync(file, 'utf8')).thumb_location === 'app_data', { timeout: 10000 });
    await $('[data-testid="clear-thumbs"]').click();
    await browser.waitUntil(() => !fs.existsSync(cache), { timeout: 10000 });
  });
});
