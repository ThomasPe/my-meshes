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
  // auto-save: a second after the last keystroke the status flips to saved
  await expect(page.getByTestId('autosave-status')).toHaveAttribute('data-state', 'pending');
  await expect(page.getByTestId('autosave-status')).toHaveAttribute('data-state', 'saved', { timeout: 5000 });
  await expect(page.getByTestId('project-title')).toHaveText('Robotic Arm v5');
  await page.getByRole('tab', { name: /Files/ }).click();
  await expect(page.getByTestId('file-row')).toHaveCount(8);
  await page.getByTestId('back').click();
  await expect(page.getByTestId('library')).toBeVisible();
});

test('two edits in a row save without a conflict; reload after a real conflict drops the edit', async ({ page }) => {
  await page.getByTestId('project-card').filter({ hasText: 'Robotic Arm v4' }).dblclick();
  const status = page.getByTestId('autosave-status');
  // set a licence, then back to "not set": the second save hands back the stamp of the first
  await page.getByTestId('field-license').click();
  await page.getByRole('option', { name: 'CC-BY-4.0' }).click();
  await expect(status).toHaveAttribute('data-state', 'saved', { timeout: 5000 });
  await page.getByTestId('field-license').click();
  await page.getByRole('option', { name: 'not set' }).click();
  await expect(status).toHaveAttribute('data-state', 'pending');
  await expect(status).toHaveAttribute('data-state', 'saved', { timeout: 5000 });
  await expect(page.getByTestId('conflict-dialog')).toHaveCount(0);
  // someone else writes project.yaml meanwhile: the next save conflicts, reload keeps the disk version
  await page.evaluate(() => { const w = window as unknown as { __mockTouched?: Set<string> }; (w.__mockTouched ??= new Set()).add('r1:Projects/Robotics/Arm v4'); });
  await page.getByTestId('field-creator').fill('Someone Else');
  await expect(page.getByTestId('conflict-dialog')).toBeVisible({ timeout: 5000 });
  await page.getByRole('button', { name: 'Reload' }).click();
  await expect(page.getByTestId('conflict-dialog')).toHaveCount(0);
  await expect(page.getByTestId('field-creator')).toHaveValue('ExampleCreator');
  await page.waitForTimeout(1500);
  await expect(page.getByTestId('conflict-dialog')).toHaveCount(0);
  await expect(status).not.toHaveAttribute('data-state', 'pending');
});

test('feedback: the dialog opens a prefilled GitHub issue with version and system info', async ({ page }) => {
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('send-feedback').click();
  const dialog = page.getByTestId('feedback-dialog');
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('feedback-submit')).toBeDisabled();
  await expect(page.getByTestId('feedback-env-preview')).toContainText('Meshkeep 0.1.0-mock');
  await page.getByTestId('feedback-title').fill('Viewer stays on reading');
  await page.getByTestId('feedback-details').fill('Opened a 3MF, nothing happens.');
  await page.getByTestId('feedback-submit').click();
  await expect(dialog).toHaveCount(0);
  const opened = await page.evaluate(() => (window as unknown as { __mockOpened?: string[] }).__mockOpened ?? []);
  expect(opened).toHaveLength(1);
  const url = new URL(opened[0]!);
  expect(url.pathname).toBe('/ThomasPe/my-meshes/issues/new');
  expect(url.searchParams.get('template')).toBe('bug_report.yml');
  expect(url.searchParams.get('title')).toBe('[Bug] Viewer stays on reading');
  expect(url.searchParams.get('description')).toBe('Opened a 3MF, nothing happens.');
  expect(url.searchParams.get('environment')).toContain('Meshkeep 0.1.0-mock (stable channel)');
  expect(url.searchParams.get('environment')).toContain('Library: 77 projects');
  // the idea form carries no log field and no bug label
  await page.getByTestId('send-feedback').click();
  await page.getByTestId('feedback-kind').getByRole('radio', { name: 'Idea' }).click();
  await expect(page.getByTestId('feedback-log')).toHaveCount(0);
  await page.getByTestId('feedback-title').fill('Project tabs');
  await page.getByTestId('feedback-submit').click();
  const second = new URL((await page.evaluate(() => (window as unknown as { __mockOpened?: string[] }).__mockOpened ?? []))[1]!);
  expect(second.searchParams.get('template')).toBe('feature_request.yml');
  expect(second.searchParams.get('labels')).toBe('enhancement,from-app');
});

test('the sidebar stays on the project page; picking a folder there returns to the library', async ({ page }) => {
  await page.getByTestId('project-card').filter({ hasText: 'Robotic Arm v4' }).dblclick();
  await expect(page.getByTestId('project-page')).toBeVisible();
  await expect(page.getByTestId('panel-sidebar')).toBeVisible();
  await expect(page.getByTestId('library')).toHaveCount(0);
  await page.getByTestId('filter-folder').filter({ hasText: 'Desk' }).first().click();
  await expect(page.getByTestId('library')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Desk');
  await expect(page.getByTestId('project-card')).toHaveCount(2);
  // settings and welcome are full-width screens
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('panel-sidebar')).toHaveCount(0);
});

test('settings lists roots and switches language', async ({ page }) => {
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('root-row')).toHaveCount(2);
  // updates card (mock is an updater build): manual check, nothing installs on its own
  await page.getByTestId('check-update').click();
  await expect(page.getByTestId('update-status')).toContainText('Version 0.2.0 is available');
  await expect(page.getByTestId('install-update')).toBeVisible();
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
  expect(errors.filter((e) => !/no file contents in browser mode|WebGL|GPU stall|GL_INVALID/.test(e))).toEqual([]);
});

// ---- D2: thumbnails, favorites, recent, rename, delete -------------------------------

test('thumbnails are rendered in the background and shown on cards', async ({ page }) => {
  // the mock serves synthetic STL/OBJ/3MF bytes; the pipeline parses + renders them for real
  await expect(page.getByTestId('project-card').filter({ has: page.getByTestId('thumb-img') }).first()).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => page.getByTestId('thumb-img').count(), { timeout: 60_000 }).toBeGreaterThan(3);
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('thumb-summary')).toContainText(/\d+ rendered/);
});

