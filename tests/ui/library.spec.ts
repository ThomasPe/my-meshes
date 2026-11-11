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

test('settings: the model-page switch is off by default and its state is explained', async ({ page }) => {
  await page.getByTestId('nav-settings').click();
  const status = page.getByTestId('fetch-pages-status');
  await expect(status).toHaveAttribute('data-state', 'off');
  await expect(status).toContainText('never opens a model page');
  await page.getByTestId('fetch-pages-toggle').click();
  await expect(page.getByText('Model pages will be loaded when you ask for it')).toBeVisible();
  await expect(status).toHaveAttribute('data-state', 'on');
  await expect(status).toContainText('sees your IP address');
  await page.getByTestId('nav-library').click();
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('fetch-pages-status')).toHaveAttribute('data-state', 'on');
});

test('model pages: off by default with a hint, on request the page feeds the dialog and the creator view', async ({ page }) => {
  await page.getByTestId('search').fill('Jellyfish');
  await page.getByTestId('project-card').filter({ hasText: 'Baby Jellyfish' }).click();
  await page.getByTestId('inspector-fetch-page').click();
  const dialog = page.getByTestId('suggest-dialog');
  await expect(dialog).toHaveAttribute('data-mode', 'page');
  await expect(dialog.getByTestId('suggest-setup')).toContainText('Loading model pages is off');
  await dialog.getByTestId('suggest-open-settings').click();
  await page.getByTestId('fetch-pages-toggle').click();
  await expect(page.getByTestId('fetch-pages-status')).toHaveAttribute('data-state', 'on');
  await page.getByTestId('nav-library').click();
  await page.getByTestId('search').fill('Jellyfish');
  await page.getByTestId('project-card').filter({ hasText: 'Baby Jellyfish' }).click();
  await page.getByTestId('inspector-fetch-page').click();
  await expect(dialog.getByTestId('suggest-meta')).toContainText('Read from printables.com');
  await expect(dialog.getByTestId('suggest-field').filter({ hasText: 'Creator' })).toContainText('Cinderwing3D');
  await expect(dialog.getByTestId('suggest-field').filter({ hasText: 'License' })).toContainText('CC-BY-NC-SA-4.0');
  await expect(dialog.getByTestId('suggest-tag')).toHaveCount(3);
  await expect(dialog.getByTestId('suggest-tag-new')).toHaveCount(2); // "dragon" exists in the library already
  // the page's cover picture is offered as the preview, ticked because none was chosen by hand
  const image = dialog.getByTestId('suggest-field').filter({ hasText: 'Preview image' });
  await expect(image).toContainText('Cover picture from media.printables.com');
  await expect(dialog.getByTestId('suggest-pick-image')).toBeChecked();
  await dialog.getByTestId('suggest-pick-title').uncheck();
  await dialog.getByTestId('suggest-apply').click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Preview chosen; rendering it now…')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __mockThumbPicks?: Array<string | null> }).__mockThumbPicks)).toEqual(['.meshkeep/cover.jpg']);
  // asked again, the picture is not ticked: it is the preview already and is not downloaded twice
  await page.getByTestId('inspector-fetch-page').click();
  await expect(dialog.getByTestId('suggest-field')).toHaveCount(2); // the title left unticked above, and the picture
  await expect(dialog.getByTestId('suggest-pick-image')).not.toBeChecked();
  await dialog.getByTestId('suggest-pick-title').uncheck();
  await expect(dialog.getByTestId('suggest-apply')).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('inspector')).toContainText('Cinderwing3D');
  await expect(page.getByTestId('inspector')).toContainText('CC-BY-NC-SA-4.0');
  await expect(page.getByTestId('inspector-title')).toHaveText('Baby Jellyfish');
  // the creator view can read every linked page at once; the vase copy links to Thingiverse
  await page.getByTestId('filter-creators').click();
  await page.getByTestId('creators-fetch-pages').click();
  await expect(page.getByText(/Pages read: \d+ loaded/)).toBeVisible();
  await expect(page.getByTestId('creator-group').filter({ has: page.locator('h3', { hasText: 'zackfreedman' }) })).toHaveCount(1);
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
  // the count is 0 until the first page of projects arrived
  await expect(page.getByTestId('project-card').first()).toBeVisible();
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
  // the zip's readme names the designer, license and model page; pages are off in settings
  await expect(rows.nth(0).getByTestId('import-hint')).toContainText('PrintTools · CC-BY-4.0 · printables.com/model/4242-cable-clip');
  await expect(page.getByTestId('import-apply-hints')).toBeChecked();
  await expect(page.getByTestId('import-fetch-pages')).toBeDisabled();
  // collision with an existing project is reported inline, then fixed
  await rows.nth(0).getByTestId('import-name').fill('Projects/Desk/Cable Clips');
  await page.getByTestId('import-confirm').click();
  await expect(page.getByTestId('import-error')).toBeVisible();
  await rows.nth(0).getByTestId('import-name').fill('Cable Clip');
  await page.getByTestId('import-confirm').click();
  await expect(page.getByTestId('import-dialog')).toBeHidden();
  await expect(page.getByText('Imported 1 projects, 2 files to the inbox')).toBeVisible();
  await expect(page.getByText('Metadata written for 1 projects, 0 model pages read')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recent additions' })).toBeVisible();
  await expect(page.getByTestId('project-card').first()).toContainText('Cable Clip');
  await expect(page.getByTestId('project-card').first().getByTestId('card-creator')).toContainText('PrintTools');
});

