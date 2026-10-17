import os from 'node:os';
import path from 'node:path';

// E2E against the real Tauri app via WebDriver. Uses @wdio/tauri-service with the
// embedded WebDriver provider (tauri-plugin-wdio-webdriver compiled in with --features e2e),
// so no tauri-driver / msedgedriver management is needed on Windows or macOS.
const exe = os.platform() === 'win32' ? 'my-meshes-spike.exe' : 'my-meshes-spike';
const app = process.env.SPIKE_APP || path.resolve('src-tauri/target/release', exe);

export const config: WebdriverIO.Config = {
  runner: 'local',
  specs: ['./test/specs/**/*.spec.ts'],
  maxInstances: 1,
  services: [
    ['@wdio/tauri-service', {
      appBinaryPath: app,
      driverProvider: 'embedded',
      captureBackendLogs: true,
      captureFrontendLogs: true,
    }],
  ],
  capabilities: [{ browserName: 'tauri', 'tauri:options': { application: app } }],
  logLevel: 'info',
  outputDir: './logs/wdio',
  waitforTimeout: 30000,
  connectionRetryTimeout: 180000,
  connectionRetryCount: 2,
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: { ui: 'bdd', timeout: 300000 },
};
