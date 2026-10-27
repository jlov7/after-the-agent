import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { SavedSession } from '../../packages/engine/src/session.js';

async function start(page: Page) {
  await page.goto('./');
  await page.getByRole('button', { name: 'Take over the lights', exact: true }).click();
  await page.getByRole('button', { name: 'Begin takeover', exact: true }).click();
  await expect(page.getByLabel('Delivery guard')).toBeEnabled();
}
async function download(page: Page, name = 'Save progress to a file') {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name, exact: true }).click();
  const raw = await readFile((await (await pending).path())!, 'utf8');
  return { raw, session: (JSON.parse(raw) as { session: SavedSession }).session };
}
async function restore(page: Page, raw: string) {
  await page.getByLabel('Restore attempt', { exact: true }).setInputFiles({ name: 'earlier.json', mimeType: 'application/json', buffer: Buffer.from(raw) });
}
async function retained(page: Page, id: string) {
  return page.evaluate(id => JSON.parse(localStorage.getItem(`after-the-agent.saved.v2.${id}`)!), id);
}

test('notebook restoration waits for source initialization and can be retried without losing the bookmark', async ({ page }) => {
  let release!: () => void, intercepted!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; }), requested = new Promise<void>(resolve => { intercepted = resolve; });
  await page.route('**/recordings/curated/*-qualification.json', async route => { intercepted(); await held; await route.continue(); });
  try {
    await page.goto('./'); await requested;
    await expect.poll(() => page.evaluate(async () => (await navigator.locks.query()).held?.some(lock => lock.name?.startsWith('after-the-agent.edit.')) ?? false)).toBe(true);
    await page.getByRole('button', { name: 'Open attempt notebook', exact: true }).click();
    await page.getByRole('button', { name: 'Enable notebook on this browser', exact: true }).click();
    await page.getByLabel('Bookmark name').fill('Loading bookmark');
    await page.getByRole('button', { name: 'Save current attempt', exact: true }).click();
    const bookmark = await download(page, 'Export Loading bookmark');
    await page.getByRole('button', { name: 'Restore Loading bookmark', exact: true }).click();
    await expect(page.locator('.attempt-notebook').getByRole('alert')).toContainText('Wait for local playback assets to finish loading');
    expect((await download(page, 'Export Loading bookmark')).raw).toBe(bookmark.raw);
    release(); await expect(page.getByRole('button', { name: 'Take over the lights', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Open attempt notebook', exact: true }).click();
    expect((await download(page, 'Export Loading bookmark')).raw).toBe(bookmark.raw);
    await page.getByRole('button', { name: 'Restore Loading bookmark', exact: true }).click();
    await page.getByRole('button', { name: 'Begin takeover', exact: true }).click();
    expect((await download(page)).session.attempt_id).toBe(bookmark.session.attempt_id);
  } finally { release(); }
});

test('a valid pre-takeover bookmark cannot renew the same expired attempt', async ({ page }) => {
  await page.clock.install(); await page.goto('./');
  await page.getByRole('button', { name: 'Open attempt notebook', exact: true }).click();
  await page.getByRole('button', { name: 'Enable notebook on this browser', exact: true }).click();
  await page.getByLabel('Bookmark name').fill('Before takeover');
  await page.getByRole('button', { name: 'Save current attempt', exact: true }).click();
  const before = await download(page, 'Export Before takeover');
  expect(before.session.phase).toBe('setup');
  await page.getByRole('button', { name: 'Close notebook', exact: true }).click();
  await page.getByRole('button', { name: 'Take over the lights', exact: true }).click();
  await page.getByRole('button', { name: 'Begin takeover', exact: true }).click();
  const original = await download(page);
  expect(original.session.attempt_id).toBe(before.session.attempt_id);
  await page.clock.fastForward(300001);
  await expect(page.getByRole('heading', { name: 'Recovery time ended.', exact: true })).toBeVisible();
  await expect.poll(async () => (await retained(page, original.session.attempt_id)).phase).toBe('timed_out');
  await restore(page, before.raw);
  // Old code accepts this real file and offers a second five-minute recovery.
  await expect(page.getByText(/Attempt (restored|rejected):?/)).toBeVisible();
  const begin = page.getByRole('button', { name: 'Begin takeover', exact: true });
  if (await begin.count()) await begin.click();
  const after = await download(page);
  expect(after.session.deadline_at_ms).toBe(original.session.deadline_at_ms);
  expect(after.session.phase).toBe('timed_out');
  await expect(page.getByText(/Attempt rejected:.*older|Attempt rejected:.*stale/)).toBeVisible();
});

test('an older valid recovery file cannot discard a newer accepted edit or check', async ({ page }) => {
  await start(page); const earlier = await download(page);
  await page.getByLabel('Delivery guard').check();
  await page.getByRole('button', { name: 'Check repair', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Repair held', exact: true })).toBeVisible();
  const latest = await download(page);
  await expect.poll(async () => (await retained(page, latest.session.attempt_id)).submissions.length).toBe(1);
  await restore(page, earlier.raw);
  await expect(page.getByText(/Attempt (restored|rejected):?/)).toBeVisible();
  expect((await download(page)).session.commands).toEqual(latest.session.commands);
  await expect(page.getByLabel('Delivery guard')).toBeChecked();
  expect((await retained(page, latest.session.attempt_id)).submissions).toEqual(latest.session.submissions);
});

test('the latest completed check resumes with its deadline and is recomputed', async ({ page }) => {
  await start(page); await page.getByLabel('Delivery guard').check();
  await page.getByRole('button', { name: 'Check repair', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Repair held', exact: true })).toBeVisible();
  const latest = await download(page); await restore(page, latest.raw);
  await expect(page.getByText('Attempt restored. Commands were validated and replayed. The original deadline still applies.', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Repair held', exact: true })).toBeVisible();
  const resumed = await download(page);
  expect(resumed.session.deadline_at_ms).toBe(latest.session.deadline_at_ms);
  expect(resumed.session.submissions).toEqual(latest.session.submissions);
  await expect(page.getByLabel('Delivery guard')).toBeEnabled();
});

test('a restore that becomes stale before its editing lock arrives remains read-only', async ({ page, context }) => {
  await start(page); const earlier = await download(page);
  const other = await context.newPage(); await other.goto('./');
  await other.evaluate(id => {
    const original = navigator.locks.request.bind(navigator.locks), state = { blocked: false, release: () => {} };
    (window as unknown as { freshnessGate: typeof state }).freshnessGate = state;
    navigator.locks.request = ((name: string, options: LockOptions, callback: LockGrantedCallback<unknown>) => {
      if (name !== `after-the-agent.edit.${id}` || state.blocked) return original(name, options, callback);
      state.blocked = true;
      return new Promise<void>(resolve => { state.release = resolve; }).then(() => original(name, options, callback));
    }) as typeof navigator.locks.request;
  }, earlier.session.attempt_id);
  await restore(other, earlier.raw);
  await expect.poll(() => other.evaluate(() => (window as unknown as { freshnessGate: { blocked: boolean } }).freshnessGate.blocked)).toBe(true);
  await page.getByLabel('Delivery guard').check();
  await expect.poll(async () => (await retained(page, earlier.session.attempt_id)).commands.length).toBe(earlier.session.commands.length + 1);
  const latest = await retained(page, earlier.session.attempt_id); await page.close();
  // WebKit may finish releasing a closed page's browser locks asynchronously.
  await expect.poll(() => other.evaluate(id => navigator.locks.request(`after-the-agent.edit.${id}`, { ifAvailable: true }, lock => lock !== null), earlier.session.attempt_id)).toBe(true);
  await other.evaluate(() => (window as unknown as { freshnessGate: { release: () => void } }).freshnessGate.release());
  await expect(other.getByRole('status', { name: 'Editing ownership' })).toContainText('Editing blocked: This saved copy is older');
  await expect(other.getByLabel('Delivery guard')).toBeDisabled();
  expect((await retained(other, earlier.session.attempt_id)).commands).toEqual(latest.commands);
  await other.close();
});