test('a project preview can be re-rendered from the card menu', async ({ page }) => {
  const card = page.getByTestId('project-card').filter({ hasText: 'Robotic Arm v4' });
  await expect(card.getByTestId('thumb-img')).toBeVisible({ timeout: 60_000 });
  await card.click({ button: 'right' });
  await page.getByTestId('menu-rethumb').click();
  await expect(page.getByText('Rendering a new preview for “Robotic Arm v4”')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __mockThumbResets?: string[] }).__mockThumbResets ?? [])).toEqual(['r1:Projects/Robotics/Arm v4']);
  // the queue picks it up again and the card gets a fresh image
  await expect(card.getByTestId('thumb-img')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('thumb-summary')).toContainText(/\d+ rendered/);
});

test('favorites: toggle on a card, filter view and count in the sidebar', async ({ page }) => {
  await expect(page.getByTestId('favorites-count')).toHaveText('2');
  const card = page.getByTestId('project-card').filter({ hasText: 'Decorative Vase' });
  await card.hover();
  await card.getByTestId('card-favorite').click();
  await expect(card.getByTestId('card-favorite')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('favorites-count')).toHaveText('3');
  await page.getByTestId('filter-favorites').click();
  await expect(page.getByTestId('result-count')).toHaveText('3');
  await expect(page.getByTestId('project-card')).toHaveCount(3);
  // remove it again from the inspector
  await page.getByTestId('project-card').filter({ hasText: 'Decorative Vase' }).click();
  await page.getByTestId('inspector-favorite').click();
  await expect(page.getByTestId('result-count')).toHaveText('2');
  await expect(page.getByTestId('favorites-count')).toHaveText('2');
});

test('recent additions view sorts by date added and locks the sort control', async ({ page }) => {
  await page.getByTestId('filter-recent').click();
  await expect(page.getByRole('heading', { name: 'Recent additions' })).toBeVisible();
  await expect(page.getByTestId('sort')).toBeDisabled();
  const first = await page.getByTestId('project-card').first().locator('h4').textContent();
  expect(first).toBe('Cable Clips'); // daysAgo 0 -> newest "added"
});

test('rename via context menu: validation, collision, success', async ({ page }) => {
  const card = page.getByTestId('project-card').filter({ hasText: 'Phone Stand' });
  await card.click({ button: 'right' });
  await page.getByTestId('menu-rename').click();
  await expect(page.getByTestId('rename-dialog')).toBeVisible();
  await expect(page.getByTestId('rename-input')).toHaveValue('Phone Stand');
  await page.getByTestId('rename-input').fill('Bad/Name');
  await page.getByTestId('rename-confirm').click();
  await expect(page.getByTestId('rename-error')).toContainText('not allowed');
  await page.getByTestId('rename-input').fill('Cable Clips');
  await page.getByTestId('rename-confirm').click();
  await expect(page.getByTestId('rename-error')).toContainText('already exists');
  await page.getByTestId('rename-input').fill('Phone Stand v2');
  await page.getByTestId('rename-confirm').click();
  await expect(page.getByTestId('rename-dialog')).toBeHidden();
  await expect(page.getByText('Renamed to Phone Stand v2')).toBeVisible();
  const renamed = page.getByTestId('project-card').filter({ hasText: 'Phone Stand' });
  await expect(renamed).toHaveAttribute('data-id', 'r1:Projects/Desk/Phone Stand v2');
  await expect(page.getByTestId('inspector-title')).toHaveText('Phone Stand');
});

test('delete moves a project to the trash after confirmation; Delete key works too', async ({ page }) => {
  const before = Number(await page.getByTestId('result-count').textContent());
  const card = page.getByTestId('project-card').filter({ hasText: 'Dice Tower' });
  await card.click({ button: 'right' });
  await page.getByTestId('menu-delete').click();
  await expect(page.getByTestId('delete-dialog')).toContainText('Dice Tower');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('result-count')).toHaveText(String(before));
  await card.click();
  await page.keyboard.press('Delete');
  await page.getByTestId('delete-confirm').click();
  await expect(page.getByText('moved to trash')).toBeVisible();
  await expect(page.getByTestId('result-count')).toHaveText(String(before - 1));
  await expect(page.getByTestId('project-card').filter({ hasText: 'Dice Tower' })).toHaveCount(0);
});

test('project page: OBJ renders in the viewer, slicer badge, delete a single file', async ({ page }) => {
  await page.getByTestId('project-card').filter({ hasText: 'Gridfinity Baseplates' }).dblclick();
  await expect(page.getByTestId('project-page')).toBeVisible();
  await expect(page.getByTestId('viewer-triangles')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('slicer-badge')).toBeVisible();
  await page.getByRole('tab', { name: /Files/ }).click();
  const rows = page.getByTestId('file-row');
  const n = await rows.count();
  await rows.filter({ hasText: 'README.md' }).getByTestId('file-delete').click();
  await page.getByTestId('delete-file-confirm').click();
  await expect(page.getByText('README.md moved to trash')).toBeVisible();
  await expect(rows).toHaveCount(n - 1);
  // settings: poll interval appears for polled roots, bundle folders are editable
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('poll-interval')).toHaveCount(1);
  await expect(page.getByTestId('container-dirs')).toContainText('files');
  await page.getByTestId('container-dirs').getByRole('button', { name: 'remove files' }).click();
  await expect(page.getByTestId('container-dirs')).not.toContainText('files');
});

// ---- D3: import staging, inbox, collections, smart collections ---------------------------

