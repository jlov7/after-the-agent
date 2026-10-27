import { openEvidenceExports } from './evidence-controls.js';
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { sha256Text } from '../../packages/contracts/src/index.js';
import { compactAttemptExport, createSession } from '../../packages/engine/src/session.js';
import { packetInventory } from '../../packages/runner/src/evidence-packet.js';

const output = 'evidence/portability/browser';
test.beforeAll(() => mkdirSync(output, { recursive: true }));
async function begin(page: Page) {
  await page.goto('./'); await page.getByRole('button', { name: 'Take over the lights' }).click();
  await page.getByRole('button', { name: 'Begin takeover', exact: true }).click(); await expect(page.getByLabel('Delivery guard', { exact: true })).toBeEnabled();
}
async function download(page: Page, name: string) {
  if (['Download attempt evidence', 'Download verification packet'].includes(name)) await openEvidenceExports(page);
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name, exact: true }).click();
  return readFileSync((await (await pending).path())!, 'utf8');
}
async function notebook(page: Page) {
  await page.getByRole('button', { name: 'Open attempt notebook', exact: true }).click();
  await page.getByRole('button', { name: 'Enable notebook on this browser', exact: true }).click();
}
const slots = (page: Page) => page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('after-the-agent.saved.v2.')).map(key => ({ key, raw: localStorage.getItem(key)! })));
const upload = (page: Page, label: string, raw: string) => page.getByLabel(label, { exact: true }).setInputFiles({ name: 'local.json', mimeType: 'application/json', buffer: Buffer.from(raw) });

test('complete packet reopens in browser without changing its bytes, board or original deadline', async ({ page }) => {
  await begin(page); const live = JSON.parse(await download(page, 'Save progress to a file'));
  const raw = await download(page, 'Download verification packet'), packet = JSON.parse(raw);
  await page.getByRole('button', { name: 'Open replay viewer', exact: true }).click();
  await expect(page.getByLabel('Replay file type').locator('option[value="packet"]')).toHaveCount(1, { timeout: 1500 });
  await page.getByLabel('Replay file type').selectOption('packet'); await upload(page, 'Open replay file', raw);
  const viewer = page.getByRole('region', { name: 'Read-only replay', exact: true });
  await expect(viewer).toContainText('Packet inventory: consistent'); await expect(viewer).toContainText('Command replay: verified');
  await expect(viewer).toContainText('does not run Python'); await expect(viewer).toContainText('provenance remains unverified');
  expect(await download(page, 'Download inspected file')).toBe(raw); expect(await download(page, 'Download embedded attempt')).toBe(packet.attempt);
  await viewer.getByRole('button', { name: 'Final state', exact: true }).click(); await expect(viewer.getByRole('heading', { name: 'Settled tick 5', exact: true })).toBeVisible();
  await viewer.screenshot({ path: `${output}/packet.png` });
  expect((await new AxeBuilder({ page }).include('.replay-viewer').analyze()).violations).toEqual([]);
  await viewer.getByRole('button', { name: 'Close replay', exact: true }).click();
  const after = JSON.parse(await download(page, 'Save progress to a file'));
  expect(after.session.attempt_id).toBe(live.session.attempt_id); expect(after.session.deadline_at_ms).toBe(live.session.deadline_at_ms); expect(after.session.plant_sha256).toBe(live.session.plant_sha256);
  writeFileSync(`${output}/packet-roundtrip.json`, JSON.stringify({ packet_sha256: sha256Text(raw), attempt_sha256: sha256Text(packet.attempt), exact_bytes: true, original_deadline_preserved: true, live_board_unchanged: true, provenance: 'unverified' }, null, 2) + '\n');
});

