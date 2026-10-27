import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
const begin = async (page: Page) => { await page.goto('./'); await page.getByRole('button', { name: 'Take over the lights' }).click(); await page.getByRole('button', { name: 'Begin takeover' }).click(); };
const open = async (page: Page) => { await page.getByRole('button', { name: 'Open attempt notebook', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Attempt notebook', exact: true })).toBeVisible(); };
async function save(page: Page, name = 'Earlier') {
  await open(page); await page.getByRole('button', { name: 'Enable notebook on this browser' }).click(); await page.getByLabel('Bookmark name').fill(name); await page.getByRole('button', { name: 'Save current attempt', exact: true }).click(); await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}
async function exported(page: Page, name = 'Earlier') { const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: `Export ${name}`, exact: true }).click(); return readFile((await (await downloading).path())!, 'utf8'); }
async function replaceEntries(page: Page, kind: 'count' | 'bytes' | 'corrupt') {
  await page.evaluate(async kind => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('after-the-agent.notebook.v1', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const original = await new Promise<Record<string, unknown>>((resolve, reject) => { const tx = db.transaction('bookmarks', 'readonly'), request = tx.objectStore('bookmarks').getAll(); request.onsuccess = () => resolve(request.result[0]); request.onerror = () => reject(request.error); });
    const count = kind === 'count' ? 20 : kind === 'bytes' ? 4 : 1;
    const raw = kind === 'bytes' ? JSON.stringify({ format: 'after-the-agent.resume', version: '1.0', session: { padding: 'x'.repeat(8 * 1024 * 1024 - 200) }, rehearsal_evidence: null }) : original.raw as string;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw)), sha256 = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
    await new Promise<void>((resolve, reject) => { const tx = db.transaction('bookmarks', 'readwrite'), store = tx.objectStore('bookmarks'); store.clear(); for (let index = 0; index < count; index++) store.add({ ...original, id: crypto.randomUUID(), name: `Retained ${index}`, raw: kind === 'corrupt' ? raw + ' ' : raw, bytes: new TextEncoder().encode(raw).length, sha256 }); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); db.close();
  }, kind);
}
test('opt-in notebook preserves immutable bytes across reload, export and delete', async ({ page }) => {
  await begin(page); await open(page); await expect(page.getByRole('button', { name: 'Save current attempt', exact: true })).toHaveCount(0); await page.getByRole('button', { name: 'Close notebook' }).click();
  await save(page); const original = await exported(page); const saved = JSON.parse(original); expect(saved.session.deadline_at_ms).toBe(saved.session.handover_at_ms + 300000);
  await page.locator('.attempt-notebook').screenshot({ path: 'evidence/ui-browser/screenshots/notebook.png' });
  await page.reload(); await open(page); await expect(page.getByRole('heading', { name: 'Earlier', exact: true })).toBeVisible(); expect(await exported(page)).toBe(original);
  await page.getByRole('button', { name: 'Delete Earlier', exact: true }).click(); await expect(page.getByText('No bookmarks saved.')).toBeVisible();
});
test('restoring an expired notebook bookmark retains the original deadline and terminal timeout', async ({ page }) => {
  await page.clock.install(); await begin(page); await save(page); const original = await exported(page); await page.clock.fastForward(300001);
  await page.getByRole('button', { name: 'Restore Earlier', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Recovery time ended.' })).toBeVisible(); await expect(page.getByRole('button', { name: 'Check repair', exact: true })).toBeDisabled();
  if (await page.getByRole('button', { name: 'Export Earlier', exact: true }).count() === 0) await open(page);
  expect(await exported(page)).toBe(original);
});
for (const kind of ['count', 'bytes'] as const) {
  test(`notebook reports its ${kind === 'count' ? '20 bookmark' : '32 MiB'} quota without adding a record`, async ({ page }) => {
    await begin(page); await save(page); await page.getByRole('button', { name: 'Close notebook' }).click(); await replaceEntries(page, kind); await open(page);
    await page.getByLabel('Bookmark name').fill('One too many'); await page.getByRole('button', { name: 'Save current attempt', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(kind === 'count' ? 'Notebook is full (20 bookmarks)' : '32 MiB quota');
    await expect(page.getByRole('heading', { name: 'One too many', exact: true })).toHaveCount(0);
  });
}
test('corrupt notebook record disables inspection export and restoration while permitting deletion', async ({ page }) => {
  await begin(page); await save(page); await page.getByRole('button', { name: 'Close notebook' }).click(); await replaceEntries(page, 'corrupt'); await open(page);
  await expect(page.getByRole('alert')).toContainText('Corrupt bookmark'); for (const action of ['Inspect', 'Export', 'Restore']) await expect(page.getByRole('button', { name: `${action} Retained 0`, exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Delete Retained 0', exact: true }).click(); await expect(page.getByText('No bookmarks saved.')).toBeVisible();
});
test('unavailable IndexedDB has explicit feedback after opt-in', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'indexedDB', { value: undefined })); await begin(page); await open(page); await page.getByRole('button', { name: 'Enable notebook on this browser' }).click(); await expect(page.getByRole('alert')).toContainText('IndexedDB is unavailable');
});
test('an out-of-range bookmark timestamp remains a deletable corrupt record', async ({ page }) => {
  await begin(page); await save(page); await page.getByRole('button', { name: 'Close notebook' }).click();
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('after-the-agent.notebook.v1', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    await new Promise<void>((resolve, reject) => { const tx = db.transaction('bookmarks', 'readwrite'), store = tx.objectStore('bookmarks'), request = store.getAll(); request.onsuccess = () => { const value = request.result[0]; store.put({ ...value, createdAt: 8640000000000001 }); }; tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); db.close();
  });
  await open(page); await expect(page.getByRole('alert')).toContainText('Corrupt bookmark');
  await page.getByRole('button', { name: 'Delete Corrupt bookmark', exact: true }).click(); await expect(page.getByText('No bookmarks saved.')).toBeVisible();
});
test('gallery identifies the fixture and keeps source selection disabled during recovery', async ({ page }) => {
  const gallery = JSON.parse(await readFile('apps/web/public/recordings/gallery.json', 'utf8'));
  gallery.entries = gallery.entries.filter((entry: { category: string }) => entry.category === 'fixture');
  await page.route('**/recordings/gallery.json', route => route.fulfill({ json: gallery }));
  await begin(page); await page.getByRole('button', { name: 'Open recording gallery', exact: true }).click();
  await expect(page.getByText('No qualified genuine model recording is currently available.', { exact: false })).toBeVisible(); await expect(page.getByText('Test fixture', { exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: 'Use Bundled stdio fixture', exact: true })).toBeDisabled(); await expect(page.getByRole('button', { name: 'Inspect Bundled stdio fixture', exact: true })).toBeEnabled();
  await page.locator('.recording-gallery').screenshot({ path: 'evidence/ui-browser/screenshots/gallery.png' });
});
test('notebook and gallery use readable text contrast in the actual application theme', async ({ page }) => {
  await begin(page); await save(page);
  expect((await new AxeBuilder({ page }).include('.attempt-notebook').analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Open recording gallery', exact: true }).click(); await expect(page.getByText('Test fixture', { exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).include('.recording-gallery').analyze()).violations).toEqual([]);
});