test('import: picker opens the staging dialog, proposals are editable, confirm creates projects', async ({ page }) => {
  await page.getByTestId('import-open').click();
  await expect(page.getByTestId('import-dialog')).toBeVisible();
  await expect(page.getByTestId('import-item')).toHaveCount(3);
  const rows = page.getByTestId('import-item');
  await expect(rows.nth(0)).toContainText('Cable Clip.zip');
  await expect(rows.nth(0).getByTestId('import-name')).toHaveValue('Cable Clip');
  await expect(rows.nth(1)).toContainText('copied to _Inbox');
  await expect(rows.nth(2)).toContainText('not extracted yet');
  // collision with an existing project is reported inline, then fixed
  await rows.nth(0).getByTestId('import-name').fill('Projects/Desk/Cable Clips');
  await page.getByTestId('import-confirm').click();
  await expect(page.getByTestId('import-error')).toBeVisible();
  await rows.nth(0).getByTestId('import-name').fill('Cable Clip');
  await page.getByTestId('import-confirm').click();
  await expect(page.getByTestId('import-dialog')).toBeHidden();
  await expect(page.getByText('Imported 1 projects, 2 files to the inbox')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recent additions' })).toBeVisible();
  await expect(page.getByTestId('project-card').first()).toContainText('Cable Clip');
});

test('inbox: one project per file, with inline renaming and a shared-prefix strip', async ({ page }) => {
  await page.getByTestId('filter-inbox').first().click();
  await expect(page.getByTestId('inbox-row')).toHaveCount(2);
  // a single selection offers only the one-project path
  await page.getByTestId('inbox-row').first().click();
  await expect(page.getByTestId('inbox-promote-more')).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'select all' }).check();
  await page.getByTestId('inbox-promote-more').click();
  await page.getByTestId('inbox-promote-each').click();
  const dialog = page.getByTestId('promote-each-dialog');
  await expect(dialog).toBeVisible();
  const names = page.getByTestId('promote-each-name');
  await expect(names).toHaveCount(2);
  await expect(names.nth(0)).toHaveValue('quick download');
  await expect(names.nth(1)).toHaveValue('reference');
  await expect(page.getByTestId('promote-strip-prefix')).toHaveCount(0); // nothing shared
  // a duplicate name blocks the button, fixing it enables it again
  await names.nth(1).fill('Quick Download');
  await expect(page.getByTestId('promote-each-error')).toHaveCount(2);
  await expect(page.getByTestId('promote-each-confirm')).toBeDisabled();
  await names.nth(1).fill('Reference Photo');
  await expect(page.getByTestId('promote-each-confirm')).toBeEnabled();
  // a name the engine rejects fails alone and stays in the dialog, the other one is created
  await names.nth(0).fill('Bad/Name');
  await page.getByTestId('promote-each-confirm').click();
  await expect(page.getByText('1 project created')).toBeVisible();
  await expect(page.getByTestId('promote-each-row')).toHaveCount(1);
  await expect(page.getByTestId('promote-each-error')).toContainText('invalid name');
  await names.nth(0).fill('Quick Download');
  await page.getByTestId('promote-each-confirm').click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('inbox-empty')).toBeVisible();
  await page.getByTestId('filter-all').click();
  await expect(page.getByTestId('project-card').filter({ hasText: 'Quick Download' })).toHaveCount(1);
  await expect(page.getByTestId('project-card').filter({ hasText: 'Reference Photo' })).toHaveCount(1);
});

test('inbox: lists loose files per root, promotes a selection to a project', async ({ page }) => {
  await expect(page.getByTestId('inbox-count').first()).toHaveText('2');
  await page.getByTestId('filter-inbox').first().click();
  await expect(page.getByTestId('inbox-row')).toHaveCount(2);
  await expect(page.getByTestId('inbox-promote')).toBeDisabled();
  await page.getByTestId('inbox-row').filter({ hasText: 'quick_download.stl' }).click();
  await page.getByTestId('inbox-promote').click();
  await expect(page.getByTestId('promote-name')).toHaveValue('quick download');
  await page.getByTestId('promote-name').fill('Quick Download');
  await page.getByTestId('promote-confirm').click();
  await expect(page.getByText('Project “Quick Download” created')).toBeVisible();
  await expect(page.getByTestId('project-page')).toBeVisible();
  await expect(page.getByTestId('project-title')).toHaveText('Quick Download');
  await page.getByTestId('back').click();
  await expect(page.getByTestId('inbox-count').first()).toHaveText('1');
});

test('collections: create via context menu, view in manual order, remove, delete', async ({ page }) => {
  await expect(page.getByTestId('filter-collection')).toHaveCount(1);
  await expect(page.getByTestId('filter-collection')).toContainText('Desk setup');
  // add a project to the existing collection through the context menu
  await page.getByTestId('project-card').filter({ hasText: 'Low-Poly Benchy' }).click({ button: 'right' });
  await page.getByTestId('menu-add-to-collection').hover();
  await page.getByTestId('menu-collection').filter({ hasText: 'Desk setup' }).click();
  await expect(page.getByText('Added to “Desk setup”')).toBeVisible();
  await page.getByTestId('filter-collection').click();
  await expect(page.getByTestId('result-count')).toHaveText('3');
  const titles = await page.getByTestId('project-card').locator('h4').allTextContents();
  expect(titles).toEqual(['Phone Stand', 'Cable Clips', 'Low-Poly Benchy']);
  await expect(page.getByTestId('reorder-handle')).toHaveCount(3);
  // remove one from the collection
  await page.getByTestId('project-card').filter({ hasText: 'Cable Clips' }).click({ button: 'right' });
  await page.getByTestId('menu-remove-from-collection').click();
  await expect(page.getByTestId('result-count')).toHaveText('2');
  // new collection from the sidebar, then delete it
  await page.getByTestId('collection-new').click();
  await page.getByTestId('collection-name').fill('Bench');
  await page.getByTestId('collection-confirm').click();
  await expect(page.getByText('Collection “Bench” created')).toBeVisible();
  await expect(page.getByTestId('filter-collection')).toHaveCount(2);
  await expect(page.getByTestId('empty')).toContainText('This collection is empty');
  await page.getByTestId('filter-collection').filter({ hasText: 'Bench' }).click({ button: 'right' });
  await page.getByTestId('collection-delete').click();
  await page.getByTestId('collection-confirm').click();
  await expect(page.getByTestId('filter-collection')).toHaveCount(1);
});

test('smart collections: the sample one evaluates live, a search can be saved as one', async ({ page }) => {
  await page.getByTestId('filter-smart').filter({ hasText: 'Gridfinity PLA' }).click();
  await expect(page.getByTestId('result-count')).toHaveText('3');
  await page.getByTestId('filter-all').click();
  await expect(page.getByTestId('save-smart')).toHaveCount(0);
  await page.getByTestId('search').fill('robo');
  await page.getByTestId('save-smart').click();
  await page.getByTestId('collection-name').fill('Robots');
  await page.getByTestId('collection-confirm').click();
  await expect(page.getByText('Smart collection “Robots” saved')).toBeVisible();
  await expect(page.getByTestId('filter-smart')).toHaveCount(2);
  await expect(page.getByRole('heading', { name: 'Robots' })).toBeVisible();
  await page.getByRole('button', { name: 'clear search' }).click();
  await expect(page.getByTestId('result-count')).toHaveText('1');
});

