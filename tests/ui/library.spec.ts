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
