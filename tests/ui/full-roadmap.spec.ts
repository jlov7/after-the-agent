import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const begin = async (page: Page) => { await page.goto('./'); await page.getByRole('button', { name: 'Take over the lights' }).click(); await page.getByRole('button', { name: 'Begin takeover', exact: true }).click(); };
const saved = async (page: import('@playwright/test').Page) => {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save progress to a file', exact: true }).click();
  const value = JSON.parse(readFileSync((await (await pending).path())!, 'utf8')) as { session: import('../../packages/engine/src/session.js').SavedSession };
  await expect.poll(() => page.evaluate(id => localStorage.getItem(`after-the-agent.saved.v2.${id}`), value.session.attempt_id)).toBe(JSON.stringify(value.session));
  return value.session;
};


test('a selected gallery source resumes from its owner asset with the original deadline after a reload', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Open recording gallery', exact: true }).click();
  await page.getByRole('button', { name: 'Use Bundled stdio fixture', exact: true }).click();
  await expect(page.getByText('Fixture recording', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Take over the lights' }).click(); await page.getByRole('button', { name: 'Begin takeover', exact: true }).click();
  const before = await saved(page); expect(before.playback_source).not.toBeNull(); expect(before.playback_source!.recording_sha256).toMatch(/^[a-f0-9]{64}$/);
  await page.reload(); await page.getByRole('button', { name: 'Resume saved attempt', exact: true }).click();
  await expect(page.getByText('Tick 5 / Paused', { exact: true })).toBeVisible();
  const after = await saved(page); expect(after.deadline_at_ms).toBe(before.deadline_at_ms); expect(after.playback_source).toEqual(before.playback_source); expect(after.plant_sha256).toBe(before.plant_sha256); expect(after.commands).toEqual(before.commands);
});

test('a browser-exported selected counterexample reproduces through the actual CLI and independent Python', async ({ page }) => {
  await begin(page); await page.getByRole('button', { name: 'Check repair', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Repair did not hold', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Explore behavior', exact: true }).click();
  await expect(page.getByLabel('Continuation tick', { exact: true })).toBeVisible();
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download this case reproducer', exact: true }).click();
  const path = (await (await pending).path())!, input = JSON.parse(readFileSync(path, 'utf8'));
  expect(input.scope).toBe('one-case-diagnostic'); expect(input.expected_verdict).toBe('mismatch');
  const result = spawnSync(process.execPath, ['dist/packages/runner/src/reproduce-cli.js', path], { encoding: 'utf8', env: { ...process.env, UV_CACHE_DIR: resolve('work/uv-cache') }, timeout: 30000 });
  expect(result.status, result.stderr).toBe(0); const output = JSON.parse(result.stdout);
  expect(output.status).toBe('reproduced'); expect(output.repair_qualified).toBe(false); expect(output.oracle_exit_code).toBe(1);
  mkdirSync('evidence/full-roadmap', { recursive: true }); writeFileSync('evidence/full-roadmap/browser-diagnostic.json', JSON.stringify({ input, output, exit_code: result.status }, null, 2) + '\n');
});

test('notebook inspection replays the retained bytes without mutating the live attempt', async ({ page }) => {
  await page.clock.install(); await begin(page);
  await page.getByRole('button', { name: 'Open attempt notebook', exact: true }).click(); await page.getByRole('button', { name: 'Enable notebook on this browser' }).click();
  await page.getByLabel('Bookmark name').fill('Before edit'); await page.getByRole('button', { name: 'Save current attempt', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Before edit', exact: true })).toBeVisible();
  await page.getByLabel('Delivery guard', { exact: true }).check(); const before = await saved(page);
  await page.getByRole('button', { name: 'Inspect Before edit', exact: true }).click();
  const replay = page.getByRole('region', { name: 'Read-only replay', exact: true }); await expect(replay).toContainText('Command replay: verified');
  await replay.getByRole('button', { name: 'Final state', exact: true }).click(); await expect(replay).toContainText('guard off');
  await page.clock.fastForward(10000); const after = await saved(page);
  expect(after.commands).toEqual(before.commands); expect(after.plant_sha256).toBe(before.plant_sha256); expect(after.deadline_at_ms).toBe(before.deadline_at_ms);
  await replay.getByRole('button', { name: 'Close replay', exact: true }).click(); await expect(page.getByLabel('Delivery guard', { exact: true })).toBeChecked();
});

test('a failed optional tool chunk preserves board actions and saving', async ({ page }) => {
  await page.route(/\/assets\/ReplayViewer-[^/]+\.js$/, route => route.abort());
  await begin(page); const before = await saved(page);
  await page.getByRole('button', { name: 'Open replay viewer', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('This local tool could not load');
  await expect(page.getByRole('button', { name: 'Save progress to a file', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Close unavailable tool', exact: true }).click();
  await page.getByRole('button', { name: 'Step', exact: true }).click(); const after = await saved(page);
  expect(after.deadline_at_ms).toBe(before.deadline_at_ms); expect(after.commands.length).toBe(before.commands.length + 1);
});

test('new public tools are absent throughout both matched rehearsal phases', async ({ page }) => {
  await page.clock.install(); await page.goto('./'); await page.getByRole('button', { name: 'Open local rehearsal', exact: true }).click();
  const absent = async () => {
    for (const name of ['Open replay viewer', 'Open attempt notebook', 'Open recording gallery', 'Inspect capture run', 'Enable offline edition', 'Download HTML evidence report', 'Download this case reproducer']) await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Search history', { exact: true })).toHaveCount(0);
  };
  await absent(); await page.getByRole('button', { name: 'Begin synthetic rehearsal', exact: true }).click(); await page.clock.fastForward(135000);
  await expect(page.getByText('Tick 5 / Paused', { exact: true })).toBeVisible(); await absent();
});

test('a delayed recording-source restore cannot overwrite a newer attempt or its edits', async ({ page }) => {
  await page.goto('./'); await page.getByRole('button', { name: 'Open recording gallery', exact: true }).click(); await page.getByRole('button', { name: 'Use Bundled stdio fixture', exact: true }).click();
  await page.getByRole('button', { name: 'Take over the lights' }).click(); await page.getByRole('button', { name: 'Begin takeover', exact: true }).click();
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Save progress to a file', exact: true }).click(); const raw = readFileSync((await (await download).path())!, 'utf8');
  await page.reload(); await page.getByRole('button', { name: 'Take over the lights' }).click(); await page.getByRole('button', { name: 'Begin takeover', exact: true }).click();
  let release: (() => void) | undefined, requested: (() => void) | undefined;
  const gate = new Promise<void>(resolve => { release = resolve; }), seen = new Promise<void>(resolve => { requested = resolve; });
  await page.route('**/recordings/gallery.json', async route => { requested!(); await gate; await route.continue(); });
  try {
    await page.getByLabel('Restore attempt', { exact: true }).setInputFiles({ name: 'source-bound.json', mimeType: 'application/json', buffer: Buffer.from(raw) }); await seen;
    await page.getByRole('button', { name: 'New attempt', exact: true }).click(); await page.getByRole('button', { name: 'Begin takeover', exact: true }).click(); await page.getByLabel('Delivery guard', { exact: true }).check();
    const current = await saved(page); const response = page.waitForResponse('**/recordings/gallery.json'); release!(); await response;
    await expect(page.getByRole('status').filter({ hasText: /Restore superseded|Attempt restored/ })).toBeVisible();
    const after = await saved(page); expect(after.attempt_id).toBe(current.attempt_id); expect(after.commands).toEqual(current.commands); expect(after.plant_sha256).toBe(current.plant_sha256); expect(after.deadline_at_ms).toBe(current.deadline_at_ms);
    await expect(page.getByLabel('Delivery guard', { exact: true })).toBeChecked();
  } finally { release!(); }
});

test('a delayed file read cannot acquire a fresh restore token and overwrite newer work', async ({ page }) => {
  await begin(page); const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Save progress to a file', exact: true }).click(); const raw = readFileSync((await (await download).path())!, 'utf8');
  await page.evaluate(() => {
    const original = File.prototype.text;
    File.prototype.text = function () { File.prototype.text = original; return new Promise<string>(resolve => { (window as unknown as { releaseAtaFileRead: () => Promise<void> }).releaseAtaFileRead = async () => resolve(await original.call(this)); }); };
  });
  await page.getByLabel('Restore attempt', { exact: true }).setInputFiles({ name: 'old.json', mimeType: 'application/json', buffer: Buffer.from(raw) });
  await page.getByRole('button', { name: 'New attempt', exact: true }).click(); await page.getByRole('button', { name: 'Begin takeover', exact: true }).click(); await page.getByLabel('Delivery guard', { exact: true }).check(); const current = await saved(page);
  await page.evaluate(async () => (window as unknown as { releaseAtaFileRead: () => Promise<void> }).releaseAtaFileRead());
  await expect(page.getByRole('status').filter({ hasText: /Restore superseded|Attempt restored/ })).toBeVisible();
  const after = await saved(page); expect(after.attempt_id).toBe(current.attempt_id); expect(after.commands).toEqual(current.commands); expect(after.plant_sha256).toBe(current.plant_sha256); expect(after.deadline_at_ms).toBe(current.deadline_at_ms);
  await expect(page.getByLabel('Delivery guard', { exact: true })).toBeChecked();
});
