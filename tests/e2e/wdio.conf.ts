import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// Real-app E2E: launches the e2e build of My Meshes in test mode (isolated data dir,
// fixture root seeded and scanned) through the embedded WebDriver provider.
const root = path.resolve(import.meta.dirname, '../..');
const exe = os.platform() === 'win32' ? 'mymeshes.exe' : 'mymeshes';
const app = process.env.MYMESHES_APP || path.join(root, 'target/release', exe);
const dataDir = process.env.MYMESHES_E2E_DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'mymeshes-e2e-'));
const fixture = path.join(root, 'fixtures/library');

// The service spawns the app with this process's environment, so the test-mode switches go here.
Object.assign(process.env, {
  MYMESHES_TEST_MODE: '1',
  MYMESHES_DATA_DIR: dataDir,
  MYMESHES_FIXTURE_ROOT: fixture,
  MYMESHES_PICK_FOLDER: fixture,
  MYMESHES_E2E_DATA_DIR: dataDir,
  MYMESHES_E2E_FIXTURE: fixture,
});

export const config: WebdriverIO.Config = {
  runner: 'local',
  specs: ['./specs/**/*.spec.ts'],
  maxInstances: 1,
  services: [
    ['@wdio/tauri-service', {
      appBinaryPath: app,
      driverProvider: 'embedded',
      appArgs: ['--test-mode'],
      captureBackendLogs: true,
      captureFrontendLogs: true,
    }],
  ],
  capabilities: [{ browserName: 'tauri', 'tauri:options': { application: app } }],
  logLevel: 'info',
  outputDir: path.join(root, 'logs/wdio'),
  waitforTimeout: 20000,
  connectionRetryTimeout: 180000,
  connectionRetryCount: 2,
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: { ui: 'bdd', timeout: 180000 },
};