// ---- D4: creator filter, multi-select actions, image viewer, root status ----------------

test('creator filter: click a creator on a card, chip appears, clear it', async ({ page }) => {
  await page.getByTestId('project-card').filter({ hasText: 'Gridfinity Baseplates' }).getByTestId('card-creator').click();
  await expect(page.getByTestId('creator-chip')).toContainText('Zach Freedman');
  await expect(page.getByTestId('result-count')).toHaveText('2');
  await page.getByRole('button', { name: 'clear creator' }).click();
  expect(Number(await page.getByTestId('result-count').textContent())).toBeGreaterThan(60);
  // from the inspector summary as well
  await page.getByTestId('inspector-creator').filter({ hasText: 'Lena Hofer' }).click();
  await expect(page.getByTestId('result-count')).toHaveText('2');
  await page.getByRole('button', { name: 'clear creator' }).click();
});

test('multi-selection: inspector actions add to a collection, favorite and delete', async ({ page }) => {
  const a = page.getByTestId('project-card').filter({ hasText: 'Planetary Gearbox' });
  const b = page.getByTestId('project-card').filter({ hasText: 'Self-watering Planter' });
  await a.click();
  await b.click({ modifiers: ['Control'] });
  await expect(page.getByTestId('status-selected')).toHaveText('2 selected');
  await expect(page.getByTestId('multi-actions')).toBeVisible();
  await page.getByTestId('multi-add-collection').click();
  await page.getByTestId('multi-collection').filter({ hasText: 'Desk setup' }).click();
  await expect(page.getByText('2 projects added to “Desk setup”')).toBeVisible();
  await page.getByTestId('multi-favorite').click();
  await expect(page.getByTestId('favorites-count')).toHaveText('4');
  await expect(page.getByTestId('multi-unfavorite')).toBeVisible();
  const before = Number(await page.getByTestId('result-count').textContent());
  await page.getByTestId('multi-delete').click();
  await expect(page.getByTestId('delete-many-dialog')).toContainText('Move 2 projects to the trash?');
  await page.getByTestId('delete-many-confirm').click();
  await expect(page.getByText('2 projects moved to trash')).toBeVisible();
  await expect(page.getByTestId('result-count')).toHaveText(String(before - 2));
});

test('image viewer: images tab shows tiles, lightbox navigates', async ({ page }) => {
  await page.getByTestId('project-card').filter({ hasText: 'Gridfinity Baseplates' }).dblclick();
  await page.getByTestId('tab-images').click();
  await expect(page.getByTestId('image-tile')).toHaveCount(1);
  await expect(page.getByTestId('image-tile').locator('img')).toBeVisible();
  await page.getByTestId('image-tile').click();
  await expect(page.getByTestId('lightbox-img')).toBeVisible();
  await expect(page.getByTestId('lightbox-name')).toHaveText('photo_desk.png');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('lightbox')).toBeHidden();
  await page.getByTestId('back').click();
  await page.getByTestId('project-card').filter({ hasText: 'Robotic Arm v4' }).dblclick();
  await page.getByTestId('tab-images').click();
  await page.getByTestId('image-tile').first().click();
  await expect(page.getByText('1 of 1')).toBeVisible();
});

test('settings shows the last scan summary and the sync problem per root', async ({ page }) => {
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('root-scan-summary').first()).toContainText('72 projects · 131 files');
  await expect(page.getByTestId('root-scan-summary').first()).toContainText('1 note');
  await expect(page.getByTestId('root-error')).toContainText('not reachable');
});

test('attribute filters: license, material and file type chips from the inspector', async ({ page }) => {
  await page.getByTestId('facet-license').filter({ hasText: 'CC-BY-NC-SA-4.0' }).click();
  await expect(page.getByTestId('license-chip')).toContainText('CC-BY-NC-SA-4.0');
  await expect(page.getByTestId('result-count')).toHaveText('4');
  await page.getByTestId('facet-material').filter({ hasText: 'PETG' }).click();
  await expect(page.getByTestId('material-chip')).toContainText('PETG');
  await expect(page.getByTestId('result-count')).toHaveText('1');
  await expect(page.getByTestId('project-card')).toContainText(['Gridfinity Rugged Box']);
  // a second click on the active chip clears that facet
  await page.getByTestId('facet-material').filter({ hasText: 'PETG' }).click();
  await expect(page.getByTestId('material-chip')).toHaveCount(0);
  await expect(page.getByTestId('result-count')).toHaveText('4');
  await page.getByRole('button', { name: 'clear license' }).click();
  await page.getByTestId('facet-filetype').filter({ hasText: 'OBJ' }).click();
  await expect(page.getByTestId('filetype-chip')).toContainText('OBJ');
  await expect(page.getByTestId('result-count')).toHaveText('1');
  await expect(page.getByTestId('project-card')).toContainText(['Phone Stand']);
  // the filtered state can be saved as a smart collection
  await expect(page.getByTestId('save-smart')).toBeVisible();
  await page.getByRole('button', { name: 'clear file type' }).click();
  expect(Number(await page.getByTestId('result-count').textContent())).toBeGreaterThan(60);
});

test('batch editing: tags and creator for a multi-selection', async ({ page }) => {
  const a = page.getByTestId('project-card').filter({ hasText: 'Planetary Gearbox' });
  const b = page.getByTestId('project-card').filter({ hasText: 'Self-watering Planter' });
  await a.click();
  await b.click({ modifiers: ['Control'] });
  await expect(page.getByTestId('batch-editor')).toBeVisible();
  await expect(page.getByTestId('batch-tag')).toHaveCount(4); // mechanical, functional, decor, garden
  await page.getByTestId('batch-add-tag').fill('Workshop');
  await page.getByTestId('batch-add-tag').press('Enter');
  await expect(page.getByText('2 projects updated')).toBeVisible();
  await expect(a.getByRole('button', { name: 'workshop' })).toBeVisible();
  await expect(b.getByRole('button', { name: 'workshop' })).toBeVisible();
  await page.getByRole('button', { name: 'remove workshop from all' }).click();
  await expect(a.getByRole('button', { name: 'workshop' })).toHaveCount(0);
  await page.getByTestId('batch-creator').fill('Studio Nord');
  await page.getByTestId('batch-creator-apply').click();
  await expect(a.getByTestId('card-creator')).toContainText('Studio Nord');
  await expect(b.getByTestId('card-creator')).toContainText('Studio Nord');
});

