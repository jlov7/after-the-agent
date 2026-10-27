import { test, expect, type Page } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
const section = (page: Page) => page.getByRole('region', { name: 'Offline edition', exact: true });
async function enable(page: Page) {
  await page.goto('./'); await section(page).getByRole('button', { name: 'Enable offline edition', exact: true }).click();
  await expect(section(page).getByRole('status')).toContainText('Offline edition ready');
}
async function download(page: Page, name: string) {
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name, exact: true }).click();
  return readFile((await (await pending).path())!, 'utf8');
}
test('offline installation waits for selected source and editing ownership before accepting its first click', async ({ page }) => {
  let release!: () => void, intercepted!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; }), requested = new Promise<void>(resolve => { intercepted = resolve; });
  await page.route('**/recordings/curated/*-qualification.json', async route => { intercepted(); await held; await route.continue(); });
  try {
    await page.goto('./'); await requested;
    await expect.poll(() => page.evaluate(async () => (await navigator.locks.query()).held?.some(lock => lock.name?.startsWith('after-the-agent.edit.')) ?? false)).toBe(true);
    const enable = section(page).getByRole('button', { name: 'Enable offline edition', exact: true });
    await expect(page.getByRole('button', { name: 'Take over the lights', exact: true })).toBeDisabled();
    await expect(enable).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Open local rehearsal', exact: true })).toBeDisabled();
    release(); await expect(page.getByRole('button', { name: 'Take over the lights', exact: true })).toBeEnabled();
    await expect(enable).toBeEnabled(); await enable.click();
    await expect(section(page).getByRole('status')).toContainText('Offline edition ready');
  } finally { release(); }
});
test('explicit offline repair restores an evicted cache and preserves autosave and notebook bytes', async ({ page, context, browserName }) => {
  await enable(page);
  await page.getByRole('button', { name: 'Take over the lights', exact: true }).click();
  await page.getByRole('button', { name: 'Begin takeover', exact: true }).click();
  await page.getByLabel('Delivery guard').check(); const saved = JSON.parse(await download(page, 'Save progress to a file'));
  await page.getByRole('button', { name: 'Open attempt notebook', exact: true }).click();
  await page.getByRole('button', { name: 'Enable notebook on this browser', exact: true }).click();
  await page.getByLabel('Bookmark name').fill('Retain across cache repair');
  await page.getByRole('button', { name: 'Save current attempt', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Retain across cache repair', exact: true })).toBeVisible();
  const backup = await download(page, 'Download notebook backup');
  const storage = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)])));
  await page.reload(); await expect(page.getByRole('button', { name: 'Take over the lights', exact: true })).toBeEnabled();
  await page.evaluate(async () => { for (const name of await caches.keys()) if (name.startsWith('after-the-agent:')) await caches.delete(name); });
  await section(page).getByRole('button', { name: 'Check saved offline files', exact: true }).click();
  await expect(section(page).getByRole('status')).toContainText('Offline files are incomplete');
  await section(page).getByRole('button', { name: 'Repair saved offline files', exact: true }).click();
  await expect(section(page).getByRole('status')).toContainText('Offline repair complete');
  expect(await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)])))).toEqual(storage);
  await page.getByRole('button', { name: 'Open attempt notebook', exact: true }).click();
  const restored = await download(page, 'Download notebook backup'); expect(JSON.parse(restored).entries).toEqual(JSON.parse(backup).entries);
  await page.getByRole('button', { name: 'Close notebook', exact: true }).click();
  await context.setOffline(true); await page.reload(); await page.getByLabel('Saved attempt', { exact: true }).selectOption(saved.session.attempt_id);
  await page.getByRole('button', { name: 'Resume saved attempt', exact: true }).click();
  await expect(page.getByLabel('Delivery guard')).toBeChecked();
  const resumed = JSON.parse(await download(page, 'Save progress to a file')); expect(resumed.session.deadline_at_ms).toBe(saved.session.deadline_at_ms);
  await expect(section(page).getByRole('button', { name: 'Repair saved offline files', exact: true })).toBeDisabled();
  await mkdir(`evidence/v1/browser/${browserName}`, { recursive: true });
  await page.screenshot({ path: `evidence/v1/browser/${browserName}/offline-repair.png`, fullPage: true });
  await writeFile(`evidence/v1/browser/${browserName}/offline-repair.json`, JSON.stringify({ cache_repaired: true, autosaves_unchanged: true, notebook_entries_unchanged: true, offline_resume: true, original_deadline_preserved: true, browser: browserName }) + '\n');
});
