import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { compactAttemptExport, createSession, saveSession } from '../../packages/engine/src/index.js';
import { buildCorpus } from '../../packages/runner/src/continuations.js';
import { authoredRecording } from '../replay/fixture.js';
const harness = process.env.REPLAY_HARNESS === '1';
async function open(page: Page) {
  if (harness) await page.goto('/work/full-replay/harness.html');
  else { await page.goto('./'); await page.getByRole('button', { name: 'Take over the lights' }).click(); await page.getByRole('button', { name: 'Begin takeover' }).click(); await page.locator('#replay-trigger').click(); }
  await expect(page.getByRole('heading', { name: 'Read-only replay', exact: true })).toBeVisible();
}
async function upload(page: Page, raw = JSON.stringify(authoredRecording())) {
  await page.getByLabel('Replay file type').selectOption('recording');
  await page.getByLabel('Open replay file').setInputFiles({ name: 'fixture.json', mimeType: 'application/json', buffer: Buffer.from(raw) });
}

test('actual recording command navigation reconstructs board, queue, settings and original download', async ({ page }) => {
  await open(page); const raw = JSON.stringify(authoredRecording()); await upload(page, raw);
  const viewer = page.getByRole('region', { name: 'Read-only replay', exact: true });
  await expect(viewer).toContainText('Command replay: verified'); await expect(viewer).toContainText('fixture recording. No model provenance.');
  await viewer.getByRole('button', { name: 'Final state', exact: true }).click();
  await expect(viewer.getByRole('heading', { name: 'Settled tick 5', exact: true })).toBeVisible();
  await expect(viewer).toContainText('primary.4.left'); await expect(viewer).toContainText('Scene amber'); await expect(viewer).toContainText('guard off');
  await viewer.getByRole('button', { name: 'Previous command' }).click(); await expect(viewer.getByRole('heading', { name: 'Settled tick 4', exact: true })).toBeVisible();
  await viewer.getByRole('button', { name: 'Initial state', exact: true }).click(); await expect(viewer.getByRole('heading', { name: 'Settled tick 0', exact: true })).toBeVisible();
  await viewer.getByRole('button', { name: 'Final state', exact: true }).click(); await expect(viewer.getByRole('heading', { name: 'Settled tick 5', exact: true })).toBeVisible();
  const downloading = page.waitForEvent('download'); await viewer.getByRole('button', { name: 'Download inspected file' }).click(); const download = await downloading;
  expect(readFileSync((await download.path())!, 'utf8')).toBe(raw);
});

test('recording divergences show exact fields and uploads cannot self-assert live provenance', async ({ page }) => {
  await open(page);
  const recording = JSON.parse(JSON.stringify(authoredRecording())); recording.commands[1].result.revision += 1;
  await upload(page, JSON.stringify(recording));
  await expect(page.getByRole('region', { name: 'First replay divergence' })).toContainText('/commands/1/result/revision');
  await expect(page.getByRole('region', { name: 'First replay divergence' })).toContainText('Command 2');
  recording.manifest.category = 'live_model'; await upload(page, JSON.stringify(recording));
  await expect(page.getByRole('status').filter({ hasText: /Replay unavailable:/ })).toContainText('separately trusted recording commitment');
  await expect(page.getByRole('region', { name: 'Reconstructed board' })).toHaveCount(0);
});

test('replay worker stays keyboard accessible and reflows at390px and200percent zoom', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await open(page); await upload(page);
  const viewer = page.getByRole('region', { name: 'Read-only replay', exact: true }); await expect(viewer).toContainText('Command replay: verified');
  await viewer.getByRole('button', { name: 'Next command' }).focus(); await page.keyboard.press('Enter');
  await expect(viewer).toContainText('Command 1 of 3');
  expect((await new AxeBuilder({ page }).include('.replay-viewer').analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'evidence/ui-browser/screenshots/replay-mobile.png', fullPage: true });
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
  expect(await viewer.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
});

test('opening replay cannot reset the running recovery deadline or replace its board', async ({ page }) => {
  await page.clock.install(); await open(page); await upload(page);
  const viewer = page.getByRole('region', { name: 'Read-only replay', exact: true }); await expect(viewer).toContainText('Command replay: verified');
  await page.clock.fastForward(10000); await expect(viewer).toContainText('290 seconds remaining');
  await viewer.getByRole('button', { name: 'Final state', exact: true }).click(); await expect(viewer.getByRole('heading', { name: 'Settled tick 5', exact: true })).toBeVisible();
  await page.clock.fastForward(10000); await expect(viewer).toContainText('280 seconds remaining');
  if (!harness) { await viewer.getByRole('button', { name: 'Close replay' }).click(); await expect(page.getByRole('region', { name: 'Current installation state' })).toContainText('settled tick 5'); }
});

test('compact downloads above2MB and resumable envelopes retain the imported deadline', async ({ page }) => {
  const board = createSession({ scenario: 'stale-queue', now: () => 1000 }, async candidate => ({ status: 'invalid', candidate_sha256: candidate.candidate_sha256, cases: [], observations: [] }), buildCorpus);
  board.start(); board.step(); const compact = compactAttemptExport(board), saved = saveSession(board); board.dispose();
  const inputs = [JSON.stringify({ ...compact, rehearsal_evidence: { retained_note: 'x'.repeat(2100000) } }), JSON.stringify({ format: 'after-the-agent.resume', version: '1.0', session: saved, rehearsal_evidence: null })];
  await open(page);
  for (const raw of inputs) {
    await page.getByLabel('Replay file type').selectOption('attempt');
    await page.getByLabel('Open replay file').setInputFiles({ name: 'attempt.json', mimeType: 'application/json', buffer: Buffer.from(raw) });
    const viewer = page.getByRole('region', { name: 'Read-only replay', exact: true });
    await expect(viewer).toContainText('Command replay: verified'); await expect(viewer).toContainText('301000 milliseconds since Unix epoch');
    await viewer.getByRole('button', { name: 'Final state', exact: true }).click(); await expect(viewer.getByRole('heading', { name: 'Settled tick 6', exact: true })).toBeVisible();
    await expect(viewer).toContainText(compact.commands.at(-1)!.result_sha256);
  }
});