test('settings: preview location and notification toggle; import notifies when unfocused', async ({ page }) => {
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('thumb-location')).toBeVisible();
  await page.getByTestId('thumb-location-project').click();
  await expect(page.getByText('Preview location saved')).toBeVisible();
  await expect(page.getByTestId('thumb-location-project')).toHaveAttribute('data-state', 'on');
  await expect(page.getByTestId('notifications-toggle')).toHaveAttribute('data-state', 'checked');
  await page.getByTestId('nav-library').click();
  // pretend the window is in the background: the import then ends in an OS notification
  await page.evaluate(() => { Object.defineProperty(document, 'hasFocus', { value: () => false }); });
  await page.getByTestId('import-open').click();
  await page.getByTestId('import-confirm').click();
  await expect(page.getByTestId('import-dialog')).toBeHidden();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __mockNotifications?: unknown[] }).__mockNotifications?.length ?? 0)).toBe(1);
  expect(await page.evaluate(() => (window as unknown as { __mockNotifications: Array<{ title: string }> }).__mockNotifications[0]!.title)).toBe('Import finished');
});

test('sidebars resize by dragging, the layout persists, long names truncate instead of clipping', async ({ page }) => {
  const sidebar = page.getByTestId('panel-sidebar');
  const before = (await sidebar.boundingBox())!;
  expect(Math.round(before.width)).toBeGreaterThanOrEqual(240);
  const handle = (await page.getByTestId('resize-sidebar').boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 200);
  await page.mouse.down();
  await page.mouse.move(handle.x + 120, handle.y + 200, { steps: 8 });
  await page.mouse.up();
  const after = (await sidebar.boundingBox())!;
  expect(after.width).toBeGreaterThan(before.width + 80);
  await page.reload();
  await expect(page.getByTestId('library')).toBeVisible();
  const again = (await page.getByTestId('panel-sidebar').boundingBox())!;
  expect(Math.abs(again.width - after.width)).toBeLessThan(4);
  // a long title and a long file name stay inside the inspector
  await page.getByTestId('project-card').filter({ hasText: 'Robotic Arm v4' }).click();
  const panel = (await page.getByTestId('panel-inspector').boundingBox())!;
  for (const text of ['Show in Explorer', 'Open']) {
    const box = (await page.getByTestId('inspector').getByRole('button', { name: text }).boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(panel.x + panel.width + 1);
  }
  const folder = page.getByTestId('filter-folder').filter({ hasText: 'Calibration' }).first();
  expect((await folder.boundingBox())!.x + (await folder.boundingBox())!.width).toBeLessThanOrEqual(again.x + again.width + 1);
  await page.screenshot({ path: 'test-results/resized-layout.png' });
});

test('cut-off names show the full text on hover; inbox and folders are siblings', async ({ page }) => {
  // inbox row and first-level folders share the same icon column
  const inbox = (await page.getByTestId('filter-inbox').first().locator('svg').first().boundingBox())!;
  const folder = (await page.getByTestId('filter-folder').first().locator('svg').first().boundingBox())!;
  expect(Math.abs(inbox.x - folder.x)).toBeLessThan(4);
  // shrink the sidebar to its minimum so a deep folder name gets cut off
  const handle = (await page.getByTestId('resize-sidebar').boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 200);
  await page.mouse.down();
  await page.mouse.move(handle.x - 200, handle.y + 200, { steps: 8 });
  await page.mouse.up();
  await page.getByTestId('filter-folder').filter({ hasText: 'Mechanical' }).first().locator('..').getByRole('button', { name: 'expand' }).click();
  const name = page.getByTestId('folder-name').filter({ hasText: 'Planetary Gearbox' });
  await expect(name).toBeVisible();
  expect(await name.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await name.hover();
  await expect(page.getByTestId('truncated-tooltip').filter({ hasText: 'Planetary Gearbox' }).first()).toBeVisible();
  // a name that fits shows no tooltip
  await page.mouse.move(5, 5);
  await page.getByTestId('folder-name').filter({ hasText: 'Desk' }).first().hover();
  await page.waitForTimeout(600);
  await expect(page.getByTestId('truncated-tooltip')).toHaveCount(0);
});

test('sidebar context menus: root rescans or reveals, folders reveal in the file manager', async ({ page }) => {
  await page.getByTestId('root-row').first().click({ button: 'right' });
  await expect(page.getByTestId('root-menu')).toBeVisible();
  await expect(page.getByTestId('root-menu')).toContainText('Rescan');
  await page.getByTestId('root-menu').getByTestId('menu-reveal-folder').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __mockRevealed?: string[] }).__mockRevealed ?? [])).toEqual(['r1:']);
  await page.getByTestId('filter-folder').filter({ hasText: 'Decor' }).first().click({ button: 'right' });
  await expect(page.getByTestId('folder-menu')).toBeVisible();
  await page.getByTestId('folder-menu').getByTestId('menu-reveal-folder').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __mockRevealed?: string[] }).__mockRevealed ?? [])).toEqual(['r1:', 'r1:Projects/Decor']);
  // leaf folders below a level without any children do not reserve a chevron column
  const inboxIcon = (await page.getByTestId('filter-inbox').first().locator('svg').first().boundingBox())!;
  const projectsIcon = (await page.getByTestId('filter-folder').filter({ hasText: 'Projects' }).first().locator('svg').first().boundingBox())!;
  expect(Math.abs(inboxIcon.x - projectsIcon.x)).toBeLessThan(4);
});

