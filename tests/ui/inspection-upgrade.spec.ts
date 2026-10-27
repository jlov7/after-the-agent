import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';

test.beforeAll(() => { mkdirSync('evidence/ui-browser/screenshots', { recursive: true }); });

const begin = async (page: Page) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Take over the lights' }).click();
  await page.getByRole('button', { name: 'Begin takeover' }).click();
};
const check = async (page: Page, repaired = false) => {
  await page.getByRole('button', { name: 'Check repair', exact: true }).click();
  await expect(page.getByRole('heading', { name: repaired ? 'Repair held' : 'Repair did not hold', exact: true })).toBeVisible();
};

test('a counterexample opens playable frozen continuation frames through the final drain', async ({ page }) => {
  await begin(page); await check(page);
  await page.getByRole('button', { name: 'Explore this continuation', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Behavior inspection', exact: true });
  await expect(panel.getByRole('heading', { name: 'Behavior inspection', exact: true })).toBeFocused();
  await expect(panel.getByLabel('Continuation tick', { exact: true })).toHaveAttribute('max', '66');
  await panel.getByRole('button', { name: 'Jump to first mismatch', exact: true }).click();
  await expect(panel.getByLabel('Selected continuation tick')).toContainText('Tick 6');
  const counts = panel.getByRole('table', { name: 'Exact pulse counts at selected tick' });
  await expect(counts.getByRole('row', { name: 'left 0 1', exact: true })).toBeVisible();
  await panel.getByLabel('Continuation tick', { exact: true }).focus(); await page.keyboard.press('End');
  await expect(panel.getByLabel('Selected continuation tick')).toContainText('Tick 71');
  await expect(panel.getByLabel('Selected continuation tick')).toContainText('Final drain');
  await expect(panel.getByRole('button', { name: 'Next tick', exact: true })).toBeDisabled();
  await panel.getByRole('button', { name: 'Previous tick', exact: true }).click();
  await expect(panel.getByLabel('Selected continuation tick')).toContainText('Tick 70');
  await panel.getByLabel('Continuation case').selectOption({ index: 1 });
  await expect(panel.getByLabel('Selected continuation tick')).toContainText('Tick 5');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const accessibility = await new AxeBuilder({ page }).include('.behavior-inspection').analyze();
  expect(accessibility.violations).toEqual([]);
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'evidence/ui-browser/screenshots/continuation-inspection.png', fullPage: true });
});

test('a queue row follows the actual recorded job to its terminal outcome', async ({ page }) => {
  await begin(page);
  await page.getByRole('button', { name: 'Follow primary.4.left', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Behavior inspection', exact: true });
  await expect(panel.getByLabel('Follow job')).toHaveValue('primary.4.left');
  await expect(panel.getByRole('status').filter({ hasText: 'No frozen checks yet.' })).toBeVisible();
  const lineage = panel.getByRole('region', { name: 'Job lineage', exact: true });
  await expect(lineage).toContainText('Outcome: pending');
  await expect(lineage).toContainText('Enqueued tick 4');
  await expect(lineage).toContainText('due tick 6');
  await page.getByRole('button', { name: 'Step', exact: true }).click();
  await expect(lineage).toContainText('Outcome: delivered');
  await expect(lineage).toContainText('left pulse delivered (primary.4.left)');
});

test('two retained frozen checks expose exact repair differences and context warnings', async ({ page }) => {
  await begin(page); await check(page);
  await page.getByRole('button', { name: 'Step', exact: true }).click();
  await page.getByLabel('Delivery guard', { exact: true }).check(); await check(page, true);
  await page.getByRole('button', { name: 'Explore behavior', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Behavior inspection', exact: true });
  await panel.getByLabel('Before frozen check').selectOption('0');
  await panel.getByLabel('After frozen check').selectOption('1');
  const comparison = panel.getByRole('region', { name: 'Frozen repair comparison', exact: true });
  await expect(comparison).toContainText('Different capture context');
  await expect(comparison).toContainText('config.epoch_guard');
  await expect(comparison).toContainText('primary.4.left');
  await expect(comparison.getByRole('table', { name: 'Continuation result comparison' }).getByRole('row')).toHaveCount(13);
});

test('debrief navigation reselects its latest frozen check after an older check was inspected', async ({ page }) => {
  await begin(page); await check(page);
  await page.getByLabel('Standby clock', { exact: true }).check(); await check(page);
  await page.getByRole('button', { name: 'Explore this continuation', exact: true }).click();
  const selected = page.getByLabel('Inspect frozen check', { exact: true });
  await expect(selected).toHaveValue('1');
  await selected.selectOption('0');
  await expect(selected).toHaveValue('0');
  await page.getByRole('button', { name: 'Explore this continuation', exact: true }).click();
  await expect(selected).toHaveValue('1');
});

test('repeated job navigation follows the requested job after a different job was selected', async ({ page }) => {
  await begin(page);
  for (let tick = 6; tick <= 8; tick++) await page.getByRole('button', { name: 'Step', exact: true }).click();
  const follow = page.getByRole('button', { name: 'Follow primary.8.right', exact: true });
  await follow.click();
  const selected = page.getByLabel('Follow job');
  await expect(selected).toHaveValue('primary.8.right');
  await selected.selectOption('primary.4.left');
  await follow.click();
  await expect(selected).toHaveValue('primary.8.right');
});
