import { openEvidenceExports } from './evidence-controls.js';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { createSession, saveSession } from '../../packages/engine/src/session.js';
import { buildCorpus } from '../../packages/runner/src/continuations.js';
import { evaluateCandidate } from '../../packages/runner/src/evaluate-browser.js';
const begin = async (page: import('@playwright/test').Page) => { await page.goto('./'); await page.getByRole('button', { name: 'Take over the lights' }).click(); await page.getByRole('button', { name: 'Begin takeover' }).click(); };
const savedAttempt = async (page: import('@playwright/test').Page) => {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save progress to a file', exact: true }).click();
  const value = JSON.parse(readFileSync((await (await pending).path())!, 'utf8')) as { session: import('../../packages/engine/src/session.js').SavedSession };
  await expect.poll(() => page.evaluate(id => localStorage.getItem(`after-the-agent.saved.v2.${id}`), value.session.attempt_id)).toBe(JSON.stringify(value.session));
  return value.session;
};
test('setup exposes actual action state separately from the four-beat target', async ({ page }) => {
  await page.goto('./'); await expect(page.getByRole('region', { name: 'Normal four-beat target' })).toBeVisible();
  await page.getByRole('button', { name: 'Take over the lights' }).click();
  await expect(page.getByRole('heading', { name: 'Alternate left and right.' })).toBeFocused();
  await page.getByRole('button', { name: 'Replay next setup action' }).click();
  await expect(page.getByRole('region', { name: 'Actual setup state' })).toContainText('Guard off · settled tick 0');
  await page.getByRole('button', { name: 'Replay next setup action' }).click();
  await expect(page.getByRole('region', { name: 'Actual setup state' })).toContainText('Guard on · settled tick 0');
  await page.getByRole('button', { name: 'Replay next setup action' }).click();
  await expect(page.getByRole('region', { name: 'Actual setup state' })).toContainText('Live · open');
  await page.getByRole('button', { name: 'Replay next setup action' }).click();
  await expect(page.getByRole('region', { name: 'Actual setup state' })).toContainText('Primary on / standby off');
  await page.getByRole('button', { name: 'Replay next setup action' }).click();
  await expect(page.getByRole('region', { name: 'Actual setup state' })).toContainText('primary.4.left');
  await expect(page.getByRole('region', { name: 'Actual setup state' })).toContainText('Due tick 6');
});
test('a frozen verdict becomes stale after settings or stepping and a new check replaces it', async ({ page }) => {
  await begin(page); await page.getByLabel('Delivery guard').check(); await page.getByRole('button', { name: 'Check repair', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Repair held' })).toBeFocused();
  const debrief = page.getByRole('region', { name: 'Repair check' });
  await expect(debrief).toContainText('Checked tick 5'); await page.getByLabel('Delivery guard').uncheck();
  await expect(debrief).toContainText('Board changed since this check'); await expect(debrief).toContainText('Current tick 5');
  await page.getByRole('button', { name: 'Step', exact: true }).click(); await expect(debrief).toContainText('Current tick 6');
  await page.getByRole('button', { name: 'Check repair', exact: true }).click(); await expect(debrief).toContainText('Checked tick 6');
  await expect(debrief.getByText('Board changed since this check')).toHaveCount(0);
});
test('failure exposes the exact first tick and lamp with expected and observed multiplicities', async ({ page }) => {
  await begin(page); await page.getByRole('button', { name: 'Check repair', exact: true }).click();
  const mismatch = page.getByRole('region', { name: 'First counterexample' });
  await expect(mismatch).toContainText('Tick 6'); await expect(mismatch).toContainText('Left');
  await expect(mismatch).toContainText('Expected 0'); await expect(mismatch).toContainText('Observed 1');
  await expect(mismatch).toContainText('quiet-prefix');
});
test('choosing another fault preserves the current attempt until New attempt', async ({ page }) => {
  await begin(page); await page.getByLabel('Try another fault').selectOption('duplicate-clock');
  await expect(page.getByText('Tick 5 / Paused', { exact: true })).toBeVisible();
  await expect(page.getByText('shadow.4.left', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'New attempt', exact: true }).click(); await page.getByRole('button', { name: 'Begin takeover' }).click();
  await expect(page.getByText('shadow.4.left', { exact: true })).toBeVisible();
});
test('countdown does not write saved state, while accepted actions and visibility do', async ({ page }) => {
  await page.addInitScript(() => { const original = Storage.prototype.setItem; (window as unknown as { writes: number }).writes = 0; Storage.prototype.setItem = function(key, value) { if (key.startsWith('after-the-agent.saved.v2.')) (window as unknown as { writes: number }).writes++; original.call(this, key, value); }; });
  await page.clock.install(); await begin(page); await savedAttempt(page);
  const writes = await page.evaluate(() => (window as unknown as { writes: number }).writes);
  await page.clock.fastForward(4000); expect(await page.evaluate(() => (window as unknown as { writes: number }).writes)).toBe(writes);
  await page.getByLabel('Delivery guard').check(); await expect.poll(() => page.evaluate(() => (window as unknown as { writes: number }).writes)).toBeGreaterThan(writes);
  const after = await page.evaluate(() => (window as unknown as { writes: number }).writes);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect.poll(() => page.evaluate(() => (window as unknown as { writes: number }).writes)).toBeGreaterThan(after);
});
test('resumable files replay validated commands and preserve the original deadline', async ({ page }) => {
  await page.clock.install(); await begin(page); await page.getByLabel('Delivery guard').check();
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'Save progress to a file' }).click(); const downloaded = await downloading;
  await page.clock.fastForward(200000); await page.reload();
  await page.getByLabel('Restore attempt').setInputFiles((await downloaded.path())!);
  await expect(page.getByLabel('Delivery guard')).toBeChecked(); await expect(page.getByLabel('Recovery time remaining')).toHaveText('01:40');
  await page.clock.fastForward(100001); await expect(page.getByRole('heading', { name: 'Recovery time ended.' })).toBeVisible();
});
test('attempt restore rejects evidence-only exports and forged wrappers without replacing the board', async ({ page }) => {
  await begin(page);
  for (const value of [{ schema_version: '1.2', commands: [] }, { format: 'after-the-agent.resume', version: '1.0', session: {}, rehearsal_evidence: null, extra: true }]) {
    await page.getByLabel('Restore attempt').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
    await expect(page.getByRole('status').filter({ hasText: /^Attempt rejected:/ })).toBeVisible(); await expect(page.getByText('Tick 5 / Paused', { exact: true })).toBeVisible();
  }
});
test('reset autosave cannot resume the abandoned successful candidate before new setup begins', async ({ page }) => {
  await begin(page); await page.getByLabel('Delivery guard').check(); await page.getByRole('button', { name: 'Check repair', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Repair held' })).toBeVisible();
  const original = (await savedAttempt(page)).attempt_id;
  await page.getByRole('button', { name: 'New attempt', exact: true }).click();
  await expect.poll(() => page.evaluate(original => Object.keys(localStorage).filter(key => key.startsWith('after-the-agent.saved.v2.') && key !== `after-the-agent.saved.v2.${original}`).length, original)).toBe(1);
  const saved = await page.evaluate(original => { const key = Object.keys(localStorage).find(key => key.startsWith('after-the-agent.saved.v2.') && key !== `after-the-agent.saved.v2.${original}`)!; return JSON.parse(localStorage.getItem(key)!); }, original);
  expect(await page.evaluate(id => localStorage.getItem(`after-the-agent.saved.v2.${id}`) !== null, original)).toBe(true);
  expect(saved.attempt_id).not.toBe(original); expect(saved.phase).toBe('setup'); expect(saved.submissions).toEqual([]);
  expect(saved.previous_attempts).toContainEqual({ attempt_id: original, disposition: 'abandoned_reset' });
  await page.reload(); await page.getByLabel('Saved attempt', { exact: true }).selectOption(saved.attempt_id); await page.getByRole('button', { name: 'Resume saved attempt' }).click();
  await expect(page.getByRole('heading', { name: 'Alternate left and right.' })).toBeVisible(); await expect(page.getByRole('heading', { name: 'Repair held' })).toHaveCount(0);
});
test('synthetic receipt is inspectable, exported and restored through its resumable wrapper', async ({ page }) => {
  await page.clock.install(); await page.goto('./'); await page.getByRole('button', { name: 'Open local rehearsal' }).click(); await page.getByRole('button', { name: 'Begin synthetic rehearsal' }).click();
  await page.clock.fastForward(135000); await expect(page.getByText('Tick 5 / Paused', { exact: true })).toBeVisible();
  await expect(page.locator('.orientation')).toHaveCount(0); await openEvidenceExports(page); await page.getByRole('button', { name: 'Inspect this run' }).click();
  const receipt = page.getByRole('region', { name: 'Synthetic exposure receipt' });
  const actualTimings = await page.evaluate(() => JSON.parse(localStorage.getItem('after-the-agent.rehearsal-evidence.v1')!).timings.map((timing: {actual_elapsed_ms: number}) => timing.actual_elapsed_ms).join(', ') + ' ms');
  await expect(receipt).toContainText('observation · synthetic · research ineligible'); await expect(receipt).toContainText(actualTimings);
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'Save progress to a file' }).click(); const file = await downloading;
  await page.clock.fastForward(20000); await page.reload(); await page.getByLabel('Restore attempt').setInputFiles((await file.path())!);
  await expect(page.getByLabel('Recovery time remaining')).toHaveText('04:40'); await openEvidenceExports(page); await page.getByRole('button', { name: 'Inspect this run' }).click(); await expect(receipt).toContainText(actualTimings);
  await page.reload(); await page.getByRole('button', { name: 'Resume saved attempt' }).click(); await openEvidenceExports(page); await page.getByRole('button', { name: 'Inspect this run' }).click(); await expect(receipt).toContainText(actualTimings);
});
test('keyboard navigation reaches controls and result on narrow reflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: 'reduce' }); await begin(page);
  await page.getByRole('link', { name: 'Settings', exact: true }).focus(); await page.keyboard.press('Enter'); await expect(page.getByRole('heading', { name: 'Instrument inspector' })).toBeFocused();
  await page.getByLabel('Delivery guard').focus(); await page.keyboard.press('Space'); await page.getByRole('button', { name: 'Check repair', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Repair held' })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const result = await new AxeBuilder({ page }).analyze(); expect(result.violations).toEqual([]);
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('recording inspection runs in a bounded cancellable worker and reports worker failure', async ({ page }) => {
  await page.route(/inspection\.worker.*\.js/, route => route.abort()); await page.goto('./');
  await page.getByLabel('Import recording').setInputFiles({ name: 'recording.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
  await expect(page.getByRole('status').filter({ hasText: /^Recording rejected:/ })).toContainText('worker');
  await expect(page.getByText('Recorded agent run', { exact: true })).toBeVisible();
});
test('an open evidence panel tracks actual exported terminal state at the deadline', async ({ page }) => {
  await page.clock.install(); await begin(page); await openEvidenceExports(page); await page.getByRole('button', { name: 'Inspect this run' }).click();
  const panel = page.getByRole('region', { name: 'Actual attempt evidence' }); await expect(panel).toContainText('public / recovery');
  await page.clock.fastForward(300001); await expect(page.getByRole('heading', { name: 'Recovery time ended.' })).toBeVisible();
  const downloading = page.waitForEvent('download'); await openEvidenceExports(page); await page.getByRole('button', { name: 'Download attempt evidence' }).click(); const file = await downloading;
  const actual = JSON.parse(readFileSync((await file.path())!, 'utf8')); expect(actual.terminal_reason).toBe('timed_out');
  await expect(panel).toContainText(`public / ${actual.terminal_reason}`);
});
test('rehearsal countdown persists no unchanged exposure and a reveal persists its actual evidence', async ({ page }) => {
  await page.addInitScript(() => { const original = Storage.prototype.setItem; (window as unknown as { writes: number }).writes = 0; Storage.prototype.setItem = function(key, value) { if (key === 'after-the-agent.rehearsal.v1') (window as unknown as { writes: number }).writes++; original.call(this, key, value); }; });
  await page.clock.install(); await page.goto('./'); await page.getByRole('button', { name: 'Open local rehearsal' }).click(); await page.getByRole('button', { name: 'Begin synthetic rehearsal' }).click();
  const writes = await page.evaluate(() => (window as unknown as { writes: number }).writes);
  await page.clock.fastForward(5000); expect(await page.evaluate(() => (window as unknown as { writes: number }).writes)).toBe(writes);
  await page.clock.fastForward(20000); await expect(page.getByRole('heading', { name: /^Executed:/ })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { writes: number }).writes)).toBeGreaterThan(writes);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('after-the-agent.rehearsal.v1')!)); expect(saved.revealed).toBe(1); expect(saved.session.commands).toHaveLength(1);
});

test('large valid autosaves resume and compact downloads restore while recording imports keep their own bound', async ({ page }) => {
  test.setTimeout(60000);
  const evaluate = async (...args: Parameters<typeof evaluateCandidate>) => evaluateCandidate(...args);
  const session = createSession({ scenario: 'stale-queue', now: () => 1000 }, evaluate, buildCorpus);
  let saved: string;
  try {
    session.start(); session.act({ type: 'set_epoch_guard', enabled: true });
    for (let check = 0; check < 128; check++) expect((await session.submit()).status).toBe('pass');
    saved = JSON.stringify(saveSession(session)); expect(Buffer.byteLength(saved)).toBeGreaterThan(2_000_000);
  } finally { session.dispose(); }
  await page.clock.install({ time: new Date(0) }); await page.clock.pauseAt(new Date(1000));
  await page.addInitScript(raw => localStorage.setItem('after-the-agent.saved.v1', raw), saved);
  await page.goto('./'); await page.getByRole('button', { name: 'Resume saved attempt' }).click();
  await expect(page.getByRole('heading', { name: 'Repair held' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check repair', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => localStorage.getItem('after-the-agent.saved.v1'))).toBe(saved);
  const migrated = await savedAttempt(page); expect(migrated.attempt_id).toBe(JSON.parse(saved).attempt_id); expect(Buffer.byteLength(JSON.stringify(migrated))).toBeGreaterThan(2_000_000);
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'Save progress to a file' }).click(); const file = await downloading;
  const raw = readFileSync((await file.path())!, 'utf8');
  expect(Buffer.byteLength(raw)).toBeGreaterThan(2_000_000); expect(raw).toBe(JSON.stringify(JSON.parse(raw)));
  await page.clock.fastForward(23000); await page.getByLabel('Restore attempt').setInputFiles((await file.path())!);
  await expect(page.getByRole('status').filter({ hasText: /^Attempt restored\./ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check repair', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Delivery guard')).toBeChecked(); await expect(page.getByLabel('Recovery time remaining')).toHaveText('04:37');
  await page.getByLabel('Import recording').setInputFiles((await file.path())!);
  await expect(page.getByRole('status').filter({ hasText: /^Recording rejected:/ })).toContainText('exceeds 2 MB');
});