test('import: with model pages on, the page fills the new project', async ({ page }) => {
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('fetch-pages-toggle').click();
  await expect(page.getByTestId('fetch-pages-status')).toHaveAttribute('data-state', 'on');
  await page.getByTestId('nav-library').click();
  await page.getByTestId('import-open').click();
  await expect(page.getByTestId('import-fetch-pages')).toBeEnabled();
  await expect(page.getByTestId('import-fetch-pages')).toBeChecked();
  await page.getByTestId('import-confirm').click();
  await expect(page.getByText('Metadata written for 1 projects, 1 model pages read')).toBeVisible();
  const card = page.getByTestId('project-card').first();
  await expect(card).toContainText('Cable Clip Deluxe');
  await expect(card.getByTestId('card-creator')).toContainText('PrintTools');
  await card.click();
  await expect(page.getByTestId('inspector')).toContainText('CC-BY-4.0');
  await expect(page.getByTestId('inspector')).toContainText('printables.com/model/4242-cable-clip');
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

test('image viewer: pictures stored inside a 3MF show in the gallery, read-only', async ({ page }) => {
  // the Dice Tower has no image files; its 3MF plays a MakerWorld download with two model pictures
  await page.getByTestId('project-card').filter({ hasText: 'Dice Tower' }).dblclick();
  await expect(page.getByTestId('tab-images')).toContainText('2');
  await page.getByTestId('tab-images').click();
  const tiles = page.getByTestId('image-tile');
  await expect(tiles).toHaveCount(2);
  await expect(tiles.first().locator('img')).toBeVisible();
  await expect(tiles.first().getByTestId('embedded-badge')).toHaveText('From tower.3mf');
  await expect(tiles.first().getByTestId('use-as-thumbnail')).toHaveCount(0);
  await tiles.first().locator('button').first().click();
  await expect(page.getByTestId('lightbox-img')).toBeVisible();
  await expect(page.getByTestId('lightbox-name')).toHaveText('cover.webp');
  await expect(page.getByText('1 of 2')).toBeVisible();
  await page.getByTestId('lightbox-next').click();
  await expect(page.getByTestId('lightbox-name')).toHaveText('printed.webp');
});

test('preview: a project image or the current view becomes the thumbnail, automatic again on request', async ({ page }) => {
  await page.getByTestId('project-card').filter({ hasText: 'Gridfinity Baseplates' }).dblclick();
  await page.getByTestId('tab-images').click();
  const tile = page.getByTestId('image-tile').first();
  await expect(tile.getByTestId('thumbnail-badge')).toHaveCount(0);
  await tile.hover();
  await tile.getByTestId('use-as-thumbnail').click();
  await expect(page.getByText('Preview chosen; rendering it now…')).toBeVisible();
  await expect(tile.getByTestId('thumbnail-badge')).toBeVisible();
  await expect(page.getByTestId('image-gallery')).toContainText('Preview image: photo_desk.png');
  expect(await page.evaluate(() => (window as unknown as { __mockThumbPicks?: Array<string | null> }).__mockThumbPicks)).toEqual(['photo_desk.png']);
  // the header shows the same preview as the card once the queue rendered it, and its menu
  // offers the way back to the automatic choice
  const headerThumb = page.getByTestId('project-thumb');
  await expect(headerThumb.getByTestId('thumb-img')).toBeVisible({ timeout: 20_000 });
  await headerThumb.click();
  await page.getByTestId('project-thumb-auto').click();
  await expect(page.getByText('Preview is chosen automatically again')).toBeVisible();
  await expect(tile.getByTestId('thumbnail-badge')).toHaveCount(0);
  await headerThumb.click();
  await expect(page.getByTestId('project-thumb-rerender')).toBeVisible();
  await expect(page.getByTestId('project-thumb-auto')).toHaveCount(0);
  await page.keyboard.press('Escape');
  // the viewer's current view, saved inside the project and listed with the images
  await page.getByRole('tab', { name: 'Overview' }).click();
  await expect(page.getByTestId('viewer-triangles')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('viewer-set-thumbnail').click();
  await expect(page.getByText('Preview chosen; rendering it now…').last()).toBeVisible();
  await page.getByTestId('tab-images').click();
  await expect(page.getByTestId('image-tile')).toHaveCount(2);
  const capture = page.getByTestId('image-tile').filter({ hasText: 'View from the viewer' });
  await expect(capture.getByTestId('thumbnail-badge')).toBeVisible();
  await expect(capture.locator('img')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __mockThumbPicks?: Array<string | null> }).__mockThumbPicks)).toEqual(['photo_desk.png', null, '.meshkeep/preview.png']);
  // the card picks the new preview up once the queue rendered it
  await page.getByTestId('back').click();
  await expect(page.getByTestId('project-card').filter({ hasText: 'Gridfinity Baseplates' }).locator('img')).toBeVisible({ timeout: 20_000 });
});

