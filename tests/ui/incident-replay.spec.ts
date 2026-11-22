import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const hosting = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
const contentSecurityPolicy = hosting.headers[0].headers.find(({ key }: { key: string }) => key === 'Content-Security-Policy').value;

test('the landing page opens the incident and a blind retry shows the duplicate', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/incident-replay/index.html', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': contentSecurityPolicy } });
  });
  await page.goto('./');
  await page.getByRole('link', { name: 'Try the incident replay' }).click();
  await expect(page).toHaveTitle('Incident replay | After the Agent');
  await expect(page.getByRole('heading', { name: 'Would you retry?' })).toBeVisible();
  await expect(page.locator('#outcome')).toBeHidden();
  await expect(page.locator('#provider')).toHaveText('Unchecked');

  await page.getByRole('button', { name: 'Retry the reservation' }).press('Enter');
  await expect(page.getByRole('heading', { name: 'You reserved the stock twice' })).toBeFocused();
  await expect(page.locator('#before')).toHaveText('1 reservation, 2 units');
  await expect(page.locator('#after')).toHaveText('2 reservations, 4 units');
  expect(errors).toEqual([]);
});

test('the narrow layout preserves evidence checks, approval and unresolved cases', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./incident-replay/index.html');
  const check = () => page.getByRole('button', { name: 'Check provider record', exact: true }).click();
  const hold = () => page.getByRole('button', { name: 'Hold for review' }).click();
  const confirm = () => page.getByRole('button', { name: 'Confirm the existing reservation' }).click();
  const next = () => page.getByRole('button', { name: 'Try the next case' }).click();

  await check();
  await confirm();
  await expect(page.getByRole('heading', { name: 'You recovered the original result' })).toBeVisible();
  await expect(page.locator('#after')).toHaveText('1 reservation, 2 units');

  await next();
  await expect(page.locator('#outcome')).toBeHidden();
  await check();
  await page.getByRole('button', { name: 'Retry the reservation' }).click();
  await expect(page.getByRole('heading', { name: 'You restored the reservation' })).toBeVisible();
  await expect(page.locator('#before')).toHaveText('0 reservations, 0 units');

  await next();
  await check();
  await expect(page.locator('#provider')).toContainText('still unknown');
  await hold();
  await expect(page.getByRole('heading', { name: 'You kept the outcome unresolved' })).toBeVisible();

  await next();
  await check();
  await confirm();
  await expect(page.getByRole('heading', { name: 'The receipt covers the earlier order' })).toBeVisible();
  await expect(page.locator('#after')).toHaveText('1 reservation, 2 units');

  await next();
  await check();
  await expect(page.locator('#provider')).toContainText('lookup found no receipt');
  await hold();
  await expect(page.locator('#after')).toHaveText('1 reservation, 2 units');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