test('import: archives can be left where they are, the choice is remembered', async ({ page }) => {
  await page.getByTestId('import-open').click();
  await expect(page.getByTestId('import-dialog')).toBeVisible();
  await page.getByTestId('import-policy').click();
  await page.getByRole('option', { name: 'Leave where it is' }).click();
  await page.getByTestId('import-confirm').click();
  await expect(page.getByTestId('import-dialog')).toBeHidden();
  // no archive attachment inside the new project: 3 files instead of 4
  await expect(page.getByTestId('project-card').filter({ hasText: 'Cable Clip' }).first()).toContainText('3');
  await page.reload();
  await expect(page.getByTestId('library')).toBeVisible();
  await page.getByTestId('import-open').click();
  await expect(page.getByTestId('import-policy')).toContainText('Leave where it is');
});

test('viewer: dragging orbits, the wheel zooms, long file names do not widen the picker', async ({ page }) => {
  await page.getByTestId('project-card').filter({ hasText: 'Robotic Arm v4' }).dblclick();
  await expect(page.getByTestId('viewer-triangles')).toBeVisible({ timeout: 20000 });
  const canvas = page.getByTestId('viewer').locator('canvas');
  const before = await canvas.getAttribute('data-azimuth');
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => canvas.getAttribute('data-azimuth')).not.toBe(before);
  const dist = Number(await canvas.getAttribute('data-distance'));
  await page.mouse.wheel(0, -400);
  await expect.poll(async () => Number(await canvas.getAttribute('data-distance'))).toBeLessThan(dist);
  await page.getByTestId('back').click();
  await page.getByTestId('search').fill('Planetary');
  await page.getByTestId('project-card').filter({ hasText: 'Planetary Gearbox' }).dblclick();
  await expect(page.getByTestId('viewer-file')).toBeVisible();
  const trigger = (await page.getByTestId('viewer-file').boundingBox())!;
  expect(trigger.width).toBeLessThanOrEqual(262);
  await page.getByTestId('viewer-file').click();
  await page.getByRole('option', { name: /Planetary_Gearbox_Complete/ }).click();
  await expect(page.getByTestId('viewer-file')).toContainText('Planetary_Gearbox');
  expect((await page.getByTestId('viewer-file').boundingBox())!.width).toBeLessThanOrEqual(262);
  // the save hint sits behind an info icon now
  await page.getByTestId('save-hint').hover();
  await expect(page.getByRole('tooltip')).toContainText('automatically');
});

test('viewer: switching the model after the render loop went idle does not overflow the stack', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByTestId('project-card').filter({ hasText: 'Cable Clips' }).dblclick();
  await expect(page.getByTestId('viewer-triangles')).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(2500); // the on-demand loop stops after ~30 frames
  await page.getByTestId('viewer-file').click();
  await page.getByRole('option', { name: /clip_8mm/ }).click();
  await expect(page.getByTestId('viewer-file')).toContainText('clip_8mm');
  await expect(page.getByTestId('viewer-triangles')).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
});

test('grid rows never overlap after the window is resized', async ({ page }) => {
  const check = async (label: string) => {
    const rows = page.getByTestId('project-grid').locator('[data-index]');
    const n = await rows.count();
    const boxes = [];
    for (let i = 0; i < n; i++) boxes.push({ i: Number(await rows.nth(i).getAttribute('data-index')), box: (await rows.nth(i).boundingBox())! });
    boxes.sort((a, b) => a.i - b.i);
    for (let k = 0; k + 1 < boxes.length; k++) {
      const a = boxes[k]!, b = boxes[k + 1]!;
      const cardBottom = (await rows.nth(k).getByTestId('project-card').first().boundingBox())!;
      expect(cardBottom.y + cardBottom.height, `${label}: row ${a.i} card overlaps row ${b.i}`).toBeLessThanOrEqual(b.box.y + 0.5);
    }
  };
  await expect(page.getByTestId('project-card').first()).toBeVisible();
  await page.waitForTimeout(300);
  await check('initial');
  for (const w of [1100, 1600, 1250, 1400]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(400);
    await check(`width ${w}`);
  }
});

test('folder tree: containers get a folder icon and a count, projects a model icon', async ({ page }) => {
  const desk = page.locator('[data-tree-row][data-label="Desk"]');
  await expect(desk).toHaveAttribute('data-kind', 'folder');
  await expect(desk).toContainText('2');
  await desk.getByRole('button', { name: 'expand' }).click();
  const stand = page.locator('[data-tree-row][data-label="Phone Stand"]');
  await expect(stand).toHaveAttribute('data-kind', 'project');
  await expect(stand.locator('span.tabular')).toHaveCount(0);
  // the two rows draw different icons
  const icon = (row: ReturnType<typeof page.locator>) => row.locator('[data-select] svg').first().evaluate((el) => el.getAttribute('class'));
  expect(await icon(desk)).not.toBe(await icon(stand));
});

test('folder tree: a project row opens the project, expansion is remembered', async ({ page }) => {
  const desk = page.locator('[data-tree-row][data-label="Desk"]');
  await desk.getByRole('button', { name: 'expand' }).click();
  const stand = page.locator('[data-tree-row][data-label="Phone Stand"]');
  await stand.getByTestId('tree-project').click();
  await expect(page.getByTestId('project-page')).toBeVisible();
  await expect(page.getByTestId('project-title')).toHaveText('Phone Stand');
  await expect(stand).toHaveAttribute('aria-selected', 'true');
  // a container still filters; the tree keeps Desk open while the root is collapsed and reopened
  await page.getByTestId('filter-folder').filter({ hasText: 'Calibration' }).first().click();
  await expect(page.getByTestId('library')).toBeVisible();
  await expect(stand).toHaveAttribute('aria-selected', 'false');
  const projects = page.locator('[data-tree-row][data-label="Projects"]');
  await projects.getByRole('button', { name: 'collapse' }).click();
  await expect(desk).toHaveCount(0);
  const root = page.getByTestId('root-row').first();
  await root.getByRole('button', { name: 'collapse' }).click();
  await root.getByRole('button', { name: 'expand' }).click();
  await expect(projects).toHaveAttribute('aria-expanded', 'false');
  await projects.getByRole('button', { name: 'expand' }).click();
  await expect(desk).toHaveAttribute('aria-expanded', 'true');
  await page.reload();
  await expect(page.locator('[data-tree-row][data-label="Desk"]')).toHaveAttribute('aria-expanded', 'true');
});