test('MCP server: off by default, enabling mints a token, snippets and import folders follow the settings', async ({ page }) => {
  await page.getByTestId('nav-settings').click();
  const state = page.getByTestId('mcp-state');
  await expect(state).toHaveAttribute('data-state', 'off');
  await expect(page.getByTestId('mcp-token')).toHaveValue('');
  await expect(page.getByTestId('mcp-snippets')).toHaveCount(0);
  await page.getByTestId('mcp-toggle').click();
  await expect(page.getByText('MCP server started')).toBeVisible();
  await expect(state).toHaveAttribute('data-state', 'running');
  await expect(state).toContainText('127.0.0.1:7340');
  await expect(page.getByTestId('mcp-token')).toHaveValue(/^•+$/);
  await page.getByTestId('mcp-token-show').click();
  const token = await page.getByTestId('mcp-token').inputValue();
  expect(token).toMatch(/^mk_[0-9a-f]{48}$/);
  await expect(page.getByTestId('mcp-snippet-desktop')).toContainText(`"--mcp",\n        "http://127.0.0.1:7340/mcp",\n        "${token}"`);
  await expect(page.getByTestId('mcp-snippet-code')).toContainText(`claude mcp add --transport http meshkeep http://127.0.0.1:7340/mcp --header "Authorization: Bearer ${token}"`);
  // a new token replaces the old one everywhere
  await page.getByTestId('mcp-token-regen').click();
  await expect(page.getByText('New token created; update your client configuration')).toBeVisible();
  await expect(page.getByTestId('mcp-token')).not.toHaveValue(token);
  await expect(page.getByTestId('mcp-snippet-code')).not.toContainText(token);
  // writes are a separate switch; import folders start empty and take Downloads in one click
  await expect(page.getByTestId('mcp-folders')).toContainText('none yet');
  await page.getByTestId('mcp-folder-downloads').click();
  await expect(page.getByTestId('mcp-folder')).toHaveCount(1);
  await expect(page.getByTestId('mcp-folder')).toContainText('Downloads');
  await page.getByTestId('mcp-folder-add').click();
  await expect(page.getByTestId('mcp-folder')).toHaveCount(2);
  // deleting is a third step: locked until writes are on, and off again when writes go off (#57)
  await expect(page.getByTestId('mcp-deletes')).toBeDisabled();
  await page.getByTestId('mcp-writes').click();
  await expect(page.getByText('Agents may now write metadata and import')).toBeVisible();
  await expect(page.getByTestId('mcp-deletes')).toBeEnabled();
  await page.getByTestId('mcp-deletes').click();
  await expect(page.getByText('Agents may now move files and projects to the trash')).toBeVisible();
  const saved = await page.evaluate(() => (window as unknown as { __mockMcp?: Array<{ enabled: boolean; allow_writes: boolean; allow_deletes: boolean; import_dirs: string[] }> }).__mockMcp!.at(-1));
  expect(saved).toMatchObject({ enabled: true, allow_writes: true, allow_deletes: true, import_dirs: ['C:\\Users\\mock\\Downloads', 'E:\\More Models'] });
  await page.getByTestId('mcp-writes').click();
  await expect(page.getByTestId('mcp-deletes')).toBeDisabled();
  await expect(page.getByTestId('mcp-deletes')).toHaveAttribute('data-state', 'unchecked');
  await page.getByTestId('mcp-writes').click();
  await expect(page.getByTestId('mcp-deletes')).toHaveAttribute('data-state', 'unchecked');
  // a port below 1024 is refused, a taken port shows up in the status line
  await page.getByTestId('mcp-port').fill('80');
  await page.getByTestId('mcp-port-save').click();
  await expect(page.getByText('Choose a port between 1024 and 65535')).toBeVisible();
  await page.getByTestId('mcp-port').fill('7341');
  await page.getByTestId('mcp-port-save').click();
  await expect(state).toHaveAttribute('data-state', 'error');
  await expect(state).toContainText('address in use');
  await page.getByTestId('mcp-toggle').click();
  await expect(state).toHaveAttribute('data-state', 'off');
  await expect(page.getByTestId('mcp-snippets')).toHaveCount(0);
});

test('first start: importing without a library offers to create one instead of a dead end (#51)', async ({ page }) => {
  await page.goto('/?empty=1#/library');
  await expect(page.getByTestId('welcome')).toBeVisible();
  await page.getByTestId('welcome-import').click();
  const dialog = page.getByTestId('import-dialog');
  await expect(dialog.getByTestId('import-item')).toHaveCount(3);
  await expect(dialog.getByTestId('import-no-root')).toContainText('No library folder yet');
  await expect(dialog.getByTestId('import-root')).toHaveCount(0);
  await expect(dialog.getByTestId('import-confirm')).toBeDisabled();
  await dialog.getByTestId('import-add-root').click();
  await expect(page.getByText('Added E:\\More Models')).toBeVisible();
  await expect(dialog.getByTestId('import-no-root')).toHaveCount(0);
  await expect(dialog.getByTestId('import-root')).toContainText('E:\\More Models');
  await expect(dialog.getByTestId('import-confirm')).toBeEnabled();
  await dialog.getByTestId('import-confirm').click();
  await expect(page.getByText('Imported 1 projects, 2 files to the inbox')).toBeVisible();
  await expect(page.getByTestId('project-card')).toHaveCount(1);
  await expect(page.getByTestId('project-card').first()).toContainText('Cable Clip');
});

