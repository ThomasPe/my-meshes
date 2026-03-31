import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';

const requestedTestDataDir = process.env.MY_MESHES_TEST_DATA_DIR;

export const environment = {
  isTestMode: process.env.MY_MESHES_TEST_MODE === '1',
};

const defaultTestDataDir = path.join(os.tmpdir(), 'my-meshes-test-data');

const userData = environment.isTestMode
  ? path.resolve(requestedTestDataDir ?? defaultTestDataDir)
  : app.getPath('userData');

export const appPaths = {
  userData,
  logs: path.join(userData, 'logs'),
  cacheDir: path.join(userData, 'cache'),
  database: path.join(userData, 'cache', 'library-cache.sqlite'),
};

export const configureElectronPaths = (): void => {
  app.setPath('userData', appPaths.userData);
  app.setAppLogsPath(appPaths.logs);
};

export const ensureAppDirectories = (): void => {
  for (const directory of [appPaths.userData, appPaths.logs, appPaths.cacheDir]) {
    fs.mkdirSync(directory, { recursive: true });
  }
};