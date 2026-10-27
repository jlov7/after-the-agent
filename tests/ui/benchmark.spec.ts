import { test, expect } from '@playwright/test';
const { measureRepairInBrowser } = await import(new URL('../../scripts/browser-measurement.mjs', import.meta.url).href);
test('scoring measurement waits for its actual new worker receipt despite a historical verdict and unrelated DOM mutation', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Take over the lights' }).click();
  await page.getByRole('button', { name: 'Begin takeover' }).click();
  await page.getByLabel('Delivery guard').check();
  await page.getByRole('button', { name: 'Check repair', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Repair held' })).toBeVisible();
  await page.evaluate(() => {
    const forward = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function(message, ...rest) {
      if (message?.type !== 'evaluate') return Reflect.apply(forward, this, [message, ...rest]);
      const previous = document.createElement('section');
      previous.setAttribute('aria-label', 'Historical test-only verdict');
      previous.innerHTML = '<h2>Repair held</h2><p>All 12 future scenarios passed</p>';
      document.body.append(previous);
      setTimeout(() => Reflect.apply(forward, this, [message, ...rest]), 200);
    };
  });
  const measured = await page.evaluate(measureRepairInBrowser) as { elapsed_ms: number; request_id: string; candidate_sha256: string; twelve_cases: boolean; worker_status: string };
  expect(measured.elapsed_ms).toBeGreaterThanOrEqual(180);
  expect(measured.request_id).toMatch(/^[a-f0-9-]{36}$/);
  expect(measured.candidate_sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(measured.worker_status).toBe('pass');
  expect(measured.twelve_cases).toBe(true);
});
