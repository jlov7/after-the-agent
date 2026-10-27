import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// Playwright normally disables BFCache. Exercise Chromium's real history cache.
test.use({ launchOptions: { channel: 'chromium', ignoreDefaultArgs: ['--disable-back-forward-cache'] } });

const begin = async (page: Page) => {
  await page.addInitScript(() => {
    (window as unknown as { restoredFromHistory: boolean }).restoredFromHistory = false;
    addEventListener('pageshow', event => { if (event.persisted) (window as unknown as { restoredFromHistory: boolean }).restoredFromHistory = true; });
  });
  await page.goto('./');
  await page.getByRole('button', { name: 'Take over the lights', exact: true }).click();
  await page.getByRole('button', { name: 'Begin takeover', exact: true }).click();
  await expect(page.getByLabel('Delivery guard')).toBeEnabled();
};
const save = async (page: Page, name = 'Save progress to a file') => {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name, exact: true }).click();
  return JSON.parse(await readFile((await (await pending).path())!, 'utf8')) as { session: { attempt_id: string; deadline_at_ms: number; plant_sha256: string; commands: unknown[] } };
};
const leave = async (page: Page) => {
  await page.getByRole('link', { name: 'Source', exact: true }).click();
  await expect(page).toHaveURL(/docs\/source-map.html$/);
};
const back = async (page: Page) => {
  await page.goBack({ waitUntil: 'commit' });
  await expect.poll(() => page.evaluate(() => (window as unknown as { restoredFromHistory: boolean }).restoredFromHistory)).toBe(true);
  await expect(page.getByRole('heading', { name: 'Return from browser history', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Return from browser history', exact: true })).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Return from browser history', exact: true })).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Step', exact: true })).toBeDisabled();
};
const resume = async (page: Page, id: string) => {
  await page.getByLabel('Saved attempt', { exact: true }).selectOption(id);
  await page.getByRole('button', { name: 'Resume saved attempt', exact: true }).click();
};

test('history return keeps the cached download and resumes another tab\'s latest state and original deadline', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await begin(page);
  const original = await save(page);
  await page.getByRole('link', { name: 'Source', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'evidence/ui-browser/screenshots/mobile-footer-links.png' });
  await leave(page);
  const other = await context.newPage();
  await other.goto('./'); await resume(other, original.session.attempt_id);
  await expect(other.getByLabel('Delivery guard')).toBeEnabled();
  await other.getByLabel('Delivery guard').check();
  const latest = await save(other);
  await back(page);
  const cached = await save(page, 'Save cached attempt');
  expect(cached.session.attempt_id).toBe(original.session.attempt_id);
  expect(cached.session.plant_sha256).toBe(original.session.plant_sha256);
  await page.getByRole('button', { name: 'Reload saved attempts', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume saved attempt', exact: true })).toBeVisible();
  await resume(page, original.session.attempt_id);
  await expect(page.getByLabel('Delivery guard')).toBeChecked();
  await expect(page.getByLabel('Delivery guard')).toBeDisabled();
  await page.getByRole('button', { name: 'Transfer editing here', exact: true }).click();
  await expect(page.getByLabel('Delivery guard')).toBeEnabled();
  const restored = await save(page);
  expect(restored.session.attempt_id).toBe(original.session.attempt_id);
  expect(restored.session.deadline_at_ms).toBe(original.session.deadline_at_ms);
  expect(restored.session.plant_sha256).toBe(latest.session.plant_sha256);
  await page.getByRole('button', { name: 'Step', exact: true }).click();
  await expect(page.getByText('Tick 6 / Paused', { exact: true })).toBeVisible();
  await other.close();
});

test('history return cannot revive an attempt reset by another tab', async ({ page, context }) => {
  await begin(page); const original = await save(page); await leave(page);
  const other = await context.newPage(); await other.goto('./'); await resume(other, original.session.attempt_id);
  await expect(other.getByRole('button', { name: 'New attempt', exact: true })).toBeEnabled();
  await other.getByRole('button', { name: 'New attempt', exact: true }).click();
  await expect(other.getByRole('button', { name: 'Begin takeover', exact: true })).toBeEnabled();
  await back(page);
  await page.getByRole('button', { name: 'Reload saved attempts', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume saved attempt', exact: true })).toBeVisible();
  await resume(page, original.session.attempt_id);
  await expect(page.getByText(/Cannot resume: This attempt was abandoned by reset/)).toBeVisible();
  await expect(page.getByLabel('Delivery guard')).toHaveCount(0);
  await other.close();
});

test('history return preserves a downloadable in-memory attempt when autosaving failed', async ({ page }) => {
  await begin(page); const original = await save(page);
  await page.evaluate(() => {
    localStorage.clear();
    Storage.prototype.setItem = () => { throw new DOMException('Storage full', 'QuotaExceededError'); };
  });
  await page.getByLabel('Delivery guard').check();
  await expect(page.getByText('Local resume is unavailable. You can still download this attempt.', { exact: true })).toBeVisible();
  const latest = await save(page);
  await leave(page); await back(page);
  const retained = await save(page, 'Save cached attempt');
  expect(retained.session.attempt_id).toBe(original.session.attempt_id);
  expect(retained.session.deadline_at_ms).toBe(original.session.deadline_at_ms);
  expect(retained.session.plant_sha256).toBe(latest.session.plant_sha256);
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
});
