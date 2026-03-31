import { expect, test } from '@playwright/test';
import { closeTestApp, launchTestApp } from './helpers';

test('launches the first Electron window and navigates the MVP shell', async ({ page }, testInfo) => {
  void page;
  const app = await launchTestApp();

  try {
    await expect(app.page.getByTestId('test-mode-badge')).toBeVisible();
    await expect(app.page.getByTestId('bootstrap-database-ready')).toContainText('ready');

    await app.page.getByTestId('nav-library').click();
    await expect(app.page.getByTestId('library-page')).toBeVisible();

    await app.page.getByTestId('nav-settings').click();
    await expect(app.page.getByTestId('settings-page')).toBeVisible();

    await app.page.getByTestId('nav-dashboard').click();
    await expect(app.page.getByTestId('dashboard-page')).toBeVisible();
  } finally {
    await closeTestApp(app, testInfo);
  }
});

test('custom titlebar controls operate through IPC', async ({ page }, testInfo) => {
  void page;
  const app = await launchTestApp();
  let alreadyClosed = false;

  try {
    await app.page.getByTestId('window-control-maximize').click();
    await expect
      .poll(() =>
        app.electronApp.evaluate(({ BrowserWindow }) => {
          return BrowserWindow.getAllWindows()[0]?.isMaximized() ?? false;
        }),
      )
      .toBe(true);

    await app.page.getByTestId('window-control-minimize').click();
    await expect
      .poll(() =>
        app.electronApp.evaluate(({ BrowserWindow }) => {
          return BrowserWindow.getAllWindows()[0]?.isMinimized() ?? false;
        }),
      )
      .toBe(true);

    await app.electronApp.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window?.restore();
    });

    const closed = app.page.waitForEvent('close');
    await app.page.getByTestId('window-control-close').click();
    await closed;
    alreadyClosed = true;
  } finally {
    await closeTestApp(app, testInfo, alreadyClosed);
  }
});