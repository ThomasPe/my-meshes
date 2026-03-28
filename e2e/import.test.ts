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

const testDataDir = path.join(os.tmpdir(), `my-meshes-e2e-import-${Date.now()}`);
const fixtureLibrary = path.join(__dirname, 'fixtures', 'sample-library');
const fixtureZip = path.join(__dirname, 'fixtures', 'test-import.zip');
const fixtureLooseZip = path.join(__dirname, 'fixtures', 'test-loose.zip');

// A separate writable library root for import targets
const importTargetRoot = path.join(testDataDir, 'import-library');

let rootId: number;

test.beforeAll(async () => {
  fs.mkdirSync(testDataDir, { recursive: true });
  fs.mkdirSync(importTargetRoot, { recursive: true });

  // Seed the import target with a dummy model so it qualifies as a scannable root
  const seedProject = path.join(importTargetRoot, 'SeedProject');
  fs.mkdirSync(seedProject, { recursive: true });
  fs.copyFileSync(
    path.join(fixtureLibrary, 'TestProject', 'model.stl'),
    path.join(seedProject, 'model.stl'),
  );

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

  // Add the writable import target as a library root
  const root = await page.evaluate(
    (rootPath) => window.electronApi.addLibraryRootPath(rootPath),
    importTargetRoot,
  );
  if (!root) throw new Error('Failed to add import target library root');
  rootId = root.id;

  await page.evaluate((id) => window.electronApi.scanLibraryRoot(id), rootId);
});

test.afterAll(async () => {
  if (app) {
    await app.close();
  }
  fs.rmSync(testDataDir, { recursive: true, force: true });
});

test('inspect archive returns correct metadata', async () => {
  const results = await page.evaluate(
    (zipPath) => window.electronApi.importInspectArchives([zipPath]),
    fixtureZip,
  );

  expect(results).toHaveLength(1);
  expect(results[0].archiveName).toBe('test-import.zip');
  expect(results[0].suggestedProjectName).toBe('ImportedModel');
  expect(results[0].modelFileCount).toBeGreaterThan(0);
  expect(results[0].entries.length).toBeGreaterThan(0);

  const stlEntry = results[0].entries.find((e) => e.name === 'imported.stl');
  expect(stlEntry).toBeDefined();
  expect(stlEntry!.isModelFile).toBe(true);
});

test('inspect archive with loose files suggests archive name as project', async () => {
  const results = await page.evaluate(
    (zipPath) => window.electronApi.importInspectArchives([zipPath]),
    fixtureLooseZip,
  );

  expect(results).toHaveLength(1);
  expect(results[0].suggestedProjectName).toBe('test-loose');
  expect(results[0].modelFileCount).toBeGreaterThan(0);
});

test('extract archive creates project folder with files', async () => {
  const items = [{ archivePath: fixtureZip, projectName: 'ImportedModel' }];

  const results = await page.evaluate(
    ({ items, rootPath }) => window.electronApi.importExtractArchives(items, rootPath),
    { items, rootPath: importTargetRoot },
  );

  expect(results).toHaveLength(1);
  expect(results[0].success).toBe(true);

  const projectDir = path.join(importTargetRoot, 'ImportedModel');
  expect(fs.existsSync(projectDir)).toBe(true);

  // The top-level 'ImportedModel/' prefix should be stripped
  expect(fs.existsSync(path.join(projectDir, 'imported.stl'))).toBe(true);
  expect(fs.existsSync(path.join(projectDir, 'readme.txt'))).toBe(true);
});

test('extract archive with custom project name', async () => {
  const items = [{ archivePath: fixtureLooseZip, projectName: 'CustomName' }];

  const results = await page.evaluate(
    ({ items, rootPath }) => window.electronApi.importExtractArchives(items, rootPath),
    { items, rootPath: importTargetRoot },
  );

  expect(results).toHaveLength(1);
  expect(results[0].success).toBe(true);

  const projectDir = path.join(importTargetRoot, 'CustomName');
  expect(fs.existsSync(projectDir)).toBe(true);
  expect(fs.existsSync(path.join(projectDir, 'loose-model.stl'))).toBe(true);
});

