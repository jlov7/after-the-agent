import { openEvidenceExports } from './evidence-controls.js';
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { referenceDirectory } from '../../packages/runner/src/reference-files.js';

const begin = async (page: Page, fault = 'stale-queue') => {
  await page.goto('./'); await page.getByRole('button', { name: 'Take over the lights', exact: true }).click();
  await page.getByRole('button', { name: 'Begin takeover', exact: true }).click();
  if (fault !== 'stale-queue') {
    await page.getByLabel('Try another fault', { exact: true }).selectOption(fault);
    await page.getByRole('button', { name: 'New attempt', exact: true }).click();
    await page.getByRole('button', { name: 'Begin takeover', exact: true }).click();
  }
};
const save = async (page: Page) => {
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'Save progress to a file', exact: true }).click();
  return JSON.parse(readFileSync((await (await downloading).path())!, 'utf8'));
};
for (const fault of ['stale-queue', 'duplicate-clock', 'cached-gate']) test(`trace-backed explanation describes the actual ${fault} mismatch`, async ({ page }) => {
  await begin(page, fault); await page.getByRole('button', { name: 'Check repair', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Repair did not hold', exact: true })).toBeVisible();
  const explanation = page.getByLabel('Factual pulse explanation', { exact: true });
  await expect(explanation).toContainText('Facts behind this count'); await expect(explanation).toContainText('Continuation events:');
  await expect(explanation).toContainText('Jobs:');
  if (fault === 'duplicate-clock') { await expect(explanation).toContainText('primary.4.left'); await expect(explanation).toContainText('shadow.4.left'); }
});
test('edit receipt preserves queued duplicate work and live timeline exposes both pulses', async ({ page }) => {
  await begin(page, 'duplicate-clock'); await page.getByLabel('Standby clock', { exact: true }).uncheck();
  const receipt = page.getByRole('status', { name: 'Edit receipt', exact: true });
  await expect(receipt).toContainText('Edit applied'); await expect(receipt).toContainText('Tick stayed at 5');
  await expect(receipt).toContainText('primary.4.left, shadow.4.left');
  await page.getByRole('button', { name: 'Step', exact: true }).click();
  const timeline = page.getByRole('region', { name: 'Recent actual pulses', exact: true });
  await expect(timeline.locator('td[data-pulse-count="2"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Step', exact: true }).click();
  await expect(timeline.locator('td[data-pulse-count="2"]')).toHaveCount(1);
});
test('event run stops at delivery and manual Step interrupts without hiding the original deadline', async ({ page }) => {
  await page.clock.install(); await begin(page);
  await page.getByText('Pause on an event', { exact: true }).click();
  const before = await save(page);
  await page.getByRole('button', { name: 'Run until event', exact: true }).click(); await page.clock.fastForward(500);
  await expect(page.getByText('Tick 6 / Paused', { exact: true })).toBeVisible();
  await expect(page.getByText(/Event run: matched at tick 6/)).toBeVisible();
  await page.clock.fastForward(1500); await expect(page.getByText('Tick 6 / Paused', { exact: true })).toBeVisible();
  await page.getByLabel('Stop after event', { exact: true }).selectOption('scene_change');
  await page.getByRole('button', { name: 'Run until event', exact: true }).click(); await expect(page.getByText(/Event run: not scheduled at tick 6/)).toBeVisible();
  await page.getByLabel('Stop after event', { exact: true }).selectOption('delivery'); await page.getByRole('button', { name: 'Run until event', exact: true }).click();
  await page.getByRole('button', { name: 'Step', exact: true }).click(); await page.clock.fastForward(1000);
  await expect(page.getByText('Tick 7 / Paused', { exact: true })).toBeVisible();
  expect((await save(page)).session.deadline_at_ms).toBe(before.session.deadline_at_ms);
});
test('actual browser packet reproduces all checks independently and rejects a later forged verdict', async ({ page }) => {
  test.setTimeout(60000);
  await begin(page); await page.getByRole('button', { name: 'Check repair', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Repair did not hold', exact: true })).toBeVisible();
  await page.getByLabel('Delivery guard', { exact: true }).check(); await page.getByRole('button', { name: 'Check repair', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Repair held', exact: true })).toBeVisible();
  const before = await save(page), downloading = page.waitForEvent('download');
  await openEvidenceExports(page); await page.getByRole('button', { name: 'Download verification packet', exact: true }).click();
  const raw = readFileSync((await (await downloading).path())!, 'utf8');
  mkdirSync('evidence/twelve/browser', { recursive: true });
  const path = 'evidence/twelve/browser/attempt.packet.json'; writeFileSync(path, raw);
  const verified = spawnSync(process.execPath, ['dist/packages/runner/src/evidence-packet-cli.js', path], { encoding: 'utf8', env: { ...process.env, ATA_REFERENCE_DIR: referenceDirectory() }, timeout: 35000 });
  expect(verified.status, verified.stdout + verified.stderr).toBe(0);
  const result = JSON.parse(verified.stdout); expect(result.status).toBe('reproduced'); expect(result.submissions.map((item: { computed_status: string }) => item.computed_status)).toEqual(['mismatch', 'pass']);
  writeFileSync('evidence/twelve/browser/packet-verification.json', verified.stdout);
  expect((await save(page)).session.commands).toEqual(before.session.commands);
  const { createEvidencePacket } = await import('../../packages/runner/src/evidence-packet.js');
  const packet = JSON.parse(raw), attempt = JSON.parse(packet.attempt); attempt.submissions[1].evaluation.cases[11].status = 'mismatch';
  const source = packet.playback_source === null ? null : JSON.parse(packet.playback_source);
  const badPath = 'evidence/twelve/browser/forged.packet.json'; writeFileSync(badPath, createEvidencePacket(JSON.stringify(attempt), source));
  const rejected = spawnSync(process.execPath, ['dist/packages/runner/src/evidence-packet-cli.js', badPath], { encoding: 'utf8', env: { ...process.env, ATA_REFERENCE_DIR: referenceDirectory() }, timeout: 35000 });
  expect(rejected.status, rejected.stdout + rejected.stderr).toBe(2); expect(JSON.parse(rejected.stdout).issues).toContain('SUBMISSION_EVALUATION_DIFFERS');
  writeFileSync('evidence/twelve/browser/packet-tamper-rejection.json', rejected.stdout);
});
test('new workbench reflows with exact pulse counts and keyboard controls at narrow 200 percent zoom', async ({ page }) => {
  const errors: string[] = [], external: string[] = []; page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!new URL(request.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/)) external.push(request.url()); });
  await page.setViewportSize({ width: 390, height: 844 }); await begin(page, 'duplicate-clock');
  await page.getByRole('button', { name: 'Step', exact: true }).click();
  await page.getByRole('button', { name: 'Check repair', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Repair did not hold', exact: true })).toBeVisible();
  const violations = (await new AxeBuilder({ page }).analyze()).violations; expect(violations).toEqual([]);
  mkdirSync('evidence/twelve/browser', { recursive: true }); await page.screenshot({ path: 'evidence/twelve/browser/workbench-narrow.png', fullPage: true });
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.getByRole('button', { name: 'Commands', exact: true }).click(); await page.getByRole('dialog', { name: 'Commands', exact: true }).getByRole('button', { name: 'Step', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Commands', exact: true })).toBeFocused();
  await page.screenshot({ path: 'evidence/twelve/browser/workbench-zoom.png', fullPage: true });
  expect(errors).toEqual([]); expect(external).toEqual([]);
  writeFileSync('evidence/twelve/browser/workbench-checks.json', JSON.stringify({ page_errors: errors, external_requests: external, axe_violations: violations.length, narrow: [390, 844], zoom: 2, software_only: true }, null, 2));
});
test('all public additions are absent from the frozen matched rehearsal', async ({ page }) => {
  await page.clock.install(); await page.goto('./'); await page.getByRole('button', { name: 'Open local rehearsal', exact: true }).click();
  await page.getByRole('button', { name: 'Begin synthetic rehearsal', exact: true }).click(); await page.clock.fastForward(135000);
  await expect(page.getByText('Tick 5 / Paused', { exact: true })).toBeVisible();
  for (const name of ['Commands', 'Run until event', 'Download verification packet', 'Open repair laboratory', 'Browser readiness']) await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Factual pulse explanation', { exact: true })).toHaveCount(0); await expect(page.getByRole('region', { name: 'Recent actual pulses', exact: true })).toHaveCount(0);
});
