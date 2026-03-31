import path from 'node:path';
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: path.join(__dirname, 'tests/e2e'),
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  outputDir: 'test-results',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
});