test('feedback opens from the header on any page (#54)', async ({ page }) => {
  await page.getByTestId('nav-feedback').click();
  await expect(page.getByTestId('feedback-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('feedback-dialog')).toBeHidden();
  await page.getByTestId('project-card').first().dblclick();
  await expect(page.getByTestId('project-page')).toBeVisible();
  await page.getByTestId('nav-feedback').click();
  await expect(page.getByTestId('feedback-dialog')).toBeVisible();
});

test('viewer: switching to a cached project swaps the model instead of keeping the old one (#53)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const canvas = page.getByTestId('viewer').locator('canvas');
  const open = async (folder: string, label: string) => {
    const row = page.locator(`[data-tree-row][data-label="${folder}"]`);
    if ((await row.getAttribute('aria-expanded')) !== 'true') await row.getByRole('button', { name: 'expand' }).click();
    await page.locator(`[data-tree-row][data-label="${label}"]`).getByTestId('tree-project').click();
    await expect(page.getByTestId('project-title')).toHaveText(label);
  };
  await open('Misc', 'Twisted vase backup');
  await expect(canvas).toHaveAttribute('data-file', 'vase_twist.stl');
  await expect(page.getByTestId('viewer-triangles')).toBeVisible({ timeout: 30_000 });
  await open('Calibration', 'Benchy Pack');
  await expect(canvas).toHaveAttribute('data-file', 'benchy_lowpoly.stl');
  await expect(page.getByTestId('viewer-triangles')).toBeVisible({ timeout: 30_000 });
  // both are cached now: the page keeps the viewer mounted while it switches, back and forth, quickly
  await open('Misc', 'Twisted vase backup');
  await open('Calibration', 'Benchy Pack');
  await open('Misc', 'Twisted vase backup');
  await expect(canvas).toHaveAttribute('data-file', 'vase_twist.stl');
  await expect(page.getByTestId('viewer-triangles')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('viewer-status')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('project page uses the whole window on large screens (#52)', async ({ page }) => {
  await page.setViewportSize({ width: 2400, height: 1300 });
  await page.getByTestId('project-card').filter({ hasText: 'Robotic Arm v4' }).dblclick();
  await expect(page.getByTestId('project-page')).toBeVisible();
  const pageBox = (await page.getByTestId('project-page').boundingBox())!;
  const viewer = (await page.getByTestId('viewer').boundingBox())!;
  const form = (await page.getByTestId('metadata-form').boundingBox())!;
  // viewer plus form span the page apart from the gutters; the viewer gets the lion's share
  expect(viewer.x + viewer.width + 20 + form.width).toBeGreaterThan(pageBox.x + pageBox.width - 80);
  expect(viewer.width).toBeGreaterThan(1300);
  expect(form.width).toBeLessThanOrEqual(560);
  // and it grows with the window height instead of staying 440 px tall; with several models
  // the strip of previews below takes its share, and the two together reach the bottom
  expect(viewer.height).toBeGreaterThan(800);
  const strip = (await page.getByTestId('viewer-models').boundingBox())!;
  expect(strip.y + strip.height).toBeGreaterThan(1300 - 110);
  expect(strip.y + strip.height).toBeLessThanOrEqual(1300);
  await page.setViewportSize({ width: 1400, height: 900 });
  expect((await page.getByTestId('viewer').boundingBox())!.height).toBeLessThan(620);
});

test('library conventions: starter set, validation, check with deviations (#58)', async ({ page }) => {
  await page.getByTestId('nav-settings').click();
  const r1 = page.locator('[data-testid="conventions-root"][data-root="r1"]');
  await expect(r1).toHaveAttribute('data-state', 'none');
  await expect(r1.getByTestId('conventions-check')).toBeDisabled();
  await r1.getByTestId('conventions-starter').click();
  await expect(r1.getByTestId('conventions-text')).toHaveValue(/pattern: "\{creator\}\/\{title\}"/);
  await r1.getByTestId('conventions-save').click();
  await expect(page.getByText('Conventions saved')).toBeVisible();
  await expect(r1).toHaveAttribute('data-state', 'set');
  await r1.getByTestId('conventions-check').click();
  const report = r1.getByTestId('conventions-report');
  await expect(report).toContainText('4 deviations in');
  await expect(report.locator('[data-kind="folder"]')).toHaveCount(3);
  await expect(report.locator('[data-kind="license"]')).toContainText('GPL-3.0 → Personal use');
  // a text that does not parse is refused and the file stays as it was
  await r1.getByTestId('conventions-text').fill('bad: yes');
  await r1.getByTestId('conventions-save').click();
  await expect(page.getByText(/Invalid conventions.yaml/)).toBeVisible();
  await expect(r1).toHaveAttribute('data-state', 'set');
  // emptying the text removes the file
  await r1.getByTestId('conventions-text').fill('');
  await r1.getByTestId('conventions-save').click();
  await expect(page.getByText('Conventions removed')).toBeVisible();
  await expect(r1).toHaveAttribute('data-state', 'none');
});

test('packed projects: a zip stays packed on import, is read in place, unpacked and packed again (LIB-9)', async ({ page }) => {
  await page.getByTestId('import-open').click();
  const dialog = page.getByTestId('import-dialog');
  // the default policy: the archive leaves its source folder instead of being copied into the project
  await expect(dialog.getByTestId('import-policy')).toContainText('Remove from the source folder (trash)');
  const zipRow = dialog.getByTestId('import-item').filter({ hasText: 'Cable Clip.zip' });
  await expect(dialog.getByTestId('import-zip-mode')).toHaveAttribute('data-mode', 'unpack');
  await expect(zipRow.getByTestId('import-action')).toContainText('New project');
  await expect(dialog.getByTestId('import-policy-packed')).toHaveCount(0);
  await dialog.getByTestId('import-zip-packed').click();
  await expect(zipRow.getByTestId('import-action')).toContainText('Packed project');
  await expect(zipRow.getByTestId('import-name')).toHaveValue('Cable Clip');
  // a 7z cannot stay packed, so its row does not offer it
  await dialog.getByTestId('import-item').filter({ hasText: 'notes.7z' }).getByTestId('import-action').click();
  await expect(page.getByRole('option', { name: 'Packed project' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog.getByTestId('import-policy-packed')).toContainText('the archive itself moves into the project');
  await dialog.getByTestId('import-confirm').click();
  await expect(page.getByText('Imported 1 projects, 2 files to the inbox')).toBeVisible();
  await expect(page.getByText(/1 kept packed/)).toBeVisible();
  const card = page.getByTestId('project-card').filter({ hasText: 'Cable Clip' }).first();
  await expect(card.getByTestId('packed-badge')).toBeVisible();
  await card.dblclick();
  await expect(page.getByTestId('project-page').getByTestId('packed-badge')).toBeVisible();
  // the viewer loads the model from inside the archive
  await expect(page.getByTestId('viewer').locator('canvas')).toHaveAttribute('data-file', 'Cable Clip.zip/Cable Clip/part_a.stl');
  await expect(page.getByTestId('viewer-triangles')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('tab', { name: /Files/ }).click();
  await expect(page.locator('[data-testid="file-row"][data-packed]')).toHaveCount(3);
  await expect(page.getByTestId('packed-hint')).toContainText('Cable Clip.zip');
  const inner = page.getByTestId('file-row').filter({ hasText: 'part_a.stl' });
  await expect(inner.getByTestId('file-delete')).toBeDisabled();
  await expect(page.getByTestId('file-row').filter({ hasText: /^Cable Clip\.zip/ }).first().getByTestId('file-delete')).toBeDisabled();
  await inner.getByRole('button', { name: 'Open with default app' }).click();
  expect(await page.evaluate(() => (window as unknown as { __mockOpenedFiles?: string[] }).__mockOpenedFiles)).toEqual(['r1:Cable Clip/Cable Clip.zip/Cable Clip/part_a.stl']);

  // unpack: the wrapper folder of the download is stripped, the zip goes
  await page.getByTestId('project-unpack').click();
  await expect(page.getByTestId('pack-dialog')).toHaveAttribute('data-mode', 'unpack');
  await expect(page.getByTestId('unpack-keep-archive')).not.toBeChecked();
  await page.getByTestId('pack-confirm').click();
  await expect(page.getByText(/1 project unpacked/)).toBeVisible();
  await expect(page.getByTestId('project-page').getByTestId('packed-badge')).toHaveCount(0);
  await expect(page.getByTestId('file-row')).toHaveCount(3);
  await expect(page.locator('[data-testid="file-row"][data-packed]')).toHaveCount(0);
  await expect(page.getByTestId('file-row').filter({ hasText: 'part_a.stl' }).getByTestId('file-delete')).toBeEnabled();

  // pack again: only the models go into the zip, the readme stays loose
  await page.getByTestId('project-pack').click();
  await expect(page.getByTestId('pack-dialog')).toHaveAttribute('data-mode', 'pack');
  await page.getByTestId('pack-confirm').click();
  await expect(page.getByText(/1 project packed: .* → /)).toBeVisible();
  await expect(page.getByTestId('project-page').getByTestId('packed-badge')).toBeVisible();
  await expect(page.getByTestId('file-row')).toHaveCount(4);
  await expect(page.locator('[data-testid="file-row"][data-packed]')).toHaveCount(2);
  await page.getByRole('tab', { name: 'Overview' }).click();
  await expect(page.getByTestId('viewer').locator('canvas')).toHaveAttribute('data-file', 'Cable Clip.zip/part_a.stl');
  await expect(page.getByTestId('viewer-triangles')).toBeVisible({ timeout: 30_000 });

  // the zip mode is remembered for the next import
  await page.getByTestId('back').click();
  await page.getByTestId('import-open').click();
  await expect(page.getByTestId('import-zip-mode')).toHaveAttribute('data-mode', 'packed');
  await expect(page.getByTestId('import-item').filter({ hasText: 'Cable Clip.zip' }).getByTestId('import-action')).toContainText('Packed project');
});

test('packed projects: packing from the context menu, for a selection (LIB-9)', async ({ page }) => {
  await page.getByTestId('search').fill('clip');
  const card = page.getByTestId('project-card').filter({ hasText: 'Cable Clips' });
  await card.click({ button: 'right' });
  await page.getByTestId('menu-pack').click();
  await expect(page.getByTestId('pack-dialog')).toContainText('Pack “Cable Clips”?');
  await page.getByTestId('pack-confirm').click();
  await expect(page.getByText(/1 project packed/)).toBeVisible();
  await expect(card.getByTestId('packed-badge')).toBeVisible();
  // a packed project offers unpacking instead, and keeps the zip on request
  await card.click({ button: 'right' });
  await expect(page.getByTestId('menu-pack')).toHaveCount(0);
  await page.getByTestId('menu-unpack').click();
  await page.getByTestId('unpack-keep-archive').check();
  await page.getByTestId('pack-confirm').click();
  await expect(page.getByText(/1 project unpacked/)).toBeVisible();
  await expect(card.getByTestId('packed-badge')).toHaveCount(0);
  await card.dblclick();
  await page.getByRole('tab', { name: /Files/ }).click();
  await expect(page.getByTestId('file-row').filter({ hasText: 'Cable Clips.zip' })).toHaveCount(1);
  await expect(page.locator('[data-testid="file-row"][data-packed]')).toHaveCount(0);
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
  // the models are picked from the strip under the viewer; a long name widens neither its tile nor the label
  const long = page.getByTestId('viewer-models').getByRole('option', { name: /Planetary_Gearbox_Complete/ });
  await long.click();
  await expect(page.getByTestId('viewer-file')).toContainText('Planetary_Gearbox');
  expect((await page.getByTestId('viewer-file').boundingBox())!.width).toBeLessThanOrEqual(262);
  expect((await long.boundingBox())!.width).toBeLessThanOrEqual(93);
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
  await page.getByTestId('viewer-models').getByRole('option', { name: /clip_8mm/ }).click();
  await expect(page.getByTestId('viewer-file')).toContainText('clip_8mm');
  await expect(page.getByTestId('viewer-triangles')).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
});

test('project: every model has a preview, the strip under the viewer picks the model, the files tab switches between list and grid (VIEW-8)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // one model: nothing to pick from
  await page.getByTestId('project-card').filter({ hasText: 'Decorative Vase' }).dblclick();
  await expect(page.getByTestId('viewer-file')).toHaveText('vase_twist.stl');
  await expect(page.getByTestId('viewer-models')).toHaveCount(0);
  await page.getByTestId('back').click();

  await page.getByTestId('search').fill('Robotic');
  await page.getByTestId('project-card').filter({ hasText: 'Robotic Arm v4' }).dblclick();
  const canvas = page.getByTestId('viewer').locator('canvas');
  const strip = page.getByTestId('viewer-models');
  const options = strip.getByRole('option');
  await expect(options).toHaveCount(5);
  await expect(options.first()).toHaveAttribute('aria-selected', 'true');
  await expect(canvas).toHaveAttribute('data-file', 'base.stl');
  // every model of the project gets its own picture, rendered once
  await expect(strip.getByTestId('file-thumb-img')).toHaveCount(5, { timeout: 60_000 });
  // the strip fits under the viewer without scrolling the page
  const viewport = page.viewportSize()!;
  const box = (await strip.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);

  // a click picks the model; the arrow keys walk through the strip
  await strip.getByRole('option', { name: 'upper_arm.stl' }).click();
  await expect(canvas).toHaveAttribute('data-file', 'upper_arm.stl');
  await expect(page.getByTestId('viewer-file')).toHaveText('upper_arm.stl');
  await expect(strip.getByRole('option', { name: 'upper_arm.stl' })).toHaveAttribute('aria-selected', 'true');
  await expect(strip.locator('[aria-selected="true"]')).toHaveCount(1);
  const picked = await strip.locator('[aria-selected="true"]').getAttribute('data-file');
  await page.keyboard.press('ArrowRight');
  await expect(strip.locator('[aria-selected="true"]')).not.toHaveAttribute('data-file', picked!);
  await expect(strip.locator('[aria-selected="true"]')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(canvas).toHaveAttribute('data-file', 'upper_arm.stl');
  await page.keyboard.press('End');
  await expect(options.last()).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await expect(canvas).toHaveAttribute('data-file', 'base.stl');

  // files: a list with small previews by default
  await page.getByRole('tab', { name: /Files/ }).click();
  await expect(page.getByTestId('files')).toHaveAttribute('data-view', 'list');
  await expect(page.getByTestId('file-row')).toHaveCount(8);
  await expect(page.getByTestId('file-row').filter({ hasText: 'forearm.stl' }).getByTestId('file-thumb-img')).toBeVisible();
  // ... or a grid: models as rendered, images as themselves, the rest as glyphs
  await page.getByTestId('files-view-grid').click();
  await expect(page.getByTestId('files')).toHaveAttribute('data-view', 'grid');
  await expect(page.getByTestId('file-row')).toHaveCount(0);
  const tiles = page.getByTestId('file-tile');
  await expect(tiles).toHaveCount(8);
  await expect(page.locator('[data-testid="file-tile"][data-kind="model"]').getByTestId('file-thumb-img')).toHaveCount(5);
  await expect(tiles.filter({ hasText: 'assembly.jpg' }).locator('img')).toBeVisible();
  await expect(tiles.filter({ hasText: 'BOM.pdf' }).locator('img')).toHaveCount(0);
  await expect(tiles.filter({ hasText: 'BOM.pdf' }).getByTestId('file-show')).toHaveCount(0);
  // nothing was rendered twice for the second view
  const rendered = await page.evaluate(() => (window as unknown as { __mockFileThumbs?: string[] }).__mockFileThumbs ?? []);
  expect(new Set(rendered).size).toBe(rendered.length);
  expect(rendered.length).toBeLessThanOrEqual(5);
  // deleting still works from a tile
  await tiles.filter({ hasText: 'firmware.zip' }).hover();
  await tiles.filter({ hasText: 'firmware.zip' }).getByTestId('file-delete').click();
  await page.getByTestId('delete-file-confirm').click();
  await expect(tiles).toHaveCount(7);

  // a click on a model's preview puts it on screen in the viewer
  await tiles.filter({ hasText: 'forearm.stl' }).getByTestId('file-show').click();
  await expect(page.getByTestId('viewer')).toBeVisible();
  await expect(canvas).toHaveAttribute('data-file', 'forearm.stl');
  await expect(strip.getByRole('option', { name: 'forearm.stl' })).toHaveAttribute('aria-selected', 'true');

  // the chosen view is remembered, the chosen model belongs to its project
  await page.getByTestId('back').click();
  await page.getByTestId('search').fill('Cable Clips');
  await page.getByTestId('project-card').filter({ hasText: 'Cable Clips' }).dblclick();
  await expect(canvas).toHaveAttribute('data-file', 'clip_6mm.stl');
  await page.getByRole('tab', { name: /Files/ }).click();
  await expect(page.getByTestId('files')).toHaveAttribute('data-view', 'grid');
  await page.getByTestId('files-view-list').click();
  await expect(page.getByTestId('file-row')).toHaveCount(3);

  // more models than fit: the wheel moves the strip, the chosen model is scrolled into sight
  await page.setViewportSize({ width: 600, height: 800 });
  await page.getByTestId('back').click();
  await page.getByTestId('search').fill('Planetary');
  await page.getByTestId('project-card').filter({ hasText: 'Planetary Gearbox' }).dblclick();
  await expect(strip.getByRole('option')).toHaveCount(5);
  const scroll = () => strip.evaluate((el) => ({ left: el.scrollLeft, width: el.clientWidth, full: el.scrollWidth }));
  expect((await scroll()).full).toBeGreaterThan((await scroll()).width);
  await strip.hover();
  await page.mouse.wheel(0, 200);
  await expect.poll(async () => (await scroll()).left).toBeGreaterThan(0);
  await strip.getByRole('option').first().focus();
  await page.keyboard.press('End');
  await expect(strip.getByRole('option').last()).toHaveAttribute('aria-selected', 'true');
  const edge = (await strip.boundingBox())!;
  await expect.poll(async () => { const b = (await strip.getByRole('option').last().boundingBox())!; return b.x + b.width; }).toBeLessThanOrEqual(edge.x + edge.width + 1);
  await page.keyboard.press('Home');
  await expect.poll(async () => (await scroll()).left).toBe(0);
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

test('list view: one scroll container with a sticky header, at any window size (#64)', async ({ page }) => {
  await page.getByTestId('view-list').click();
  const scroller = page.getByTestId('project-list-scroll');
  const rows = page.getByTestId('project-row');
  await expect(rows.first()).toBeVisible();

  // One snapshot of the geometry per call: the rows are virtual and get replaced while the
  // list scrolls, so nothing is measured across two round trips.
  const layout = () => scroller.evaluate((el) => {
    const main = el.closest('main')!;
    const rect = (e: Element) => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width }; };
    const scrollsY = (e: Element) => /auto|scroll/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 1;
    // everything between the list and the document that could show a scrollbar of its own
    const spilling: string[] = [];
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      if (a.scrollWidth > a.clientWidth + 1 || a.scrollHeight > a.clientHeight + 1) spilling.push(`${a.tagName.toLowerCase()}[${a.getAttribute('data-testid') ?? a.id}] ${a.scrollWidth}x${a.scrollHeight} in ${a.clientWidth}x${a.clientHeight}`);
    }
    const head = rect(el.querySelector('[data-testid=project-list-head]')!);
    const all = [...el.querySelectorAll('[data-testid=project-row]')];
    const card = rect(el);
    return {
      verticalScrollers: [main, ...main.querySelectorAll('*')].filter(scrollsY).map((e) => e.getAttribute('data-testid')),
      spilling,
      main: rect(main),
      importButton: rect(main.querySelector('[data-testid=import-open]')!),
      statusbarTop: document.querySelector('[data-testid=statusbar]')!.getBoundingClientRect().top,
      card: { ...card, viewBottom: card.top + el.clientHeight, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, scrollTop: el.scrollTop, scrollLeft: el.scrollLeft },
      head,
      firstRow: all.length ? rect(all[0]!) : null,
      lastRow: all.length ? rect(all[all.length - 1]!) : null,
      rowBelowHead: !!document.elementFromPoint(card.left + 100, head.bottom + 20)?.closest('[data-testid=project-row]'),
    };
  });

  for (const size of [{ width: 2560, height: 1300 }, { width: 1400, height: 900 }, { width: 1000, height: 640 }]) {
    const label = `${size.width}x${size.height}`;
    await page.setViewportSize(size);
    await scroller.evaluate((el) => el.scrollTo(0, 0));
    await expect(rows.first()).toContainText('Cable Clips');
    const top = await layout();
    // the bug: the card scrolled by a few pixels and the rows scrolled again inside it
    expect(top.verticalScrollers, `${label}: vertical scroll containers in the main panel`).toEqual(['project-list-scroll']);
    // and nothing around the list scrolls or is pushed out of the panel by the table's width
    expect(top.spilling, `${label}: ancestors with overflowing content`).toEqual([]);
    expect(top.importButton.right, `${label}: the toolbar stays inside the panel`).toBeLessThanOrEqual(top.main.right);
    expect(top.card.bottom, `${label}: the card ends above the status bar`).toBeLessThan(top.statusbarTop);
    expect(Math.abs(top.head.top - top.card.top), `${label}: header at the top of the card`).toBeLessThanOrEqual(1);
    expect(Math.abs(top.firstRow!.top - top.head.bottom), `${label}: first row right below the header`).toBeLessThanOrEqual(1);

    // the header stays where it is while the rows move under it
    await scroller.evaluate((el) => el.scrollTo(0, 900));
    await expect(rows.first()).not.toContainText('Cable Clips');
    const mid = await layout();
    expect(mid.card.scrollTop, label).toBe(900);
    expect(Math.abs(mid.head.top - top.head.top), `${label}: header stays at the top`).toBeLessThanOrEqual(1);
    expect(mid.rowBelowHead, `${label}: rows are rendered at the scroll position`).toBe(true);

    // the list ends with its last row, flush with the bottom of the card
    await scroller.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect.poll(async () => { const l = await layout(); return l.lastRow ? Math.abs(l.lastRow.bottom - l.card.viewBottom) : Infinity; }, `${label}: last row at the bottom of the card`).toBeLessThanOrEqual(1);
  }

  // a panel narrower than the columns scrolls the table sideways, header and rows together
  await scroller.evaluate((el) => el.scrollTo(120, 0));
  await expect(rows.first()).toContainText('Cable Clips');
  const side = await layout();
  expect(side.card.scrollWidth).toBeGreaterThan(side.card.clientWidth);
  expect(side.card.scrollLeft).toBe(120);
  expect(Math.abs(side.head.left - (side.card.left - 120))).toBeLessThanOrEqual(1);
  expect(Math.abs(side.firstRow!.left - side.head.left)).toBeLessThanOrEqual(1);
  // header and rows are as wide as the columns, so their backgrounds do not end before the last cell
  expect(side.head.width).toBeGreaterThanOrEqual(side.card.scrollWidth - 1);
  expect(Math.abs(side.firstRow!.width - side.head.width)).toBeLessThanOrEqual(1);
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

test('context menu: keys pressed in the open menu stay there, Escape only closes it', async ({ page }) => {
  // A menu that is still in the page while it closes is what let its keys through to the
  // library, which then cleared the selection. Without a closing animation that only happens
  // when Escape comes before the opening animation has started, a matter of milliseconds that
  // made this fail now and then. A closing animation makes it the rule.
  await page.addStyleTag({ content: '@keyframes test-menu-out { to { opacity: 0 } } [data-testid=project-menu][data-state=closed] { animation: test-menu-out 250ms }' });
  const menu = page.getByTestId('project-menu');
  const dialogs = page.getByRole('dialog');

  for (const view of ['grid', 'list'] as const) {
    await page.getByTestId(`view-${view}`).click();
    const item = view === 'grid'
      ? page.getByTestId('project-card').filter({ hasText: 'Cable Clips' })
      : page.getByTestId('project-row').filter({ hasText: 'Cable Clips' }).getByText('Cable Clips', { exact: true });
    const selected = page.locator(`[data-testid="project-${view === 'grid' ? 'card' : 'row'}"][aria-selected="true"]`);

    // Escape closes the menu, the project it was opened on stays selected
    await item.click({ button: 'right' });
    await expect(menu.getByTestId('menu-rename')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveAttribute('data-state', 'closed');
    await expect(menu, `${view}: menu closes`).toHaveCount(0);
    await expect(selected, `${view}: selection survives closing the menu`).toHaveCount(1);
    await expect(selected).toContainText('Cable Clips');

    // the library's own shortcuts do not fire from inside the menu either
    await item.click({ button: 'right' });
    await expect(menu.getByTestId('menu-rename')).toBeVisible();
    await page.keyboard.press('Delete');
    await page.keyboard.press('F2');
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(dialogs, `${view}: no delete or rename dialog`).toHaveCount(0);
    await expect(selected).toHaveCount(1);

    // with no menu open they work as before: F2 renames, Escape clears the selection
    await item.click();
    await page.keyboard.press('F2');
    await expect(page.getByTestId('rename-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('rename-dialog')).toBeHidden();
    await expect(selected).toHaveCount(1);
    await item.click();
    await page.keyboard.press('Escape');
    await expect(selected, `${view}: Escape clears the selection`).toHaveCount(0);
  }
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