test('extract archive rejects duplicate project directory', async () => {
  // 'ImportedModel' already exists from the previous test
  const items = [{ archivePath: fixtureZip, projectName: 'ImportedModel' }];

  const results = await page.evaluate(
    ({ items, rootPath }) => window.electronApi.importExtractArchives(items, rootPath),
    { items, rootPath: importTargetRoot },
  );

  expect(results[0].success).toBe(false);
  expect(results[0].error).toContain('already exists');
});

test('import loose files into Unsorted folder', async () => {
  const stlPath = path.join(fixtureLibrary, 'TestProject', 'model.stl');

  const result = await page.evaluate(
    ({ filePaths, rootPath }) => window.electronApi.importLooseFiles(filePaths, rootPath),
    { filePaths: [stlPath], rootPath: importTargetRoot },
  );

  expect(result.success).toBe(true);
  expect(fs.existsSync(path.join(importTargetRoot, 'Unsorted', 'model.stl'))).toBe(true);
});

test('scan picks up imported projects', async () => {
  const scanResult = await page.evaluate(
    (id) => window.electronApi.scanLibraryRoot(id),
    rootId,
  );
  expect(scanResult.success).toBe(true);

  const projects = await page.evaluate(
    (id) => window.electronApi.getProjects(id),
    rootId,
  );

  const names = projects.map((p) => p.name);
  expect(names).toContain('ImportedModel');
  expect(names).toContain('CustomName');
  expect(names).toContain('Unsorted');
});

test('zip files inside projects are listed as attachments', async () => {
  // Copy a zip into an existing project folder
  const projectDir = path.join(importTargetRoot, 'ImportedModel');
  fs.copyFileSync(fixtureZip, path.join(projectDir, 'backup.zip'));

  // Rescan to pick up the zip
  await page.evaluate((id) => window.electronApi.scanLibraryRoot(id), rootId);

  const projects = await page.evaluate(
    (id) => window.electronApi.getProjects(id),
    rootId,
  );
  const imported = projects.find((p) => p.name === 'ImportedModel');
  expect(imported).toBeDefined();

  const files = await page.evaluate(
    (id) => window.electronApi.getProjectFiles(id),
    imported!.id,
  );

  const zipFile = files.find((f) => f.extension === '.zip');
  expect(zipFile).toBeDefined();
  expect(zipFile!.name).toBe('backup.zip');
});

test('import button is visible on library page', async () => {
  await page.locator('[data-testid="nav-library"]').click();
  await expect(page.locator('[data-testid="library-page"]')).toBeVisible();
  await expect(page.locator('[data-testid="import-button"]')).toBeVisible();
});

test('passive sync: watcher detects zip added via filesystem', async () => {
  // Start the watcher
  await page.evaluate((id) => window.electronApi.watcherStart(id), rootId);

  // Wait for watcher to initialize
  await page.waitForTimeout(500);

  // Copy a zip into the ImportedModel project folder
  const projectDir = path.join(importTargetRoot, 'ImportedModel');
  const targetZip = path.join(projectDir, 'external-drop.zip');
  fs.copyFileSync(fixtureLooseZip, targetZip);

  // Wait for watcher to detect the change
  await page.waitForTimeout(2000);

  // Verify the file appears in the project's file list
  const projects = await page.evaluate(
    (id) => window.electronApi.getProjects(id),
    rootId,
  );
  const imported = projects.find((p) => p.name === 'ImportedModel');
  expect(imported).toBeDefined();

  const files = await page.evaluate(
    (id) => window.electronApi.getProjectFiles(id),
    imported!.id,
  );

  const externalZip = files.find((f) => f.name === 'external-drop.zip');
  expect(externalZip).toBeDefined();
  expect(externalZip!.extension).toBe('.zip');

  // Stop watcher
  await page.evaluate((id) => window.electronApi.watcherStop(id), rootId);
});
