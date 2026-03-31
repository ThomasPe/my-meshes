import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Page,
  type TestInfo,
} from '@playwright/test';
import electronPath from 'electron';
const electronBinaryPath = electronPath as unknown as string;


const workspaceRoot = path.resolve(__dirname, '..', '..');
const fixtureRootSource = path.resolve(
  __dirname,
  '..',
  'fixtures',
  'library',
  'Valid Root',
);

const copyDirectory = async (source: string, target: string): Promise<void> => {
  await fs.mkdir(target, { recursive: true });
  const entries = await fs.readdir(source, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, targetPath);
    } else {
      await fs.copyFile(sourcePath, targetPath);
    }
  }
};

export interface LaunchedElectronApp {
  dataDir: string;
  electronApp: ElectronApplication;
  page: Page;
  validRootPath: string;
  workspaceDir: string;
}

const removeDirectoryWithRetry = async (targetPath: string): Promise<void> => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await fs.rm(targetPath, { recursive: true, force: true });
      return;
    } catch (error) {
      const isBusyError =
        error instanceof Error &&
        'code' in error &&
        typeof error.code === 'string' &&
        error.code === 'EBUSY';

      if (!isBusyError || attempt === 4) {
        throw error;
      }

      await new Promise((resolve) => {
        setTimeout(resolve, 250 * (attempt + 1));
      });
    }
  }
};

export const launchTestApp = async (): Promise<LaunchedElectronApp> => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'my-meshes-e2e-data-'));
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'my-meshes-e2e-work-'));
  const validRootPath = path.join(workspaceDir, 'Seeded Library');
  const offlineRootPath = path.join(workspaceDir, 'Offline Library');

  await copyDirectory(fixtureRootSource, validRootPath);

  const electronApp = await electron.launch({
    executablePath: electronBinaryPath,
    args: [workspaceRoot],
    env: {
      ...process.env,
      MY_MESHES_DISABLE_DEVTOOLS: '1',
      MY_MESHES_TEST_DATA_DIR: dataDir,
      MY_MESHES_TEST_LIBRARY_ROOTS: JSON.stringify([validRootPath, offlineRootPath]),
      MY_MESHES_TEST_MODE: '1',
    },
  });

  const page = await electronApp.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByTestId('dashboard-page')).toBeVisible();

  return {
    dataDir,
    electronApp,
    page,
    validRootPath,
    workspaceDir,
  };
};

export const closeTestApp = async (
  app: LaunchedElectronApp,
  testInfo: TestInfo,
  alreadyClosed = false,
): Promise<void> => {
  const logPath = path.join(app.dataDir, 'logs', 'main.log');

  if (testInfo.status !== testInfo.expectedStatus) {
    try {
      await fs.access(logPath);
      const copiedLogPath = testInfo.outputPath('main.log');
      await fs.copyFile(logPath, copiedLogPath);
      await testInfo.attach('main-log', {
        path: copiedLogPath,
        contentType: 'text/plain',
      });
    } catch {
      // Nothing to attach when the log file is missing.
    }
  }

  if (!alreadyClosed) {
    await app.electronApp.close();
  }

  await new Promise((resolve) => {
    setTimeout(resolve, alreadyClosed ? 1_000 : 250);
  });

  await removeDirectoryWithRetry(app.dataDir);
  await removeDirectoryWithRetry(app.workspaceDir);
};