test('notebook backup preserves names dates and exact bytes across browser contexts with idempotent merge', async ({ page, browser, baseURL }) => {
  await begin(page); await notebook(page);
  for (const name of ['First board', 'After guard repair']) {
    if (name === 'After guard repair') await page.getByLabel('Delivery guard', { exact: true }).check();
    await page.getByLabel('Bookmark name', { exact: true }).fill(name); await page.getByRole('button', { name: 'Save current attempt', exact: true }).click(); await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  }
  await expect(page.getByRole('button', { name: 'Download notebook backup', exact: true })).toBeVisible({ timeout: 1500 });
  const raw = await download(page, 'Download notebook backup'), original = JSON.parse(raw);
  const context = await browser.newContext({ baseURL: baseURL! });
  try {
    const other = await context.newPage(); await begin(other); const live = JSON.parse(await download(other, 'Save progress to a file')); await notebook(other);
    await upload(other, 'Import notebook backup', raw);
    await expect(other.getByRole('region', { name: 'Notebook import preview', exact: true })).toContainText('2 new bookmarks');
    await expect(other.getByRole('heading', { name: 'First board', exact: true })).toHaveCount(0);
    await other.getByRole('button', { name: 'Merge notebook backup', exact: true }).click(); await expect(other.getByRole('status').filter({ hasText: '2 bookmarks added' })).toBeVisible();
    const imported = JSON.parse(await download(other, 'Download notebook backup'));
    expect(imported).toEqual(original);
    await upload(other, 'Import notebook backup', raw); await expect(other.getByRole('region', { name: 'Notebook import preview', exact: true })).toContainText('2 identical bookmarks');
    await other.getByRole('button', { name: 'Merge notebook backup', exact: true }).click(); await expect(other.getByRole('status').filter({ hasText: '0 bookmarks added' })).toBeVisible();
    expect(JSON.parse(await download(other, 'Download notebook backup'))).toEqual(original);
    const after = JSON.parse(await download(other, 'Save progress to a file'));
    expect(after.session.attempt_id).toBe(live.session.attempt_id); expect(after.session.deadline_at_ms).toBe(live.session.deadline_at_ms); expect(after.session.plant_sha256).toBe(live.session.plant_sha256);
    await other.locator('.attempt-notebook').screenshot({ path: `${output}/notebook.png` });
    expect((await new AxeBuilder({ page: other }).include('.attempt-notebook').analyze()).violations).toEqual([]);
    writeFileSync(`${output}/notebook-roundtrip.json`, JSON.stringify({ entries: imported.entries.length, exact_records: true, repeated_import_added: 0, original_deadline_preserved: true, live_board_unchanged: true }, null, 2) + '\n');
  } finally { await context.close(); }
});

test('abandoned retained autosave remains downloadable byte for byte without becoming resumable', async ({ page }) => {
  await begin(page); await expect.poll(async () => (await slots(page)).length).toBe(1); const original = (await slots(page))[0]!;
  await page.getByRole('button', { name: 'New attempt', exact: true }).click(); await page.getByRole('button', { name: 'Begin takeover', exact: true }).click(); await expect.poll(async () => (await slots(page)).length).toBe(2); await page.reload();
  const id = JSON.parse(original.raw).attempt_id; await page.getByLabel('Saved attempt', { exact: true }).selectOption(id);
  const retained = (await slots(page)).find(item => item.key === original.key)!;
  await expect(page.getByRole('button', { name: 'Download selected autosave', exact: true })).toBeVisible({ timeout: 1500 });
  expect(await download(page, 'Download selected autosave')).toBe(retained.raw);
  await expect(page.getByRole('status').filter({ hasText: 'Raw autosave downloaded' })).toContainText('abandoned_reset');
  expect((await slots(page)).find(item => item.key === original.key)!.raw).toBe(retained.raw);
  await page.getByRole('button', { name: 'Resume saved attempt', exact: true }).click(); await expect(page.getByText(/Cannot resume: This attempt was abandoned by reset/)).toBeVisible();
  await page.locator('.resume').screenshot({ path: `${output}/autosave.png` });
  writeFileSync(`${output}/autosave-rescue.json`, JSON.stringify({ exact_bytes: true, sha256: sha256Text(retained.raw), still_retired: true, storage_unchanged: true }, null, 2) + '\n');
});

test('offline audit detects lost and altered cache bytes without network or attempt mutations', async ({ page, context }) => {
  await page.goto('./'); await page.getByRole('button', { name: 'Enable offline edition', exact: true }).click(); await expect(page.getByRole('status').filter({ hasText: 'Offline edition ready' })).toBeVisible();
  const section = page.getByRole('region', { name: 'Offline edition', exact: true });
  await expect(section.getByRole('button', { name: 'Check saved offline files', exact: true })).toBeVisible({ timeout: 1500 });
  await section.getByRole('button', { name: 'Check saved offline files', exact: true }).click(); await expect(section.getByRole('status')).toContainText('All saved offline files match');
  const manifest = await page.evaluate(async () => (await (await fetch(new URL('release-manifest.json', document.baseURI))).json()));
  await page.getByRole('button', { name: 'Take over the lights' }).click(); await page.getByRole('button', { name: 'Begin takeover', exact: true }).click(); await expect(page.getByLabel('Delivery guard', { exact: true })).toBeEnabled();
  const before = JSON.parse(await download(page, 'Save progress to a file'));
  await page.evaluate(async release => {
    const cacheName = (await caches.keys()).find(name => name.endsWith(release.release_id))!;
    const cache = await caches.open(cacheName);
    const first = new URL(release.assets[0].path, document.baseURI), second = new URL(release.assets[1].path, document.baseURI);
    await cache.delete(first); await cache.put(second, new Response('altered cached bytes'));
  }, manifest);
  await context.setOffline(true); const network: string[] = []; page.on('request', request => network.push(request.url()));
  await section.getByRole('button', { name: 'Check saved offline files', exact: true }).click(); await expect(section.getByRole('status')).toContainText('1 missing, 1 altered');
  expect(network).toEqual([]); const after = JSON.parse(await download(page, 'Save progress to a file'));
  expect(after.session.attempt_id).toBe(before.session.attempt_id); expect(after.session.deadline_at_ms).toBe(before.session.deadline_at_ms); expect(after.session.plant_sha256).toBe(before.session.plant_sha256);
  await section.screenshot({ path: `${output}/offline-audit.png` });
  writeFileSync(`${output}/offline-audit.json`, JSON.stringify({ release_id: manifest.release_id, assets: manifest.assets.length + 1, missing: 1, altered: 1, network_requests: network.length, live_board_unchanged: true, original_deadline_preserved: true }, null, 2) + '\n');
});

