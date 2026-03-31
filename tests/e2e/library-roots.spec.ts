import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { closeTestApp, launchTestApp } from './helpers';

test('surfaces seeded online and offline roots and supports manual rescans', async ({ page }, testInfo) => {
  void page;
  const app = await launchTestApp();

  try {
    await app.page.getByTestId('nav-library').click();
    await expect(app.page.getByTestId('library-page')).toBeVisible();

    const validCard = app.page
      .locator('[data-testid^="library-root-card-"]')
      .filter({ hasText: 'Seeded Library' });
    const offlineCard = app.page
      .locator('[data-testid^="library-root-card-"]')
      .filter({ hasText: 'Offline Library' });

    await expect(validCard).toContainText('Online');
    await expect(validCard).toContainText('3 indexed files');
    await expect(offlineCard).toContainText('Offline');

    await app.page
      .getByTestId('library-root-input')
      .fill(path.join(app.workspaceDir, 'missing-root'));
    await app.page.getByTestId('add-library-root').click();
    await expect(app.page.getByTestId('library-form-error')).toBeVisible();

    await fs.writeFile(path.join(app.validRootPath, 'fresh-part.stl'), 'solid fresh');
    await validCard.getByRole('button', { name: 'Rescan' }).click();
    await expect(validCard).toContainText('4 indexed files');

    const parkedRootPath = path.join(app.workspaceDir, 'Seeded Library Parked');
    await fs.rename(app.validRootPath, parkedRootPath);
    await validCard.getByRole('button', { name: 'Rescan' }).click();
    await expect(validCard).toContainText('Offline');
    await expect(validCard).toContainText('4 indexed files');

    await fs.rename(parkedRootPath, app.validRootPath);
    await validCard.getByRole('button', { name: 'Rescan' }).click();
    await expect(validCard).toContainText('Online');
    await expect(validCard).toContainText('4 indexed files');

    await offlineCard.getByRole('button', { name: 'Remove' }).click();
    await expect(offlineCard).toHaveCount(0);
  } finally {
    await closeTestApp(app, testInfo);
  }
});