test('move: the dialog moves a project into a folder or a new sub-folder, undo brings it back', async ({ page }) => {
  await page.getByTestId('project-card').filter({ hasText: 'Decorative Vase' }).click({ button: 'right' });
  await page.getByTestId('menu-move').click();
  const dialog = page.getByTestId('move-dialog');
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('move-confirm')).toBeDisabled();
  // only containers are offered: no project rows, the dragged project's own folder is not a target
  await expect(dialog.getByTestId('move-folder').filter({ hasText: 'Phone Stand' })).toHaveCount(0);
  await dialog.getByTestId('move-folder').filter({ hasText: 'Desk' }).click();
  await expect(page.getByTestId('move-confirm')).toContainText('3D Models / Projects / Desk');
  await page.getByTestId('move-confirm').click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('1 project moved to 3D Models / Projects / Desk')).toBeVisible();
  await page.getByTestId('filter-folder').filter({ hasText: 'Desk' }).first().click();
  await expect(page.getByTestId('project-card')).toHaveCount(3);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('1 project moved back')).toBeVisible();
  await expect(page.getByTestId('project-card')).toHaveCount(2);
  // a new sub-folder under the root, for a multi-selection
  await page.getByTestId('filter-all').click();
  await page.getByTestId('project-card').filter({ hasText: 'Decorative Vase' }).click();
  await page.getByTestId('project-card').filter({ hasText: 'Dice Tower' }).click({ modifiers: ['Control'] });
  await page.getByTestId('multi-move').click();
  await page.getByTestId('move-root').first().click();
  await page.getByTestId('move-subfolder').fill('Archive');
  await page.getByTestId('move-confirm').click();
  await expect(page.getByText('2 projects moved to 3D Models / Archive')).toBeVisible();
  await expect(page.locator('[data-tree-row][data-label="Archive"]')).toHaveAttribute('data-kind', 'folder');
  await expect(page.locator('[data-tree-row][data-label="Archive"]')).toContainText('2');
});

test('context menu: acts on the selection when the clicked card is part of it, else selects that card', async ({ page }) => {
  const cards = page.getByTestId('project-card');
  await cards.filter({ hasText: 'Decorative Vase' }).click();
  await cards.filter({ hasText: 'Dice Tower' }).click({ modifiers: ['Control'] });
  await cards.filter({ hasText: 'Dice Tower' }).click({ button: 'right' });
  const menu = page.getByTestId('project-menu');
  await expect(menu).toHaveAttribute('data-count', '2');
  await expect(menu.getByTestId('menu-move')).toHaveText('Move 2 projects to…');
  await expect(menu.getByTestId('menu-delete')).toHaveText('Delete 2 projects');
  await expect(menu.getByTestId('menu-rename')).toHaveCount(0);
  await menu.getByTestId('menu-favorite').click();
  await expect(page.getByTestId('favorites-count')).toHaveText('4');
  // right-click on a card outside the selection: it becomes the only selected one
  await cards.filter({ hasText: 'Cable Clips' }).click({ button: 'right' });
  await expect(page.getByTestId('project-menu')).toHaveAttribute('data-count', '1');
  await expect(page.getByTestId('project-menu').getByTestId('menu-rename')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="project-card"][aria-selected="true"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="project-card"][aria-selected="true"]')).toContainText('Cable Clips');
  // the same in the list view
  await page.getByTestId('view-list').click();
  const rows = page.getByTestId('project-row');
  // rows carry tag chips in the middle: click the title cell, not the row centre
  await rows.filter({ hasText: 'Decorative Vase' }).getByText('Decorative Vase', { exact: true }).click();
  await rows.filter({ hasText: 'Dice Tower' }).getByText('Dice Tower', { exact: true }).click({ modifiers: ['Control'] });
  await rows.filter({ hasText: 'Decorative Vase' }).getByText('Decorative Vase', { exact: true }).click({ button: 'right' });
  await expect(page.getByTestId('project-menu')).toHaveAttribute('data-count', '2');
  await page.getByTestId('project-menu').getByTestId('menu-move').click();
  await page.getByTestId('move-folder').filter({ hasText: 'Desk' }).click();
  await page.getByTestId('move-confirm').click();
  await expect(page.getByText('2 projects moved to 3D Models / Projects / Desk')).toBeVisible();
});

test('tree: a project row offers "Move to…" in its context menu', async ({ page }) => {
  const desk = page.locator('[data-tree-row][data-label="Desk"]');
  await desk.getByRole('button', { name: 'expand' }).click();
  await page.locator('[data-tree-row][data-label="Phone Stand"]').click({ button: 'right' });
  await page.getByTestId('folder-menu').getByTestId('menu-move').click();
  await expect(page.getByTestId('move-dialog')).toBeVisible();
  await page.getByTestId('move-folder').filter({ hasText: 'Decor' }).click();
  await page.getByTestId('move-confirm').click();
  await expect(page.getByText('1 project moved to 3D Models / Projects / Decor')).toBeVisible();
  await expect(page.locator('[data-tree-row][data-label="Decor"]')).toContainText('3');
});

test('move: dragging a project row in the tree onto a folder row moves it', async ({ page }) => {
  await page.locator('[data-tree-row][data-label="Desk"]').getByRole('button', { name: 'expand' }).click();
  const stand = page.locator('[data-tree-row][data-label="Phone Stand"]');
  await stand.dragTo(page.locator('[data-tree-row][data-label="Tabletop"]'));
  await expect(page.getByText('1 project moved to Tabletop')).toBeVisible();
  await expect(page.locator('[data-tree-row][data-label="Tabletop"]')).toContainText('2');
  await expect(page.locator('[data-tree-row][data-label="Desk"]')).toContainText('1');
  // container rows are not draggable
  expect(await page.locator('[data-tree-row][data-label="Desk"]').getAttribute('draggable')).not.toBe('true');
});