test('packet inventory corruption is rejected and a subsequent valid file still opens', async ({ page }) => {
  await begin(page); const raw = await download(page, 'Download verification packet');
  await page.getByRole('button', { name: 'Open replay viewer', exact: true }).click(); await page.getByLabel('Replay file type').selectOption('packet');
  const changed = JSON.parse(raw); changed.attempt += '\n'; await upload(page, 'Open replay file', JSON.stringify(changed));
  const viewer = page.getByRole('region', { name: 'Read-only replay', exact: true });
  await expect(viewer.getByRole('status').first()).toContainText('Packet inventory differs'); await expect(viewer.getByRole('region', { name: 'Reconstructed board' })).toHaveCount(0);
  await upload(page, 'Open replay file', raw); await expect(viewer).toContainText('Packet inventory: consistent'); expect(await download(page, 'Download inspected file')).toBe(raw);
});

test('recomputed packet inventory cannot label scripted substitutions as the genuine playback source', async ({ page }) => {
  await begin(page); const packet = JSON.parse(await download(page, 'Download verification packet'));
  const scripted = createSession({ scenario: 'stale-queue', now: () => 1000 }, () => { throw new Error('No scoring'); }, () => { throw new Error('No scoring'); });
  try {
    scripted.start(); const attempt = JSON.parse(packet.attempt); attempt.commands = compactAttemptExport(scripted).commands;
    packet.attempt = JSON.stringify(attempt); packet.inventory = packetInventory(packet.attempt, packet.playback_source);
  } finally { scripted.dispose(); }
  await page.getByRole('button', { name: 'Open replay viewer', exact: true }).click(); await page.getByLabel('Replay file type').selectOption('packet'); await upload(page, 'Open replay file', JSON.stringify(packet));
  const viewer = page.getByRole('region', { name: 'Read-only replay', exact: true });
  await expect(viewer.getByRole('status').first()).toContainText('reconstructed playback prefix'); await expect(viewer.getByRole('region', { name: 'Packet inspection' })).toHaveCount(0);
});

