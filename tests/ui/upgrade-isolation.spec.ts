import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const begin = async (page: import('@playwright/test').Page) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Take over the lights' }).click();
  await page.getByRole('button', { name: 'Begin takeover' }).click();
};
const save = async (page: import('@playwright/test').Page) => {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save progress to a file', exact: true }).click();
  const file = await pending;
  return JSON.parse(readFileSync((await file.path())!, 'utf8'));
};
const inspect = async (page: import('@playwright/test').Page) => {
  await page.getByRole('button', { name: 'Check repair', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Repair did not hold', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Explore behavior', exact: true }).click();
  await expect(page.getByLabel('Continuation tick', { exact: true })).toBeVisible();
};

test('scrubbing a frozen continuation leaves the live commands, plant and original deadline unchanged', async ({ page }) => {
  await begin(page);
  await inspect(page);
  const before = await save(page);
  await page.getByLabel('Continuation tick', { exact: true }).focus();
  await page.keyboard.press('End');
  await page.getByRole('button', { name: 'Previous tick', exact: true }).click();
  await page.getByRole('button', { name: 'Jump to first mismatch', exact: true }).click();
  await page.getByLabel('Continuation case', { exact: true }).selectOption({ index: 1 });
  await expect(page.getByLabel('Selected continuation tick')).toContainText('Tick 5');
  const after = await save(page);
  expect(after.session.plant_sha256).toBe(before.session.plant_sha256);
  expect(after.session.commands).toEqual(before.session.commands);
  expect(after.session.deadline_at_ms).toBe(before.session.deadline_at_ms);
  expect(after.session.submissions).toEqual(before.session.submissions);
  await expect(page.getByText('Tick 5 / Paused', { exact: true })).toBeVisible();
});

test('the original recovery deadline expires while behavior inspection remains open', async ({ page }) => {
  await page.clock.install(); await begin(page); await inspect(page);
  const before = await save(page);
  await page.clock.fastForward(300001);
  await expect(page.getByRole('heading', { name: 'Recovery time ended.', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check repair', exact: true })).toBeDisabled();
  await expect(page.getByRole('region', { name: 'Behavior inspection', exact: true })).toBeVisible();
  const saved = await save(page);
  expect(saved.session.phase).toBe('submitted');
  expect(saved.session.deadline_at_ms).toBe(before.session.deadline_at_ms);
  expect(saved.session.plant_sha256).toBe(before.session.plant_sha256);
  expect(saved.session.commands).toEqual(before.session.commands);
});

test('a new attempt cannot reopen a previous attempt inspection or comparison', async ({ page }) => {
  await begin(page); await inspect(page);
  await page.getByRole('button', { name: 'New attempt', exact: true }).click();
  await page.getByRole('button', { name: 'Begin takeover', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Behavior inspection', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Explore behavior', exact: true }).click();
  await expect(page.getByLabel('Continuation tick', { exact: true })).toHaveCount(0);
});

test('concept lessons do not start recovery, save commands or change the authored handover', async ({ page }) => {
  await page.goto('./');
  const stored = await page.evaluate(() => Object.keys(localStorage).filter(key => key === 'after-the-agent.saved.v1' || key.startsWith('after-the-agent.saved.v2.')).sort().map(key => [key, localStorage.getItem(key)]));
  await page.getByRole('button', { name: 'Explore the concepts', exact: true }).click();
  const lessons = page.getByRole('region', { name: 'Interactive concept lessons', exact: true });
  await expect(lessons).toBeVisible();
  await lessons.getByRole('radio', { name: '1 pulse', exact: true }).check();
  await lessons.getByRole('button', { name: 'Advance example', exact: true }).click();
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key === 'after-the-agent.saved.v1' || key.startsWith('after-the-agent.saved.v2.')).sort().map(key => [key, localStorage.getItem(key)]))).toEqual(stored);
  await page.getByRole('button', { name: 'Close concept lessons', exact: true }).click();
  await page.getByRole('button', { name: 'Take over the lights' }).click();
  await page.getByRole('button', { name: 'Begin takeover' }).click();
  await expect(page.getByText('Tick 5 / Paused', { exact: true })).toBeVisible();
  await expect(page.getByText('primary.4.left', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Delivery guard', { exact: true })).not.toBeChecked();
  await expect(lessons).toHaveCount(0);
});

test('public concept and inspection aids are absent in matched local rehearsal', async ({ page }) => {
  await page.clock.install(); await page.goto('./');
  await page.getByRole('button', { name: 'Open local rehearsal', exact: true }).click();
  await page.getByRole('button', { name: 'Begin synthetic rehearsal', exact: true }).click();
  await page.clock.fastForward(135000);
  await expect(page.getByText('Tick 5 / Paused', { exact: true })).toBeVisible();
  for (const name of ['Explore the concepts', 'Explore behavior', 'Explore this continuation']) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  }
  await expect(page.getByRole('button', { name: /^Follow / })).toHaveCount(0);
  await expect(page.locator('main')).not.toHaveClass(/public-workbench/);
});

test('a failed continuation worker reports unavailable without changing the active repair', async ({ page }) => {
  await page.route(/continuation\.worker.*\.js/, route => route.abort());
  await begin(page);
  const before = await save(page);
  await page.getByRole('button', { name: 'Check repair', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Repair did not hold', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Explore behavior', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Continuation inspection unavailable' })).toBeVisible();
  const after = await save(page);
  expect(after.session.plant_sha256).toBe(before.session.plant_sha256);
  expect(after.session.deadline_at_ms).toBe(before.session.deadline_at_ms);
  await expect(page.getByRole('button', { name: 'Check repair', exact: true })).toBeEnabled();
});