test('move: dragging a card onto a tree folder moves it there', async ({ page }) => {
  const card = page.getByTestId('project-card').filter({ hasText: 'Low-Poly Benchy' });
  const target = page.locator('[data-tree-row][data-label="Tabletop"]');
  await card.dragTo(target);
  await expect(page.getByText('1 project moved to Tabletop')).toBeVisible();
  await expect(target).toContainText('2');
  // a project row is not a drop target
  const stand = page.locator('[data-tree-row][data-label="Desk"]');
  await stand.getByRole('button', { name: 'expand' }).click();
  await card.dragTo(page.locator('[data-tree-row][data-label="Phone Stand"]'));
  await expect(page.getByText('moved to Phone Stand')).toHaveCount(0);
});

test('duplicates: groups projects by shared model content, keeping one trashes the rest', async ({ page }) => {
  await page.getByTestId('filter-duplicates').click();
  await expect(page.getByTestId('duplicates')).toBeVisible();
  const groups = page.getByTestId('duplicate-group');
  await expect(groups).toHaveCount(2);
  await expect(page.getByTestId('duplicates-count')).toHaveText('2');
  await expect(groups.nth(0)).toHaveAttribute('data-kind', 'identical');
  await expect(groups.nth(0)).toContainText('Decorative Vase');
  await expect(groups.nth(0)).toContainText('Twisted vase backup');
  await expect(groups.nth(1)).toHaveAttribute('data-kind', 'overlap');
  await expect(groups.nth(1)).toContainText('1 of 2 models shared');
  // in the overlap group the bundle contains the single benchy, never the other way round
  // "contained in Benchy Pack" appears on the single tile too, so match the bold title only
  const pack = groups.nth(1).getByTestId('duplicate-member').filter({ has: page.locator('.font-bold[title="Benchy Pack"]') });
  const single = groups.nth(1).getByTestId('duplicate-member').filter({ has: page.locator('.font-bold[title="Low-Poly Benchy"]') });
  await expect(pack.getByTestId('duplicate-covers')).toContainText('contains Low-Poly Benchy');
  await expect(pack.getByTestId('duplicate-keep')).toBeEnabled();
  await expect(single.getByTestId('duplicate-keep')).toBeDisabled();
  await expect(single).toContainText('contained in Benchy Pack');
  // tiles never grow past their column: the view has no horizontal overflow
  expect(await page.getByTestId('duplicates').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  // keep the original: the copy goes to the trash after the usual confirmation
  const original = groups.nth(0).getByTestId('duplicate-member').filter({ hasText: 'Projects/Decor/Vase' });
  await original.getByTestId('duplicate-keep').click();
  await expect(page.getByTestId('delete-many-dialog')).toContainText('Twisted vase backup');
  await page.getByTestId('delete-many-confirm').click();
  await expect(page.getByText('1 project moved to trash')).toBeVisible();
  await expect(page.getByTestId('duplicate-group')).toHaveCount(1, { timeout: 10_000 });
  await expect(page.getByTestId('duplicates-count')).toHaveText('1');
});

test('creator suggestions: groups projects without a creator, applies to all, dismisses one', async ({ page }) => {
  await page.getByTestId('filter-creators').click();
  await expect(page.getByTestId('creators')).toBeVisible();
  const group = page.getByTestId('creator-group').filter({ has: page.locator('h3', { hasText: 'Cinderwing3D' }) });
  await expect(group).toHaveCount(1);
  await expect(group.getByTestId('creator-project')).toHaveCount(3);
  await expect(group.getByTestId('creator-project').filter({ hasText: 'Baby Jellyfish' })).toContainText('from the model page link');
  // one is dismissed and leaves the group; the other two get the creator in one call
  await group.getByTestId('creator-project').filter({ hasText: 'Cinder Snake' }).getByTestId('creator-dismiss').click();
  await expect(group.getByTestId('creator-project')).toHaveCount(2);
  await group.getByTestId('creator-apply-all').click();
  await expect(page.getByText('Creator “Cinderwing3D” set on 2 projects')).toBeVisible();
  await expect(page.getByTestId('creator-group').filter({ has: page.locator('h3', { hasText: 'Cinderwing3D' }) })).toHaveCount(0);
  // the dismissed project shows no creator chip in the inspector, but keeps its link hint
  await page.getByTestId('filter-all').click();
  await page.getByTestId('search').fill('Cinder Snake');
  await page.getByTestId('project-card').filter({ hasText: 'Cinder Snake' }).click();
  await expect(page.getByTestId('hint-chips')).toHaveCount(0);
  await page.getByTestId('search').fill('Jellyfish');
  await page.getByTestId('project-card').filter({ hasText: 'Baby Jellyfish' }).click();
  await expect(page.getByTestId('inspector')).toContainText('Cinderwing3D');
  await expect(page.getByTestId('hint-license')).toContainText('CC-BY-NC-SA-4.0');
  await page.getByTestId('hint-source_url').getByTestId('hint-apply').click();
  await expect(page.getByText('saved to project.yaml')).toBeVisible();
  await expect(page.getByTestId('inspector')).toContainText('printables.com/@Cinderwing3D');
});

test('folder tree: arrow keys navigate and select like Explorer', async ({ page }) => {
  const title = page.getByTestId('toolbar').locator('h1');
  await page.getByTestId('filter-root').first().click();
  await expect(title).toHaveText('3D Models');
  await page.getByTestId('root-row').first().focus();
  await page.keyboard.press('ArrowDown');
  await expect(title).toContainText('Inbox');
  await page.keyboard.press('ArrowDown');
  await expect(title).toHaveText('Projects');
  await page.keyboard.press('ArrowLeft'); // collapse
  await expect(page.locator('[data-tree-row][data-label="Projects"]')).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('ArrowRight'); // expand again
  await expect(page.locator('[data-tree-row][data-label="Projects"]')).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('ArrowRight'); // step into the first child
  await expect(title).toHaveText('Calibration');
  await page.keyboard.press('ArrowLeft'); // leaf: back to the parent
  await expect(title).toHaveText('Projects');
  await page.keyboard.type('me'); // type-ahead
  await expect(title).toHaveText('Mechanical');
  await page.keyboard.press('End');
  await expect(title).toHaveText('Helmets');
  await page.keyboard.press('Home');
  await expect(title).toHaveText('3D Models');
  // the tree is one tab stop: Tab leaves it instead of walking every row
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.closest('[data-tree-row]') !== null)).toBe(false);
});
