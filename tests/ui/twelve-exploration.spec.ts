import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { authoredRecording } from '../replay/fixture.js';
import { createReplayNotes } from '../../packages/runner/src/replay-annotations.js';
const harness = process.env.TWELVE_EXPLORATION_HARNESS === '1';
async function open(page: Page, tool: 'lab' | 'replay') {
  if (harness) await page.goto('/work/twelve-exploration/');
  else {
    await page.goto('./'); await page.getByRole('button', { name: 'Take over the lights' }).click(); await page.getByRole('button', { name: 'Begin takeover' }).click();
    if (tool === 'lab') { await page.getByRole('button', { name: 'Check repair', exact: true }).click(); await expect(page.getByRole('button', { name: 'Check repair', exact: true })).toBeEnabled(); }
  }
  await page.locator(tool === 'lab' ? '#repair-lab-trigger' : '#replay-trigger').click();
}
test('same-base lab preserves the live control state and deadline, supports standby repair and frame navigation', async ({ page }) => {
  await page.clock.install(); await open(page, 'lab');
  const lab = page.getByRole('region', { name: 'Repair lab', exact: true });
  await expect(lab).toContainText('Both alternatives begin at tick 5');
  const liveSnapshot = async () => {
    const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'Save progress to a file', exact: true }).click();
    return JSON.parse(readFileSync((await (await downloading).path())!, 'utf8')).session;
  };
  const liveBefore = harness ? null : await liveSnapshot();
  const controlBefore = harness ? (await page.getByTestId('control-state').innerText()).replace(/, remaining \d+$/, '') : null;
  const two = lab.getByRole('region', { name: 'Alternative 2', exact: true });
  await two.getByLabel('Primary clock', { exact: true }).uncheck(); await two.getByLabel('Standby clock', { exact: true }).check();
  // The default production fault also needs its version guard repaired.
  if (!harness) { await lab.getByRole('region', { name: 'Alternative 1', exact: true }).getByLabel('Version guard', { exact: true }).check(); await two.getByLabel('Version guard', { exact: true }).check(); }
  await expect(two).toContainText('primary.4.left'); await expect(two).toContainText('Immediate configuration and state diff');
  await lab.getByRole('button', { name: 'Compare two alternatives' }).click(); await expect(lab.getByRole('status')).toContainText('Exploratory comparison complete');
  if (harness) await expect(two).toContainText('Exploratory continuation result: pass');
  await two.getByLabel('Continuation frame for alternative 2').fill('66'); await expect(two).toContainText('tick 71');
  const wallBefore = await page.evaluate(() => Date.now()); await page.clock.fastForward(10000);
  expect(await page.evaluate(() => Date.now()) - wallBefore).toBeGreaterThanOrEqual(10000);
  if (liveBefore) {
    const liveAfter = await liveSnapshot();
    expect(liveAfter.deadline_at_ms).toBe(liveBefore.deadline_at_ms); expect(liveAfter.plant_sha256).toBe(liveBefore.plant_sha256);
    expect(liveAfter.commands).toEqual(liveBefore.commands); expect(liveAfter.submissions).toEqual(liveBefore.submissions);
    await expect.poll(() => lab.locator(':scope > p > strong').evaluate((element, deadline: number) => Number(element.textContent!.split(' ')[0]) - Math.ceil(Math.max(0, deadline - Date.now()) / 1000), liveBefore.deadline_at_ms)).toBe(0);
  } else expect(Number((await lab.locator(':scope > p > strong').innerText()).split(' ')[0])).toBeLessThanOrEqual(290);
  if (harness) expect((await page.getByTestId('control-state').innerText()).replace(/, remaining \d+$/, '')).toBe(controlBefore);
  await expect(lab).toContainText('Stored checks and the live board are unchanged');
  await lab.getByRole('button', { name: 'Close repair lab' }).click(); await expect(lab).toHaveCount(0);
});
test('notes preserve exact source bytes, pin and navigate jobs, import separately and reject mismatched files', async ({ page }) => {
  await open(page, 'replay'); const raw = JSON.stringify(authoredRecording());
  const viewer = page.getByRole('region', { name: 'Read-only replay', exact: true });
  await viewer.getByLabel('Replay file type').selectOption('recording'); await viewer.getByLabel('Open replay file').setInputFiles({ name: 'source.json', mimeType: 'application/json', buffer: Buffer.from(raw) });
  await expect(viewer).toContainText('Command replay: verified'); await viewer.getByRole('button', { name: 'Final state', exact: true }).click();
  const notes = viewer.getByRole('region', { name: 'Replay notes', exact: true });
  await notes.getByLabel('Pin note to').selectOption({ label: 'Command 3 · job primary.4.left' });
  await notes.getByLabel('Plain-text replay note').fill('<img src=x onerror=alert(1)>'); await notes.getByRole('button', { name: 'Add pinned note' }).click();
  await expect(notes.locator('img')).toHaveCount(0); await expect(notes).toContainText('<img src=x onerror=alert(1)>');
  const downloading = page.waitForEvent('download'); await notes.getByRole('button', { name: 'Download replay notes' }).click(); const notesRaw = readFileSync((await (await downloading).path())!, 'utf8');
  expect(JSON.parse(notesRaw)).toEqual(createReplayNotes(raw, [{ anchor: { kind: 'job', position: 3, identifier: 'primary.4.left' }, text: '<img src=x onerror=alert(1)>' }]));
  await viewer.getByRole('button', { name: 'Initial state', exact: true }).click(); await notes.getByRole('button', { name: 'Command 3 · job primary.4.left', exact: true }).click(); await expect(viewer.getByRole('heading', { name: 'Settled tick 5', exact: true })).toBeVisible();
  await notes.getByLabel('Import replay notes').setInputFiles({ name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from(notesRaw) }); await expect(notes.getByRole('status')).toContainText('Every pin matches');
  const originalDownload = page.waitForEvent('download'); await viewer.getByRole('button', { name: 'Download inspected file' }).click(); expect(readFileSync((await (await originalDownload).path())!, 'utf8')).toBe(raw);
  const bad = { ...JSON.parse(notesRaw), source_sha256: '0'.repeat(64) }; await notes.getByLabel('Import replay notes').setInputFiles({ name: 'wrong.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bad)) }); await expect(notes.getByRole('status')).toContainText('source hash does not match');
  await expect(viewer).toContainText('fixture recording. No model provenance.');
});
test('exploration tools reflow on a narrow viewport and expose named keyboard controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await open(page, 'lab'); const lab = page.getByRole('region', { name: 'Repair lab', exact: true });
  await expect(lab).toBeVisible();
  expect((await new AxeBuilder({ page }).include('.repair-lab').analyze()).violations).toEqual([]);
  expect(await lab.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: 'evidence/twelve/exploration/repair-lab-mobile.png', fullPage: true });
  await lab.getByRole('button', { name: 'Close repair lab' }).click(); await page.locator('#replay-trigger').click();
  const viewer = page.getByRole('region', { name: 'Read-only replay', exact: true }); await viewer.getByLabel('Replay file type').selectOption('recording'); await viewer.getByLabel('Open replay file').setInputFiles({ name: 'source.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(authoredRecording())) }); await expect(viewer).toContainText('Command replay: verified');
  expect((await new AxeBuilder({ page }).include('.replay-notes').analyze()).violations).toEqual([]);
  await viewer.getByLabel('Plain-text replay note').focus(); await page.keyboard.type('Keyboard note'); await viewer.getByRole('button', { name: 'Add pinned note' }).focus(); await page.keyboard.press('Enter'); await expect(viewer).toContainText('Keyboard note');
});
test('switching the shared base clears edits before applying old job identifiers to a new candidate', async ({ page }) => {
  // Production integration creates two retained checks through the actual session.
  await open(page, 'lab');
  const lab = page.getByRole('region', { name: 'Repair lab', exact: true });
  if (!harness) {
    await lab.getByRole('button', { name: 'Close repair lab' }).click();
    await page.getByRole('button', { name: 'Step', exact: true }).click();
    await page.getByRole('button', { name: 'Check repair', exact: true }).click(); await expect(page.getByRole('button', { name: 'Check repair', exact: true })).toBeEnabled();
    await page.locator('#repair-lab-trigger').click();
  }
  await lab.getByLabel('Shared frozen check').selectOption('0');
  const first = lab.getByRole('region', { name: 'Alternative 1', exact: true });
  await first.getByRole('button', { name: harness ? 'Drop shadow.4.left' : 'Drop primary.4.left', exact: true }).click();
  await lab.getByLabel('Shared frozen check').selectOption('1');
  await expect(lab).toBeVisible(); await expect(first).toContainText('0 of 32 repair edits'); await expect(first).toContainText('No changes from the shared base.');
});
test('pending replay notes import locks edits through file reading and worker validation, and cancellation ignores late reads', async ({ page }) => {
  await page.addInitScript(() => {
    const original = File.prototype.arrayBuffer;
    const state = globalThis as typeof globalThis & { releaseNotesRead?: () => void };
    File.prototype.arrayBuffer = function () {
      if (this.name !== 'delayed-notes.json') return original.call(this);
      return new Promise<ArrayBuffer>(resolve => { state.releaseNotesRead = () => { void original.call(this).then(resolve); }; });
    };
  });
  await open(page, 'replay');
  const raw = JSON.stringify(authoredRecording()), viewer = page.getByRole('region', { name: 'Read-only replay', exact: true });
  await viewer.getByLabel('Replay file type').selectOption('recording');
  await viewer.getByLabel('Open replay file').setInputFiles({ name: 'source.json', mimeType: 'application/json', buffer: Buffer.from(raw) });
  await expect(viewer).toContainText('Command replay: verified');
  const notes = viewer.getByRole('region', { name: 'Replay notes', exact: true }), text = notes.getByLabel('Plain-text replay note'), add = notes.getByRole('button', { name: 'Add pinned note' });
  await text.fill('Existing local note'); await add.click(); await text.fill('Draft kept during import');
  const imported = createReplayNotes(raw, [{ anchor: { kind: 'command', position: 0 }, text: 'Imported replacement' }]);
  const file = { name: 'delayed-notes.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)) };
  let releaseWorker = () => {}, workerRequested = () => {};
  const workerGate = new Promise<void>(resolve => { releaseWorker = resolve; }), workerStarted = new Promise<void>(resolve => { workerRequested = resolve; });
  await page.route('**/annotations.worker*', async route => { workerRequested(); await workerGate; await route.continue(); });
  await notes.getByLabel('Import replay notes').setInputFiles(file);
  await expect(notes.getByRole('status')).toContainText('Validating source hash');
  await expect(add).toBeDisabled(); await expect(notes.getByRole('button', { name: 'Remove note 1', exact: true })).toBeDisabled(); await expect(text).toBeDisabled(); await expect(notes.getByLabel('Pin note to')).toBeDisabled();
  await page.evaluate(() => (globalThis as typeof globalThis & { releaseNotesRead?: () => void }).releaseNotesRead?.());
  await workerStarted;
  await expect(add).toBeDisabled(); await expect(notes.getByRole('button', { name: 'Remove note 1', exact: true })).toBeDisabled();
  releaseWorker(); await expect(notes.getByRole('status')).toContainText('Every pin matches');
  await expect(text).toHaveValue('Draft kept during import'); await expect(add).toBeEnabled(); await expect(notes).toContainText('Imported replacement'); await expect(notes).not.toContainText('Existing local note');
  await notes.getByRole('button', { name: 'Remove note 1', exact: true }).click(); await add.click(); await expect(notes).toContainText('Draft kept during import');
  await notes.getByLabel('Import replay notes').setInputFiles(file); await expect(notes.getByRole('button', { name: 'Cancel notes import' })).toBeVisible();
  await notes.getByRole('button', { name: 'Cancel notes import' }).click(); await expect(text).toBeEnabled();
  await text.fill('Acknowledged after cancellation'); await add.click();
  await page.evaluate(() => (globalThis as typeof globalThis & { releaseNotesRead?: () => void }).releaseNotesRead?.());
  await expect(notes.getByRole('status')).toContainText('Note added in memory'); await expect(notes).toContainText('Acknowledged after cancellation'); await expect(notes).toContainText('Draft kept during import'); await expect(notes).not.toContainText('Imported replacement');
  await notes.getByLabel('Import replay notes').setInputFiles(file); await expect(notes.getByRole('button', { name: 'Cancel notes import' })).toBeVisible();
  await viewer.getByLabel('Open replay file').setInputFiles({ name: 'replacement-source.json', mimeType: 'application/json', buffer: Buffer.from(raw + '\n') });
  await expect(viewer).toContainText('Command replay: verified'); await page.evaluate(() => (globalThis as typeof globalThis & { releaseNotesRead?: () => void }).releaseNotesRead?.());
  await expect(notes).toContainText('0 of 256 notes'); await expect(text).toHaveValue(''); await expect(notes).not.toContainText('Imported replacement'); await expect(notes.getByRole('status')).toContainText('Notes are local and unsaved');
});
