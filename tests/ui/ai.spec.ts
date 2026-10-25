import { expect, test } from '@playwright/test';

// AI assistance (ADR-0003, Epic 9) in browser mode against the mock backend: the settings
// card, the key gate, the suggestion dialog and the write through the normal sidecar save.

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('mm.lang', 'en'); localStorage.setItem('mm.theme', 'light'); });
});

async function storeKey(page: import('@playwright/test').Page) {
  await page.goto('/#/settings');
  await expect(page.getByTestId('ai-key-status')).toHaveAttribute('data-state', 'missing');
  await page.getByTestId('ai-key').fill('sk-ant-mock-key');
  await page.getByTestId('ai-key-save').click();
  await expect(page.getByTestId('ai-key-status')).toHaveAttribute('data-state', 'stored');
  await expect(page.getByTestId('ai-key')).toHaveValue('');
}

test('settings: the AI card stores endpoint and model, the key only as a flag, and tests the connection', async ({ page }) => {
  await page.goto('/#/settings');
  const card = page.getByTestId('ai-key-status');
  await expect(card).toHaveAttribute('data-state', 'missing');
  await expect(page.getByTestId('ai-sent')).toContainText('Model files never do');
  // no key: the test button is disabled, nothing can be sent
  await expect(page.getByTestId('ai-test')).toBeDisabled();
  // endpoint and model
  await expect(page.getByTestId('ai-save')).toBeDisabled();
  await page.getByTestId('ai-base-url').fill('ftp://nope');
  await page.getByTestId('ai-save').click();
  await expect(page.getByText(/not allowed/i).first()).toBeVisible();
  await page.getByTestId('ai-base-url').fill('http://localhost:11434/');
  await page.getByTestId('ai-model').fill('my-model');
  await page.getByTestId('ai-save').click();
  await expect(page.getByText('AI settings saved')).toBeVisible();
  await expect(page.getByTestId('ai-base-url')).toHaveValue('http://localhost:11434');
  await expect(page.getByTestId('ai-save')).toBeDisabled();
  // the key: stored once, never shown again, removable
  await page.getByTestId('ai-key').fill('sk-ant-mock-key');
  await page.getByTestId('ai-key-save').click();
  await expect(card).toHaveAttribute('data-state', 'stored');
  await expect(page.getByTestId('ai-key')).toHaveValue('');
  await page.getByTestId('ai-test').click();
  await expect(page.getByTestId('ai-test-status')).toHaveAttribute('data-state', 'ok');
  await expect(page.getByTestId('ai-test-status')).toContainText('my-model');
  await page.getByTestId('ai-key-remove').click();
  await expect(card).toHaveAttribute('data-state', 'missing');
  await expect(page.getByTestId('ai-test')).toBeDisabled();
});

test('settings: a rejected key shows up in the connection test', async ({ page }) => {
  await page.goto('/?ai=unauthorized#/settings');
  await page.getByTestId('ai-key').fill('bad-key');
  await page.getByTestId('ai-key-save').click();
  await page.getByTestId('ai-test').click();
  await expect(page.getByTestId('ai-test-status')).toHaveAttribute('data-state', 'failed');
  await expect(page.getByTestId('ai-test-status')).toContainText('rejected the API key');
});

test('inspector: without a key the suggestion dialog points to settings', async ({ page }) => {
  await page.goto('/#/library');
  await page.getByTestId('project-card').filter({ hasText: 'Cable Clips' }).click();
  await page.getByTestId('inspector-suggest').click();
  await expect(page.getByTestId('suggest-setup')).toBeVisible();
  await expect(page.getByTestId('suggest-apply')).toBeDisabled();
  await page.getByTestId('suggest-open-settings').click();
  await expect(page.getByTestId('settings')).toBeVisible();
  await expect(page.getByTestId('ai-key')).toBeVisible();
});

test('inspector: a suggestion shows per-field choices, new tags are marked, applying writes the ticked fields', async ({ page }) => {
  await storeKey(page);
  await page.goto('/#/library');
  const card = page.getByTestId('project-card').filter({ hasText: 'Cable Clips' });
  await card.click();
  await expect(page.getByTestId('inspector-title')).toHaveText('Cable Clips');
  await page.getByTestId('inspector-suggest').click();
  const dialog = page.getByTestId('suggest-dialog');
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('suggest-field')).toHaveCount(4); // title is unchanged, so it is not offered
  await expect(page.getByTestId('suggest-field').filter({ has: page.getByTestId('suggest-pick-title') })).toHaveCount(0);
  await expect(page.getByTestId('suggest-tag')).toHaveCount(3);
  // "cable" exists in the library already, "clips" and "mock" do not
  await expect(page.getByTestId('suggest-tag').filter({ hasText: 'cable' }).getByTestId('suggest-tag-new')).toHaveCount(0);
  await expect(page.getByTestId('suggest-tag').filter({ hasText: 'clips' }).getByTestId('suggest-tag-new')).toHaveCount(1);
  await expect(page.getByTestId('suggest-meta')).toContainText('Model: mock');
  await expect(page.getByTestId('suggest-meta')).toContainText('3 file names');
  await expect(page.getByTestId('suggest-meta')).not.toContainText('current metadata'); // no sidecar yet
  // keep creator and tags, drop license and description
  await page.getByTestId('suggest-pick-license').uncheck();
  await page.getByTestId('suggest-pick-description').uncheck();
  await page.getByTestId('suggest-apply').click();
  await expect(page.getByText('Suggestion applied')).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('inspector')).toContainText('Mock Creator');
  await expect(page.getByTestId('inspector')).toContainText('project.yaml in sync');
  await expect(page.getByTestId('inspector')).toContainText('clips');
  await expect(page.getByTestId('inspector')).not.toContainText('CC-BY-4.0');
  await expect(page.getByTestId('inspector')).not.toContainText('Mock description');
  // asking again after the write: a fresh answer that saw the sidecar; same inputs hit the cache
  await page.getByTestId('inspector-suggest').click();
  await expect(page.getByTestId('suggest-meta')).toContainText('current metadata');
  await expect(page.getByTestId('suggest-cached')).toHaveCount(0);
  await expect(page.getByTestId('suggest-field')).toHaveCount(2); // license and description remain
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.getByTestId('inspector-suggest').click();
  await expect(page.getByTestId('suggest-cached')).toBeVisible();
});

test('inspector: provider errors are shown in the dialog with a retry', async ({ page }) => {
  await page.goto('/?ai=unavailable#/settings');
  await page.getByTestId('ai-key').fill('sk-ant-mock-key');
  await page.getByTestId('ai-key-save').click();
  await page.goto('/?ai=unavailable#/library');
  await page.getByTestId('project-card').filter({ hasText: 'Decorative Vase' }).click();
  await page.getByTestId('inspector-suggest').click();
  await expect(page.getByTestId('suggest-error')).toContainText('could not be reached');
  await expect(page.getByTestId('suggest-retry')).toBeVisible();
  await expect(page.getByTestId('suggest-apply')).toBeDisabled();
});
