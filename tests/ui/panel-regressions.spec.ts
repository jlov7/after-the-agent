import { openEvidenceExports } from './evidence-controls.js';
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
const begin = async (page: Page) => { await page.goto('./'); await page.getByRole('button', { name: 'Take over the lights' }).click(); await page.getByRole('button', { name: 'Begin takeover' }).click(); };

test('landing shows actual unadvanced state and the target control cannot mutate it', async ({ page }) => {
  await page.goto('./');
  const actual = page.getByRole('region', { name: 'Current installation state' });
  await expect(actual).toContainText('settled tick 0');
  for (const lamp of ['Left', 'Center', 'Right']) await expect(actual.getByLabel(`${lamp} pulse count`)).toHaveText('0');
  await page.getByRole('button', { name: 'Show next beat' }).click();
  await expect(actual).toContainText('settled tick 0');
  await page.getByRole('button', { name: 'Take over the lights' }).click();
  await expect(page.getByRole('region', { name: 'Actual setup state' })).toContainText('settled tick 0');
});

test('setup caption reports the actual world transition that leaves queued work stale', async ({ page }) => {
  await page.goto('./'); await page.getByRole('button', { name: 'Take over the lights' }).click();
  const manifest = JSON.parse(readFileSync('apps/web/public/recordings/manifest.json', 'utf8'));
  const recording = JSON.parse(readFileSync('apps/web/public/' + manifest.selected.recording.path, 'utf8'));
  // Replay every captured call. The controller fault remains a separate action.
  for (let action = 0; action < recording.commands.length; action++) await page.getByRole('button', { name: 'Replay next setup action' }).click();
  await expect(page.locator('.action-feedback')).toContainText('Scene amber, active, version 2');
  const actual = page.getByRole('region', { name: 'Actual setup state' });
  await expect(actual).toContainText('settled tick 5'); await expect(actual).toContainText('queued version 1 / current 2');
});

for (const [fault, focus] of [['stale-queue', 'version'], ['duplicate-clock', 'clocks'], ['cached-gate', 'gate']] as const) {
  test(`${fault} orientation matches the fault and retires after a diagnostic step`, async ({ page }) => {
    await begin(page);
    if (fault !== 'stale-queue') { await page.getByLabel('Try another fault').selectOption(fault); await page.getByRole('button', { name: 'New attempt', exact: true }).click(); await page.getByRole('button', { name: 'Begin takeover' }).click(); }
    await expect(page.locator('.orientation')).toContainText(focus);
    await page.getByRole('button', { name: 'Step', exact: true }).click(); await expect(page.locator('.orientation')).toHaveCount(0);
  });
}

test('new attempt removes restore notices belonging to the preceding attempt', async ({ page }) => {
  await begin(page);
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'Save progress to a file' }).click(); const file = await downloading;
  await page.getByLabel('Restore attempt').setInputFiles((await file.path())!);
  await expect(page.getByRole('status').filter({ hasText: /^Attempt restored\./ })).toBeVisible();
  await page.getByRole('button', { name: 'New attempt', exact: true }).click(); await expect(page.locator('.notice')).toHaveCount(0);
});

test('deadline closes recovery after a successful check without rewriting the checked result', async ({ page }) => {
  await page.clock.install(); await begin(page); await page.getByLabel('Delivery guard').check();
  await page.getByRole('button', { name: 'Check repair', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Repair held' })).toBeVisible();
  await page.clock.fastForward(300001);
  await expect(page.getByRole('heading', { name: 'Recovery time ended.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check repair', exact: true })).toBeDisabled(); await expect(page.getByRole('heading', { name: 'Repair held' })).toBeVisible();
  const downloading = page.waitForEvent('download'); await openEvidenceExports(page); await page.getByRole('button', { name: 'Download attempt evidence' }).click(); const file = await downloading;
  const evidence = JSON.parse(readFileSync((await file.path())!, 'utf8')); expect(evidence.terminal_reason).toBe('submitted'); expect(evidence.evaluation.status).toBe('pass');
});

test('native mobile Tab reaches settings and history navigation still permits scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await begin(page);
  await page.getByRole('button', { name: 'Check repair', exact: true }).focus(); await page.keyboard.press('Tab');
  await expect(page.getByRole('region', { name: 'Scrollable pulse counts', exact: true })).toBeFocused(); await page.keyboard.press('Tab');
  await expect(page.getByText('Pause on an event', { exact: true })).toBeFocused(); await page.keyboard.press('Tab');
  await expect(page.getByRole('checkbox', { name: 'Enable Alt + Shift + K command shortcut', exact: true })).toBeFocused(); await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Commands', exact: true })).toBeFocused(); await page.keyboard.press('Tab');
  await expect(page.getByLabel('Search history', { exact: true })).toBeFocused();
  for (const label of ['From tick', 'Through tick', 'Event type', 'Job ID', 'Request ID']) { await page.keyboard.press('Tab'); await expect(page.getByLabel(label, { exact: true })).toBeFocused(); }
  await page.keyboard.press('Tab');
  const history = page.getByRole('region', { name: 'Scrollable complete event history' });
  await expect(history).toBeFocused();
  for (const name of ['Queue', 'Clocks', 'Guard', 'Gate']) { await page.keyboard.press('Tab'); await expect(page.getByRole('navigation', { name: 'Setting groups' }).getByRole('link', { name, exact: true })).toBeFocused(); }
  await page.keyboard.press('Tab'); await expect(page.getByLabel('Select primary.4.left', { exact: true })).toBeFocused();
  for (let tick = 0; tick < 30; tick++) await page.getByRole('button', { name: 'Step', exact: true }).click();
  await page.getByRole('link', { name: 'History', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(history).toBeFocused();
  expect(await history.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab'); await expect(history).toBeFocused();
  const accessibility = await new AxeBuilder({ page }).include('#history').analyze(); expect(accessibility.violations).toEqual([]);
  await history.evaluate(element => { element.scrollTop = 0; }); await page.keyboard.press('PageDown');
  await expect.poll(() => history.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
});

test('a selected job consumed by Step cannot leave Drop selected enabled', async ({ page }) => {
  await begin(page); await page.getByLabel('Select primary.4.left', { exact: true }).check();
  await expect(page.getByRole('button', { name: 'Drop selected', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Step', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Queue (0)', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Drop selected', exact: true })).toBeDisabled();
});
