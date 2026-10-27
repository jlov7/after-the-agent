import { expect, test, chromium } from '@playwright/test';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';

const savedAttempt = async (page: import('@playwright/test').Page) => {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save progress to a file', exact: true }).click();
  const value = JSON.parse(readFileSync((await (await pending).path())!, 'utf8')) as { session: import('../../packages/engine/src/session.js').SavedSession };
  await expect.poll(() => page.evaluate(id => localStorage.getItem(`after-the-agent.saved.v2.${id}`), value.session.attempt_id)).toBe(JSON.stringify(value.session));
  return value.session;
};
test('offline edition exposes an installable manifest and an explicit cache control', async ({ page, request }) => {
  await page.goto('./');
  await expect(page.getByRole('button', { name: 'Enable offline edition', exact: true })).toBeVisible({ timeout: 1500 });
  const response = await request.get('manifest.webmanifest');
  expect(response.headers()['content-type']).toContain('application/manifest+json');
  const manifest = await response.json();
  expect(manifest.display).toBe('standalone');
  expect(manifest.start_url).toBe('./');
  expect(manifest.icons.map((icon: { sizes: string }) => icon.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
  await page.getByRole('button', { name: 'Enable offline edition', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Offline edition ready' })).toBeVisible();
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await page.context().setOffline(true);
  await page.getByRole('link', { name: 'Product specification', exact: true }).click();
  await expect(page.locator('body')).toContainText(/product specification/i);
  expect(await page.locator('#root').count()).toBe(0);
});

test('a corrupt offline update retains the complete edition and another active tab blocks activation', async ({ browser }) => {
  let version: 'original' | 'corrupt' | 'next' = 'original';
  const root = resolve('apps/web/dist'), base = process.env.BASE || '/';
  const nextRelease = 'a'.repeat(64);
  const server = createServer((request, response) => {
    const pathname = new URL(request.url!, 'http://localhost').pathname;
    const name = pathname.slice(base.length) || 'index.html';
    if (!pathname.startsWith(base) || name.includes('..')) { response.writeHead(404).end(); return; }
    try {
      let body = readFileSync(join(root, name));
      if (name === 'sw.js' && version !== 'original') {
        let text = body.toString().replace(/"release_id":"[a-f0-9]{64}"/, `"release_id":"${nextRelease}"`);
        if (version === 'corrupt') text = text.replace(/"sha256":"[a-f0-9]{64}"/, `"sha256":"${'0'.repeat(64)}"`);
        body = Buffer.from(text);
      }
      const type = name.endsWith('.js') ? 'text/javascript' : name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : name.endsWith('.webmanifest') ? 'application/manifest+json' : name.endsWith('.png') ? 'image/png' : name.endsWith('.json') ? 'application/json' : 'text/plain';
      response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }).end(body);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Test server address unavailable.');
  const url = `http://127.0.0.1:${address.port}${base}`;
  const context = await browser.newContext();
  try {
    const page = await context.newPage(); await page.goto(url);
    let releaseInstall: (() => void) | undefined;
    const gate = new Promise<void>(resolve => { releaseInstall = resolve; });
    await page.route('**/sw.js', async route => { await gate; await route.continue(); });
    await page.getByRole('button', { name: 'Enable offline edition', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open local rehearsal', exact: true })).toBeDisabled();
    await expect(page.getByLabel('Restore attempt', { exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Take over the lights' })).toBeDisabled();
    releaseInstall!();
    await expect(page.getByRole('status').filter({ hasText: 'Offline edition ready' })).toBeVisible();
    const original = await page.evaluate(async () => (await (await fetch('release-manifest.json')).json()).release_id);
    version = 'corrupt';
    await page.getByRole('button', { name: 'Check offline update', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: /could not be verified|Failed to update/ })).toBeVisible();
    expect(await page.evaluate(async () => (await (await fetch('release-manifest.json')).json()).release_id)).toBe(original);
    version = 'next';
    await page.getByRole('button', { name: 'Take over the lights' }).click();
    await page.getByRole('button', { name: 'Begin takeover', exact: true }).click();
    const saved = await savedAttempt(page);
    await expect(page.getByRole('button', { name: 'Check offline update', exact: true })).toBeDisabled();
    const other = await context.newPage(); await other.goto(url);
    await other.getByRole('button', { name: 'Check offline update', exact: true }).click();
    await expect(other.getByRole('status').filter({ hasText: 'Close other After the Agent tabs' })).toBeVisible();
    expect(await page.evaluate(id => localStorage.getItem(`after-the-agent.saved.v2.${id}`), saved.attempt_id)).toBe(JSON.stringify(saved));
    await page.close();
    await Promise.all([other.waitForEvent('load'), other.getByRole('button', { name: 'Check offline update', exact: true }).click()]);
    expect(await other.evaluate(async () => (await (await fetch('release-manifest.json')).json()).release_id)).toBe(nextRelease);
    expect(await other.evaluate(async () => (await caches.keys()).filter(name => name.startsWith('after-the-agent:')).length)).toBeLessThanOrEqual(2);
    await context.setOffline(true); await other.reload();
    await other.getByRole('button', { name: 'Resume saved attempt', exact: true }).click();
    await expect(other.getByText('Tick 5 / Paused', { exact: true })).toBeVisible();
    const resumed = await savedAttempt(other); expect(resumed.attempt_id).toBe(saved.attempt_id); expect(resumed.deadline_at_ms).toBe(saved.deadline_at_ms);
  } finally { await context.close(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test('a closed browser reopens offline with all three faults, workers and the original resume deadline', async ({ baseURL }) => {
  test.setTimeout(90000);
  const profile = test.info().outputPath('offline-profile');
  const screenshots = 'evidence/ui-browser/screenshots'; mkdirSync(screenshots, { recursive: true });
  let context = await chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const evidence: Record<string, unknown> = { evidence_class: 'persistent_headless_offline_software', reopened: false, faults: [] };
  try {
    let page = await context.newPage(); await page.goto(baseURL!);
    await page.getByRole('button', { name: 'Enable offline edition', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Offline edition ready' })).toBeVisible();
    await page.getByRole('button', { name: 'Take over the lights' }).click();
    await page.getByRole('button', { name: 'Begin takeover', exact: true }).click();
    const before = await savedAttempt(page);
    await context.close();
    context = await chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 390, height: 844 } });
    await context.setOffline(true); page = await context.newPage(); await page.goto(baseURL!);
    await page.getByRole('button', { name: 'Resume saved attempt', exact: true }).click();
    await expect(page.getByText('Tick 5 / Paused', { exact: true })).toBeVisible();
    const after = await savedAttempt(page); expect(after.attempt_id).toBe(before.attempt_id);
    expect(after.deadline_at_ms).toBe(before.deadline_at_ms);
    evidence.reopened = true; evidence.original_deadline_preserved = true;
    for (const fault of ['stale-queue', 'duplicate-clock', 'cached-gate']) {
      if (fault !== 'stale-queue') {
        await page.getByLabel('Try another fault').selectOption(fault);
        await page.getByRole('button', { name: 'New attempt', exact: true }).click();
        await page.getByRole('button', { name: 'Begin takeover', exact: true }).click();
      }
      await page.getByRole('button', { name: 'Check repair', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Repair did not hold', exact: true })).toBeVisible();
      if (fault === 'stale-queue') await page.getByLabel('Delivery guard', { exact: true }).check();
      if (fault === 'duplicate-clock') {
        await page.getByLabel('Standby clock', { exact: true }).uncheck();
        await page.locator('#queue li').filter({ hasText: 'Standby clock' }).getByRole('checkbox').check();
        await page.getByRole('button', { name: 'Drop selected', exact: true }).click();
      }
      if (fault === 'cached-gate') await page.getByRole('radio', { name: 'Live', exact: true }).check();
      await page.getByRole('button', { name: 'Check repair', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Repair held', exact: true })).toBeVisible();
      await expect(page.getByText('All 12 future scenarios passed', { exact: true })).toBeVisible();
      (evidence.faults as string[]).push(fault);
    }
    const release = await page.evaluate(async () => (await fetch(new URL('release-manifest.json', document.baseURI))).json());
    expect(release.assets.filter((asset: { path: string }) => asset.path.endsWith('.js')).length).toBeGreaterThan(3);
    evidence.release_id = release.release_id; evidence.cached_assets = release.assets.length;
    await page.screenshot({ path: `${screenshots}/offline-reopened.png` });
    writeFileSync('evidence/offline-verification.json', JSON.stringify(evidence, null, 2) + '\n');
  } finally { await context.close(); rmSync(profile, { recursive: true, force: true }); }
});
