import { defineConfig } from '@playwright/test';

// Browser-mode UI tests: the app runs in Chromium against the in-memory mock backend.
// Fast, deterministic, no Rust needed. The real-app checks live in tests/e2e (WebdriverIO).
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts/,
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: '../../playwright-report' }]] : 'list',
  outputDir: '../../test-results',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1400, height: 900 },
  },
  webServer: {
    // Run via `npm run test:ui` from the repository root: vite preview serves ./dist from cwd.
    command: 'npx vite preview --host 127.0.0.1 --port 4173 --strictPort',
    cwd: process.cwd(),
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
