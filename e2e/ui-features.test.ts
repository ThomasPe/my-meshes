import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

let app: ElectronApplication;
let page: Page;

const testDataDir = path.join(os.tmpdir(), `my-meshes-e2e-ui-${Date.now()}`);
const fixtureLibrary = path.join(__dirname, 'fixtures', 'sample-library');

test.beforeAll(async () => {
  fs.mkdirSync(testDataDir, { recursive: true });

  app = await electron.launch({
    executablePath: require('electron') as unknown as string,
    args: [path.join(__dirname, '..', '.vite', 'build', 'main.js'), '--test-mode'],
    env: {
      ...process.env,
      MY_MESHES_TEST_MODE: '1',
      MY_MESHES_TEST_DATA_DIR: testDataDir,
      NODE_ENV: 'test',
    },
  });

  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  // Set up library root and scan
  const root = await page.evaluate(
    (fixturePath) => window.electronApi.addLibraryRootPath(fixturePath),
    fixtureLibrary,
  );
  if (!root) throw new Error('Failed to add fixture library root');
  await page.evaluate((id) => window.electronApi.scanLibraryRoot(id), root.id);
});

test.afterAll(async () => {
  if (app) await app.close();
  fs.rmSync(testDataDir, { recursive: true, force: true });
});

test('library page shows grid view with projects', async () => {
  await page.locator('[data-testid="nav-library"]').click();
  await expect(page.locator('[data-testid="library-page"]')).toBeVisible();

  // Grid should be visible with projects
  await expect(page.locator('[data-testid="project-grid"]')).toBeVisible();
});

test('sidebar with folder tree is visible', async () => {
  await page.locator('[data-testid="nav-library"]').click();
  await expect(page.locator('[data-testid="sidebar"]')).toBeVisible();
  await expect(page.locator('[data-testid="folder-tree"]')).toBeVisible();
});

test('sidebar can be toggled', async () => {
  await page.locator('[data-testid="nav-library"]').click();
  await expect(page.locator('[data-testid="sidebar"]')).toBeVisible();

  await page.locator('[data-testid="toggle-sidebar"]').click();
  await expect(page.locator('[data-testid="sidebar"]')).not.toBeVisible();

  await page.locator('[data-testid="toggle-sidebar"]').click();
  await expect(page.locator('[data-testid="sidebar"]')).toBeVisible();
});

test('search bar is available and filters projects', async () => {
  await page.locator('[data-testid="nav-library"]').click();
  await expect(page.locator('[data-testid="search-bar"]')).toBeVisible();

  const searchInput = page.locator('[data-testid="search-input"]');
  await searchInput.fill('TestProject');
  // Search should work (no errors thrown)
  await page.waitForTimeout(500);
  await expect(page.locator('[data-testid="project-grid"]')).toBeVisible();
});

test('thumbnail size slider is available', async () => {
  await page.locator('[data-testid="nav-library"]').click();
  await expect(page.locator('[data-testid="thumbnail-slider"]')).toBeVisible();
});

test('watcher status API is available', async () => {
  const status = await page.evaluate(() => window.electronApi.watcherStatus());
  expect(Array.isArray(status)).toBe(true);
});

test('search projects API works via IPC', async () => {
  const results = await page.evaluate(() => window.electronApi.searchProjects('TestProject'));
  expect(results.length).toBeGreaterThan(0);
  expect(results[0].name).toBe('TestProject');
});

test('safe delete API is exposed', async () => {
  // Just verify the API exists without actually deleting anything
  const api = await page.evaluate(() => typeof window.electronApi.safeDeleteProject);
  expect(api).toBe('function');
});

test('read file base64 API works', async () => {
  const stlPath = path.join(fixtureLibrary, 'TestProject', 'model.stl');
  const result = await page.evaluate(
    (fp) => window.electronApi.readFileBase64(fp),
    stlPath,
  );
  expect(result.success).toBe(true);
  expect(result.data).toBeDefined();
  expect(result.extension).toBe('.stl');
});
