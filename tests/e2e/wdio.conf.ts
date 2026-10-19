import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// Real-app E2E: launches the e2e build of Meshkeep in test mode (isolated data dir,
// fixture root seeded and scanned) through the embedded WebDriver provider.
const root = path.resolve(import.meta.dirname, '../..');
const exe = os.platform() === 'win32' ? 'meshkeep.exe' : 'meshkeep';
const app = process.env.MESHKEEP_APP || path.join(root, 'target/release', exe);
const dataDir = process.env.MESHKEEP_E2E_DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'meshkeep-e2e-'));
const fixture = path.join(root, 'fixtures/library');

// The service spawns the app with this process's environment, so the test-mode switches go here.
Object.assign(process.env, {
  MESHKEEP_TEST_MODE: '1',
  MESHKEEP_DATA_DIR: dataDir,
  MESHKEEP_FIXTURE_ROOT: fixture,
  MESHKEEP_PICK_FOLDER: fixture,
  MESHKEEP_PICK_FILES: [path.join(root, 'fixtures/import/Cable Clip.zip'), path.join(root, 'fixtures/import/loose_hook.stl')].join(';'),
  MESHKEEP_E2E_DATA_DIR: dataDir,
  MESHKEEP_E2E_FIXTURE: fixture,
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
