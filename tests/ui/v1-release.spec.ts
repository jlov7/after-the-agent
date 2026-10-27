import { openEvidenceExports } from './evidence-controls.js';
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const faults = ['stale-queue', 'duplicate-clock', 'cached-gate'] as const;
async function download(page: Page, name: string) {
  if (['Download attempt evidence', 'Download verification packet'].includes(name)) await openEvidenceExports(page);
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name, exact: true }).click();
  return readFile((await (await pending).path())!, 'utf8');
}
const begin = async (page: Page) => {
  await page.goto('./'); await expect(page).toHaveTitle('After the Agent');
  await expect(page.getByRole('heading', { name: 'The agent handed it over. Can you keep it working?', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Take over the lights', exact: true }).click();
  await page.getByRole('button', { name: 'Begin takeover', exact: true }).click();
  await expect(page.getByText('Tick 5 / Paused', { exact: true })).toBeVisible();
};
async function repair(page: Page, fault: typeof faults[number]) {
  if (fault === 'stale-queue') await page.getByLabel('Delivery guard', { exact: true }).check();
  if (fault === 'duplicate-clock') {
    await page.getByLabel('Standby clock', { exact: true }).uncheck();
    await page.locator('#queue li').filter({ hasText: 'Standby clock' }).getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Drop selected', exact: true }).click();
  }
  if (fault === 'cached-gate') await page.getByRole('radio', { name: 'Live', exact: true }).check();
}
for (const width of [1440, 390, 320]) {
  test(`all three faults, retained results, restoration and packet inspection at ${width}px`, async ({ page, browserName }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [], external: string[] = [], origin = new URL(test.info().project.use.baseURL!).origin;
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('request', request => { if (!request.url().startsWith(origin + '/') && !request.url().startsWith('blob:')) external.push(request.url()); });
    await begin(page); const output = `evidence/v1/browser/${browserName}`; await mkdir(output, { recursive: true });
    const receipts: unknown[] = [];
    for (const fault of faults) {
      if (fault !== 'stale-queue') {
        await page.getByLabel('Try another fault').selectOption(fault); await page.getByRole('button', { name: 'New attempt', exact: true }).click();
        await page.getByRole('button', { name: 'Begin takeover', exact: true }).click();
      }
      await expect(page.getByText('Tick 5 / Paused', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Check repair', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Repair did not hold', exact: true })).toBeVisible();
      await expect(page.locator('.candidate-state')).toHaveCSS('background-color', 'rgb(34, 48, 57)');
      if (width === 1440 && fault === 'stale-queue') await page.locator('#result').screenshot({ path: `${output}/stale-queue-1440-failure.png` });
      await repair(page, fault); await page.getByRole('button', { name: 'Check repair', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Repair held', exact: true })).toBeVisible();
      await expect(page.getByText(/This passing check is retained in this run/)).toBeVisible();
      const raw = await download(page, 'Save progress to a file'), saved = JSON.parse(raw);
      expect(saved.session.submissions.map((item: { evaluation: { status: string } }) => item.evaluation.status)).toEqual(['mismatch', 'pass']);
      await page.getByLabel('Restore attempt', { exact: true }).setInputFiles({ name: 'latest.json', mimeType: 'application/json', buffer: Buffer.from(raw) });
      await expect(page.getByText('Attempt restored. Commands were validated and replayed. The original deadline still applies.', { exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Repair held', exact: true })).toBeVisible();
      const resumed = JSON.parse(await download(page, 'Save progress to a file'));
      expect(resumed.session.attempt_id).toBe(saved.session.attempt_id); expect(resumed.session.deadline_at_ms).toBe(saved.session.deadline_at_ms);
      expect(resumed.session.commands).toEqual(saved.session.commands);
      const packet = await download(page, 'Download verification packet');
      await page.getByRole('button', { name: 'Open replay viewer', exact: true }).click(); await page.getByLabel('Replay file type').selectOption('packet');
      await page.getByLabel('Open replay file', { exact: true }).setInputFiles({ name: 'packet.json', mimeType: 'application/json', buffer: Buffer.from(packet) });
      const viewer = page.getByRole('region', { name: 'Read-only replay', exact: true }); await expect(viewer).toContainText('Command replay: verified');
      expect(await download(page, 'Download inspected file')).toBe(packet); await viewer.getByRole('button', { name: 'Close replay', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Repair held', exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.getByRole('heading', { name: 'Repair held', exact: true }).focus();
      await expect(page.getByRole('heading', { name: 'Repair held', exact: true })).toBeInViewport();
      const violations = (await new AxeBuilder({ page }).analyze()).violations.filter(item => ['critical', 'serious'].includes(item.impact ?? ''));
      expect(violations).toEqual([]);
      await page.screenshot({ path: `${output}/${fault}-${width}-result.png` });
      await page.getByRole('heading', { name: /Restore the pattern\./ }).focus();
      await page.screenshot({ path: `${output}/${fault}-${width}-board.png` });
      receipts.push({ fault, width, tick: 5, checks: ['mismatch', 'pass'], commands_replayed: saved.session.commands.length, packet_exact_roundtrip: true, original_deadline_preserved: true, critical_serious_axe_violations: 0 });
    }
    expect(errors).toEqual([]); expect(external).toEqual([]);
    await writeFile(`${output}/journeys-${width}.json`, JSON.stringify({ browser: browserName, version: page.context().browser()?.version(), errors, external, receipts, claim_ceiling: 'Automated software journeys, not human observation.' }, null, 2) + '\n');
  });
}
test('keyboard repair, settings navigation and focused controls remain usable at 320px, 200% zoom and reduced motion', async ({ page, browserName }) => {
  await page.setViewportSize({ width: 320, height: 900 }); await page.emulateMedia({ reducedMotion: 'reduce' }); await begin(page);
  await page.getByRole('link', { name: 'Settings', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Instrument inspector', exact: true })).toBeFocused();
  await page.getByRole('navigation', { name: 'Setting groups' }).getByRole('link', { name: 'Guard', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Delivery guard', exact: true })).toBeFocused();
  await page.keyboard.press('Tab'); await expect(page.getByLabel('Delivery guard', { exact: true })).toBeFocused(); await page.keyboard.press('Space');
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
  await page.getByRole('button', { name: 'Step', exact: true }).focus();
  await page.getByLabel('Delivery guard', { exact: true }).focus();
  await expect.poll(async () => {
    const box = await page.getByLabel('Delivery guard', { exact: true }).boundingBox(), dock = await page.getByTestId('recovery-toolbar').boundingBox();
    return !!box && !!dock && box.y >= 0 && box.y + box.height < dock.y;
  }).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  for (const button of await page.getByTestId('recovery-toolbar').getByRole('button').all()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.getByRole('button', { name: 'Check repair', exact: true }).focus(); await page.keyboard.press('Enter');
  const heading = page.getByRole('heading', { name: 'Repair held', exact: true }); await expect(heading).toBeFocused(); await expect(heading).toBeInViewport();
  await mkdir(`evidence/v1/browser/${browserName}`, { recursive: true });
  await page.screenshot({ path: `evidence/v1/browser/${browserName}/320-zoom-keyboard.png` });
  expect((await new AxeBuilder({ page }).analyze()).violations.filter(item => ['critical', 'serious'].includes(item.impact ?? ''))).toEqual([]);
});

test('phone pointer focus does not move a clock checkbox between press and release', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 }); await begin(page);
  await page.getByLabel('Try another fault').selectOption('duplicate-clock');
  await page.getByRole('button', { name: 'New attempt', exact: true }).click();
  await page.getByRole('button', { name: 'Begin takeover', exact: true }).click();
  const clock = page.getByLabel('Standby clock', { exact: true }); await clock.scrollIntoViewIfNeeded();
  await clock.evaluate(element => {
    const dock = document.querySelector('.toolbar')!.getBoundingClientRect(), box = element.getBoundingClientRect();
    window.scrollBy({ top: box.y + box.height / 2 - (dock.y - 3), behavior: 'instant' });
  });
  const before = (await clock.boundingBox())!;
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2); await page.mouse.down();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const after = (await clock.boundingBox())!;
  await page.mouse.up();
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
  await expect(clock).not.toBeChecked();
});
