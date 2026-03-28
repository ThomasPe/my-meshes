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

const testDataDir = path.join(os.tmpdir(), `my-meshes-e2e-library-${Date.now()}`);
const fixtureLibrary = path.join(__dirname, 'fixtures', 'sample-library');

// Shared state populated in beforeAll
let rootId: number;

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

  // Pre-populate: add library root and scan it so all tests have data
  const root = await page.evaluate(
    (fixturePath) => window.electronApi.addLibraryRootPath(fixturePath),
    fixtureLibrary,
  );
  if (!root) throw new Error('Failed to add fixture library root in beforeAll');
  rootId = root.id;

  const scanResult = await page.evaluate(
    (id) => window.electronApi.scanLibraryRoot(id),
    rootId,
  );
  if (!scanResult.success) throw new Error('Failed to scan fixture library in beforeAll');
});

test.afterAll(async () => {
  if (app) {
    await app.close();
  }
  fs.rmSync(testDataDir, { recursive: true, force: true });
});

test('library root is persisted and retrievable via IPC', async () => {
  const roots = await page.evaluate(() => window.electronApi.listLibraryRoots());
  expect(roots.length).toBeGreaterThan(0);

  const root = roots.find((r) => r.id === rootId);
  expect(root).toBeDefined();
  expect(root!.path).toBe(fixtureLibrary);
  expect(root!.is_online).toBe(1);
});

test('library roots appear in UI after navigation', async () => {
  // Navigate to library page — TanStack Query fetches on mount
  await page.locator('[data-testid="nav-library"]').click();
  await expect(page.locator('[data-testid="library-page"]')).toBeVisible();

  // The query will fetch fresh data on mount
  const rootsSection = page.locator('[data-testid="library-roots"]');
  await expect(rootsSection).toBeVisible();
});

test('scan discovers projects in library root', async () => {
  const projects = await page.evaluate(() => window.electronApi.getProjects());
  expect(projects.length).toBeGreaterThan(0);
  expect(projects[0].name).toBe('TestProject');
});

test('scanner finds model files in projects', async () => {
  const projects = await page.evaluate(() => window.electronApi.getProjects());
  const testProject = projects.find((p) => p.name === 'TestProject');
  expect(testProject).toBeDefined();

  const files = await page.evaluate(
    (id) => window.electronApi.getProjectFiles(id),
    testProject!.id,
  );

  expect(files.length).toBeGreaterThan(0);
  expect(files[0].extension).toBe('.stl');
  expect(files[0].name).toBe('model.stl');
});

test('scanner reads project.yaml metadata', async () => {
  const projects = await page.evaluate(() => window.electronApi.getProjects());
  const testProject = projects.find((p) => p.name === 'TestProject');
  expect(testProject).toBeDefined();

  const metadata = await page.evaluate(
    (projectPath) => window.electronApi.getProjectMetadata(projectPath),
    testProject!.path,
  );

  expect(metadata).not.toBeNull();
  expect(metadata?.metadata?.title).toBe('Test Project');
  expect(metadata?.metadata?.creator).toBe('Test Author');
  expect(metadata?.metadata?.tags).toContain('test');
});

test('scanner does not create project.yaml (lazy enrichment)', async () => {
  const entries = fs.readdirSync(fixtureLibrary, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name !== 'TestProject') {
      const yamlPath = path.join(fixtureLibrary, entry.name, 'project.yaml');
      expect(fs.existsSync(yamlPath)).toBe(false);
    }
  }
});

test('can remove a library root', async () => {
  // Add a temporary root to remove
  const tmpRoot = await page.evaluate(
    (fixturePath) => window.electronApi.addLibraryRootPath(fixturePath + '-remove-test'),
    fixtureLibrary,
  );
  expect(tmpRoot).not.toBeNull();

  const removed = await page.evaluate(
    (id) => window.electronApi.removeLibraryRoot(id),
    tmpRoot!.id,
  );
  expect(removed).toBe(true);

  const remaining = await page.evaluate(() => window.electronApi.listLibraryRoots());
  const found = remaining.find((r) => r.id === tmpRoot!.id);
  expect(found).toBeUndefined();
});

test('offline root is detected when path is missing', async () => {
  const fakePath = path.join(os.tmpdir(), `nonexistent-${Date.now()}`);

  const root = await page.evaluate(
    (fp) => window.electronApi.addLibraryRootPath(fp),
    fakePath,
  );
  expect(root).not.toBeNull();

  const result = await page.evaluate(
    (id) => window.electronApi.scanLibraryRoot(id),
    root!.id,
  );

  expect(result.success).toBe(false);
  expect(result.error).toContain('offline');

  const roots = await page.evaluate(() => window.electronApi.listLibraryRoots());
  const offlineRoot = roots.find((r) => r.id === root!.id);
  expect(offlineRoot?.is_online).toBe(0);
});
