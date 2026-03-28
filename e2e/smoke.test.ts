import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

let app: ElectronApplication;
let page: Page;

const testDataDir = path.join(os.tmpdir(), `my-meshes-e2e-${Date.now()}`);

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
});

test.afterAll(async () => {
  if (app) {
    await app.close();
  }
  fs.rmSync(testDataDir, { recursive: true, force: true });
});

test('application window opens and is interactive', async () => {
  const title = await page.title();
  expect(title).toBe('My Meshes');

  const window = await app.browserWindow(page);
  const isVisible = await window.evaluate((w) => w.isVisible());
  expect(isVisible).toBe(true);
});

test('titlebar is rendered with controls', async () => {
  const titlebar = page.locator('[data-testid="titlebar"]');
  await expect(titlebar).toBeVisible();

  const minimizeBtn = page.locator('[data-testid="titlebar-minimize"]');
  await expect(minimizeBtn).toBeVisible();

  const maximizeBtn = page.locator('[data-testid="titlebar-maximize"]');
  await expect(maximizeBtn).toBeVisible();

  const closeBtn = page.locator('[data-testid="titlebar-close"]');
  await expect(closeBtn).toBeVisible();
});

test('home page is displayed by default', async () => {
  const homePage = page.locator('[data-testid="home-page"]');
  await expect(homePage).toBeVisible();
});

test('navigation works between pages', async () => {
  const libraryNav = page.locator('[data-testid="nav-library"]');
  await libraryNav.click();
  await expect(page.locator('[data-testid="library-page"]')).toBeVisible();

  const settingsNav = page.locator('[data-testid="nav-settings"]');
  await settingsNav.click();
  await expect(page.locator('[data-testid="settings-page"]')).toBeVisible();

  const homeNav = page.locator('[data-testid="nav-home"]');
  await homeNav.click();
  await expect(page.locator('[data-testid="home-page"]')).toBeVisible();
});

test('get started button navigates to library', async () => {
  const homeNav = page.locator('[data-testid="nav-home"]');
  await homeNav.click();
  await expect(page.locator('[data-testid="home-page"]')).toBeVisible();

  const getStartedBtn = page.locator('[data-testid="get-started-button"]');
  await getStartedBtn.click();
  await expect(page.locator('[data-testid="library-page"]')).toBeVisible();
});

test('database is operational', async () => {
  const dbHealth = await page.evaluate(() => window.electronApi.dbHealth());
  expect(dbHealth.ok).toBe(true);
});
