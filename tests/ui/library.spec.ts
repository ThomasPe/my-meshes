import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('mm.lang', 'en'); localStorage.setItem('mm.theme', 'light'); });
  await page.goto('/#/library');
  await expect(page.getByTestId('library')).toBeVisible();
});

test('renders the sample library with grid, sidebar and inspector summary', async ({ page }) => {
  await expect(page.getByTestId('project-card').first()).toBeVisible();
  const count = Number(await page.getByTestId('result-count').textContent());
  expect(count).toBeGreaterThan(60);
  await expect(page.getByTestId('sidebar').getByTestId('filter-root')).toHaveCount(2);
  await expect(page.getByTestId('inspector')).toContainText('projects');
  await expect(page.getByTestId('statusbar')).toContainText('Watching');
});

test('search narrows the grid, chips clear it', async ({ page }) => {
  await page.getByTestId('search').fill('robo');
  await expect(page.getByTestId('result-count')).toHaveText('1');
  await expect(page.getByTestId('project-card')).toHaveCount(1);
  await expect(page.getByTestId('project-card')).toContainText('Robotic Arm v4');
  await page.getByRole('button', { name: 'clear search' }).click();
  expect(Number(await page.getByTestId('result-count').textContent())).toBeGreaterThan(60);
});

test('tag filter via card, folder filter via tree, list view', async ({ page }) => {
  await page.getByTestId('project-card').filter({ hasText: 'Gridfinity Baseplates' }).getByRole('button', { name: 'gridfinity' }).click();
  await expect(page.getByTestId('tag-chip')).toHaveText(/gridfinity/);
  await expect(page.getByTestId('result-count')).toHaveText('3');
  await page.getByTestId('tag-chip').getByRole('button').click();
  await page.getByTestId('filter-folder').filter({ hasText: 'Desk' }).first().click();
  await expect(page.getByTestId('result-count')).toHaveText('2');
  await page.getByTestId('view-list').click();
  await expect(page.getByTestId('project-row')).toHaveCount(2);
  await page.getByTestId('filter-all').click();
  await page.getByTestId('view-grid').click();
});

test('selecting a card shows details; adding a tag writes optimistically and toasts', async ({ page }) => {
  const card = page.getByTestId('project-card').filter({ hasText: 'Decorative Vase' });
  await card.click();
  await expect(page.getByTestId('inspector-title')).toHaveText('Decorative Vase');
  await expect(page.getByTestId('inspector')).toContainText('no project.yaml yet');
  await expect(page.getByTestId('status-selected')).toHaveText('1 selected');
  await page.getByTestId('tag-add').click();
  await page.getByTestId('tag-input').fill('printed');
  await page.getByTestId('tag-input').press('Enter');
  await expect(page.getByTestId('tag-editor').getByTestId('tag').filter({ hasText: 'printed' })).toBeVisible();
  await expect(page.getByText('project.yaml created')).toBeVisible();
  await expect(page.getByTestId('inspector')).toContainText('project.yaml in sync');
});

test('double-click opens the project page with metadata form and files', async ({ page }) => {
  await page.getByTestId('project-card').filter({ hasText: 'Robotic Arm v4' }).dblclick();
  await expect(page.getByTestId('project-page')).toBeVisible();
  await expect(page.getByTestId('project-title')).toHaveText('Robotic Arm v4');
  await expect(page.getByTestId('field-creator')).toHaveValue('ExampleCreator');
  await page.getByTestId('field-title').fill('Robotic Arm v5');
  await page.getByTestId('save-metadata').click();
  await expect(page.getByText('project.yaml saved')).toBeVisible();
  await expect(page.getByTestId('project-title')).toHaveText('Robotic Arm v5');
  await page.getByRole('tab', { name: /Files/ }).click();
  await expect(page.getByTestId('file-row')).toHaveCount(8);
  await page.getByTestId('back').click();
  await expect(page.getByTestId('library')).toBeVisible();
});

test('settings lists roots and switches language', async ({ page }) => {
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('root-row')).toHaveCount(2);
  await page.getByTestId('language').click();
  await page.getByRole('option', { name: 'Deutsch' }).click();
  await expect(page.getByRole('heading', { name: 'Einstellungen' })).toBeVisible();
  await page.getByTestId('nav-library').click();
  await expect(page.getByTestId('filter-all')).toContainText('Alle Projekte');
});

test('no console errors on the main screens', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.getByTestId('project-card').first().dblclick();
  await expect(page.getByTestId('project-page')).toBeVisible();
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('settings')).toBeVisible();
  expect(errors.filter((e) => !/no file contents in browser mode/.test(e))).toEqual([]);
});
