import { openEvidenceExports } from './evidence-controls.js';
import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const begin = async (page: Page) => { await page.goto('./'); await page.getByRole('button', { name: 'Take over the lights', exact: true }).click(); await page.getByRole('button', { name: 'Begin takeover', exact: true }).click(); await expect(page.getByLabel('Delivery guard')).toBeEnabled(); };
const slots = (page: Page) => page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('after-the-agent.saved.v2.')).map(key => ({ key, value: JSON.parse(localStorage.getItem(key)!) as { attempt_id: string; deadline_at_ms: number } })));

test('command dialog steps the actual board and restores trigger focus', async ({ page }) => {
  await begin(page); await page.getByRole('button', { name: 'Commands', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Commands', exact: true });
  await expect(dialog.getByRole('button', { name: 'Step', exact: true })).toBeEnabled(); await dialog.getByRole('button', { name: 'Step', exact: true }).click();
  await expect(page.getByText('Tick 6 / Paused', { exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: 'Commands', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Commands', exact: true }).click(); await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible(); await expect(page.getByRole('button', { name: 'Commands', exact: true })).toBeFocused();
  await page.getByTestId('recovery-toolbar').screenshot({ path: 'evidence/twelve/reliability/integrated/commands.png' });
});

test('distinct live attempts keep separate autosaves in the same browser', async ({ page, context }) => {
  await begin(page); await expect.poll(async () => (await slots(page)).length).toBe(1); const first = (await slots(page))[0]!;
  const other = await context.newPage(); await begin(other); await expect.poll(async () => (await slots(page)).length).toBe(2);
  const retained = await slots(page); expect(retained.find(item => item.key === first.key)?.value.deadline_at_ms).toBe(first.value.deadline_at_ms);
  expect(new Set(retained.map(item => item.value.attempt_id)).size).toBe(2); await other.close();
});

test('transfer flushes an accepted edit behind a delayed autosave and retains the original deadline', async ({ page, context }) => {
  await begin(page); await expect.poll(async () => (await slots(page)).length).toBe(1); const original = (await slots(page))[0]!.value;
  const other = await context.newPage(); await other.goto('./'); await other.getByLabel('Saved attempt', { exact: true }).selectOption(original.attempt_id); await other.getByRole('button', { name: 'Resume saved attempt', exact: true }).click();
  await expect(other.getByLabel('Delivery guard')).toBeDisabled();
  await page.evaluate(() => new Promise<void>(ready => { void navigator.locks.request('after-the-agent.autosave.v2', () => new Promise<void>(release => { (window as unknown as { releaseAutosave: () => void }).releaseAutosave = release; ready(); })); }));
  await page.getByLabel('Delivery guard').check(); await other.getByRole('button', { name: 'Transfer editing here', exact: true }).click(); await expect(page.getByLabel('Delivery guard')).toBeDisabled();
  await page.evaluate(() => (window as unknown as { releaseAutosave: () => void }).releaseAutosave());
  await expect(other.getByLabel('Delivery guard')).toBeEnabled(); await expect(other.getByLabel('Delivery guard')).toBeChecked();
  const downloading = other.waitForEvent('download'); await other.getByRole('button', { name: 'Save progress to a file', exact: true }).click(); const file = await downloading;
  const restored = JSON.parse(await readFile((await file.path())!, 'utf8')) as { session: { deadline_at_ms: number; attempt_id: string } };
  expect(restored.session.attempt_id).toBe(original.attempt_id); expect(restored.session.deadline_at_ms).toBe(original.deadline_at_ms); await other.close();
});

test('optional browser checks clean disposable resources and export statuses without browser or attempt data', async ({ page }) => {
  await page.goto('./'); await page.getByRole('button', { name: 'Browser readiness', exact: true }).click(); const section = page.locator('.browser-readiness'); await section.getByRole('button', { name: 'Check browser readiness', exact: true }).click();
  await expect(section.getByRole('status')).toContainText('Checks finished');
  await expect(section).toContainText('Disposable database written, read and deleted.');
  expect(await page.evaluate(async () => ({ keys: Object.keys(localStorage).filter(key => key.startsWith('after-the-agent.readiness.')), databases: (await indexedDB.databases()).filter(item => item.name?.startsWith('after-the-agent.readiness.')) }))).toEqual({ keys: [], databases: [] });
  const downloading = page.waitForEvent('download'); await section.getByRole('button', { name: 'Download browser diagnostic', exact: true }).click(); const raw = await readFile((await (await downloading).path())!, 'utf8');
  const diagnostic = JSON.parse(raw) as { format: string; version: string; checks: Record<string, { state: string }> };
  expect(Object.keys(diagnostic).sort()).toEqual(['checks', 'format', 'version']); expect(Object.keys(diagnostic.checks).sort()).toEqual(['indexedDB', 'localStorage', 'serviceWorker', 'worker']);
  for (const value of Object.values(diagnostic.checks)) expect(Object.keys(value)).toEqual(['state']);
  expect(raw).not.toMatch(/https?:|userAgent|attempt_id|\/Users\//);
  await section.screenshot({ path: 'evidence/twelve/reliability/integrated/readiness.png' });
});


test('reset leaves earlier evidence saved but refuses to resume that abandoned attempt', async ({ page }) => {
  await begin(page); await expect.poll(async () => (await slots(page)).length).toBe(1); const original = (await slots(page))[0]!.value;
  await page.getByRole('button', { name: 'New attempt', exact: true }).click(); await page.getByRole('button', { name: 'Begin takeover', exact: true }).click();
  await expect.poll(async () => (await slots(page)).length).toBe(2); await page.reload();
  await page.getByLabel('Saved attempt', { exact: true }).selectOption(original.attempt_id); await page.getByRole('button', { name: 'Resume saved attempt', exact: true }).click();
  await expect(page.getByText(/Cannot resume: This attempt was abandoned by reset/)).toBeVisible();
  expect((await slots(page)).some(item => item.value.attempt_id === original.attempt_id)).toBe(true);
});

test('failed transfer cannot reactivate an attempt abandoned by its previous owner', async ({ page, context }) => {
  await begin(page); await expect.poll(async () => (await slots(page)).length).toBe(1); const original = (await slots(page))[0]!.value;
  const other = await context.newPage(); await other.goto('./'); await other.getByLabel('Saved attempt', { exact: true }).selectOption(original.attempt_id); await other.getByRole('button', { name: 'Resume saved attempt', exact: true }).click();
  await expect(other.getByLabel('Delivery guard')).toBeDisabled();
  await page.getByRole('button', { name: 'New attempt', exact: true }).click(); await expect(page.getByRole('button', { name: 'Begin takeover', exact: true })).toBeEnabled();
  await other.getByRole('button', { name: 'Transfer editing here', exact: true }).click();
  await expect(other.getByText(/Editing transfer incomplete: This attempt was abandoned by reset/)).toBeVisible();
  await expect(other.getByLabel('Delivery guard')).toBeDisabled(); await expect(other.getByRole('button', { name: 'Step', exact: true })).toBeDisabled();
  expect(await other.evaluate(async id => (await navigator.locks.query()).held?.some(lock => lock.name === `after-the-agent.edit.${id}`), original.attempt_id)).toBe(false);
  await other.close();
});

test('restarting a recorded attempt retains only the playback source bound by the new session', async ({ page }) => {
  await page.goto('./'); await page.getByRole('button', { name: 'Open recording gallery', exact: true }).click(); await page.getByRole('button', { name: 'Use Bundled stdio fixture', exact: true }).click();
  await page.getByRole('button', { name: 'Take over the lights', exact: true }).click(); await page.getByRole('button', { name: 'Begin takeover', exact: true }).click();
  await page.getByRole('button', { name: 'New attempt', exact: true }).click(); await page.getByRole('button', { name: 'Begin takeover', exact: true }).click();
  const packet = async () => { const downloading = page.waitForEvent('download'); await openEvidenceExports(page); await page.getByRole('button', { name: 'Download verification packet', exact: true }).click(); return JSON.parse(await readFile((await (await downloading).path())!, 'utf8')); };
  const retained = await packet(); expect(JSON.parse(retained.attempt).playback_source).not.toBeNull(); expect(retained.playback_source).not.toBeNull();
  expect(JSON.parse(retained.playback_source).recording_sha256).toBe(JSON.parse(retained.attempt).playback_source.recording_sha256);
  await page.getByLabel('Try another fault', { exact: true }).selectOption('duplicate-clock'); await page.getByRole('button', { name: 'New attempt', exact: true }).click(); await page.getByRole('button', { name: 'Begin takeover', exact: true }).click();
  const cleared = await packet(); expect(JSON.parse(cleared.attempt).playback_source).toBeNull(); expect(cleared.playback_source).toBeNull();
});