test('one invalid or conflicting notebook entry and a cancelled preview leave every retained byte unchanged', async ({ page }) => {
  await begin(page); await notebook(page); await page.getByLabel('Bookmark name', { exact: true }).fill('Retained'); await page.getByRole('button', { name: 'Save current attempt', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Retained', exact: true })).toBeVisible();
  const raw = await download(page, 'Download notebook backup'), original = JSON.parse(raw), region = page.locator('.attempt-notebook');
  const incoming = { ...original.entries[0], id: crypto.randomUUID(), name: 'Incoming' };
  const corrupted = { ...original, entries: [incoming, { ...incoming, id: crypto.randomUUID(), sha256: '0'.repeat(64) }] };
  await upload(page, 'Import notebook backup', JSON.stringify(corrupted)); await expect(region.getByRole('alert')).toContainText('commitment differ');
  expect(await download(page, 'Download notebook backup')).toBe(raw);
  await upload(page, 'Import notebook backup', JSON.stringify({ ...original, entries: [{ ...original.entries[0], name: 'Overwrite attempt' }] })); await expect(region.getByRole('alert')).toContainText('conflicts');
  expect(await download(page, 'Download notebook backup')).toBe(raw);
  await upload(page, 'Import notebook backup', JSON.stringify({ ...original, entries: [incoming] })); await expect(region.getByRole('region', { name: 'Notebook import preview', exact: true })).toContainText('1 new bookmarks');
  await region.getByRole('button', { name: 'Cancel notebook import', exact: true }).click(); expect(await download(page, 'Download notebook backup')).toBe(raw);
});

test('notebook quota changed by another writer after preview rejects the complete merge atomically', async ({ page }) => {
  await begin(page); await notebook(page); await page.getByLabel('Bookmark name', { exact: true }).fill('Existing'); await page.getByRole('button', { name: 'Save current attempt', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Existing', exact: true })).toBeVisible();
  const raw = await download(page, 'Download notebook backup'), original = JSON.parse(raw);
  const incoming = { ...original, entries: [1, 2].map(number => ({ ...original.entries[0], id: crypto.randomUUID(), name: `Incoming ${number}` })) };
  await upload(page, 'Import notebook backup', JSON.stringify(incoming)); await expect(page.getByRole('region', { name: 'Notebook import preview', exact: true })).toContainText('2 new bookmarks');
  const retained = await page.evaluate(async seed => {
    const records = Array.from({ length: 20 }, (_, index) => ({ ...seed, id: crypto.randomUUID(), name: `Concurrent ${index}` }));
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('after-the-agent.notebook.v1', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try { await new Promise<void>((resolve, reject) => { const tx = db.transaction('bookmarks', 'readwrite'), store = tx.objectStore('bookmarks'); store.clear(); records.forEach(record => store.add(record)); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); } finally { db.close(); }
    return records.sort((a, b) => a.id.localeCompare(b.id));
  }, original.entries[0]);
  await page.getByRole('button', { name: 'Merge notebook backup', exact: true }).click(); await expect(page.locator('.attempt-notebook').getByRole('alert')).toContainText('20 bookmarks');
  expect(JSON.parse(await download(page, 'Download notebook backup')).entries).toEqual(retained);
});

test('damaged autosave can be rescued without reading a valid session or deleting unrelated storage', async ({ page }) => {
  await page.goto('./'); const raw = 'damaged retained bytes\n{"unfinished":';
  await page.evaluate(raw => { localStorage.setItem('after-the-agent.saved.v2.damaged', raw); localStorage.setItem('unrelated.record', 'keep'); }, raw); await page.reload();
  await page.getByLabel('Saved attempt', { exact: true }).selectOption('damaged'); expect(await download(page, 'Download selected autosave')).toBe(raw);
  expect(await page.evaluate(() => localStorage.getItem('unrelated.record'))).toBe('keep'); await expect(page.getByRole('heading', { name: 'The agent handed it over. Can you keep it working?', exact: true })).toBeVisible();
});

test('notebook import preview works with keyboard at phone width and zoom without treating names as HTML', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await begin(page); await notebook(page);
  await page.getByLabel('Bookmark name', { exact: true }).fill('Preview source'); await page.getByRole('button', { name: 'Save current attempt', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Preview source', exact: true })).toBeVisible();
  const backup = JSON.parse(await download(page, 'Download notebook backup'));
  const name = '<img src=x onerror=alert(1)>' + 'x'.repeat(50); backup.entries[0] = { ...backup.entries[0], id: crypto.randomUUID(), name };
  await upload(page, 'Import notebook backup', JSON.stringify(backup));
  const preview = page.getByRole('region', { name: 'Notebook import preview', exact: true }); await expect(preview.getByText(name, { exact: true })).toBeVisible(); expect(await preview.locator('img').count()).toBe(0);
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; }); expect(await preview.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await expect(preview.getByRole('button', { name: 'Merge notebook backup', exact: true })).toBeEnabled(); await preview.getByRole('button', { name: 'Merge notebook backup', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible(); const region = page.locator('.attempt-notebook'); expect(await region.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await region.screenshot({ path: `${output}/notebook-phone-zoom.png` }); expect((await new AxeBuilder({ page }).include('.attempt-notebook').analyze()).violations).toEqual([]);
});

test('audit of an evicted entire cache does not recreate it or claim an unchanged update repaired it', async ({ page }) => {
  await page.goto('./'); await page.getByRole('button', { name: 'Enable offline edition', exact: true }).click(); await expect(page.getByRole('status').filter({ hasText: 'Offline edition ready' })).toBeVisible();
  const cache = await page.evaluate(async () => { const names = await caches.keys(), name = names.find(name => name.startsWith('after-the-agent:'))!; const count = (await (await caches.open(name)).keys()).length; await caches.delete(name); return { name, count }; });
  const section = page.getByRole('region', { name: 'Offline edition', exact: true });
  await section.getByRole('button', { name: 'Check saved offline files', exact: true }).click(); await expect(section.getByRole('status')).toContainText(`${cache.count} missing, 0 altered`);
  expect(await page.evaluate(() => caches.keys())).not.toContain(cache.name);
  await section.getByRole('button', { name: 'Check offline update', exact: true }).click(); await expect(section.getByRole('status')).toContainText(`${cache.count} missing, 0 altered`); await expect(section.getByRole('status')).not.toContainText('Offline edition ready');
});
