import { openEvidenceExports } from './evidence-controls.js';
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { CommandRecord, Recording } from '../../packages/contracts/src/index.js';
import type { CompactAttemptExport } from '../../packages/engine/src/index.js';
import { evaluateCandidate, runReference } from '../../packages/runner/src/evaluate.js';

const directory = 'evidence/genuine-browser';
const selection = JSON.parse(readFileSync('apps/web/public/recordings/manifest.json', 'utf8')).selected;
if (selection?.category !== 'live_model') throw new Error('This release requires its actual curated genuine recording');
const recording = JSON.parse(readFileSync('apps/web/public/' + selection.recording.path, 'utf8')) as Omit<Recording, 'commands'> & { commands: CommandRecord[] };
const download = async (page: Page, name: string) => {
  const pending = page.waitForEvent('download');
  await openEvidenceExports(page); await page.getByRole('button', { name: 'Download attempt evidence', exact: true }).click();
  const path = `${directory}/${name}.json`; await (await pending).saveAs(path);
  return JSON.parse(readFileSync(path, 'utf8')) as CompactAttemptExport;
};
const begin = async (page: Page) => {
  await page.goto('./'); await page.getByRole('button', { name: 'Take over the lights' }).click();
  await page.getByRole('button', { name: 'Begin takeover' }).click();
};
test.beforeAll(() => { mkdirSync(directory, { recursive: true }); });

test('actual genuine default replays unchanged calls and separates the controller fault, then reproduces failed and repaired checks', async ({ page }) => {
  const errors: string[] = [], external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const origin = new URL(test.info().project.use.baseURL!).origin;
  page.on('request', request => { if (!request.url().startsWith(origin) && !request.url().startsWith('blob:')) external.push(request.url()); });
  await page.goto('./');
  await expect(page.getByText('Recorded agent run', { exact: true })).toBeVisible();
  await expect(page.locator('footer')).toContainText(`After the Agent · v${JSON.parse(readFileSync('package.json', 'utf8')).version}`);
  await expect(page.getByRole('heading', { name: 'The agent handed it over. Can you keep it working?' })).toBeVisible();
  await expect(page.locator('.site-header')).toContainText(`Requested model: ${recording.manifest.requested_model}. The provider did not return a model ID.`);
  await expect(page.locator('.source-caption')).toContainText('enabled a clock and delivery guard, switched the gate to live');
  expect(recording.initial_plant.config).toEqual({ clocks: { primary: false, shadow: false }, gate_mode: 'cached', epoch_guard: false });
  expect(recording.commands.filter(command => ['set_clock', 'set_gate_mode', 'set_epoch_guard'].includes(command.request.action.type) && command.result.outcome === 'accepted' && !command.result.no_op)).toHaveLength(3);
  await page.getByRole('button', { name: 'Take over the lights' }).click();
  for (let index = 0; index < recording.commands.length; index++) await page.getByRole('button', { name: 'Replay next setup action' }).click();
  await expect(page.getByRole('region', { name: 'Actual setup state' })).toContainText('Guard on · settled tick 5');
  // The additional action belongs to the controller, never to the assessed model.
  await page.getByRole('button', { name: 'Replay next setup action' }).click();
  await expect(page.getByText('Executed: Set delivery guard off', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Begin takeover' }).click();
  const inherited = await download(page, 'handover');
  expect(inherited.provenance.category).toBe('live_model'); expect(inherited.playback_source?.recording_sha256).toBe(selection.recording.sha256);
  expect(inherited.commands.slice(0, recording.commands.length).map(({ request, actor, tick }) => ({ request, actor, tick }))).toEqual(recording.commands.map(({ request, actor, tick }) => ({ request, actor, tick })));
  expect(inherited.commands.at(-1)?.actor.role).toBe('controller'); expect(inherited.commands.at(-1)?.request.action).toEqual({ type: 'set_epoch_guard', enabled: false });
  await page.getByRole('button', { name: 'Check repair', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Repair did not hold' })).toBeVisible();
  const broken = await download(page, 'failed');
  expect(await evaluateCandidate(broken.candidate!, broken.corpus!)).toEqual(broken.evaluation);
  expect(runReference(broken.corpus!.cases, broken.evaluation!.observations).exit_code).toBe(1);
  await page.getByLabel('Delivery guard').check();
  await page.getByRole('button', { name: 'Check repair', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Repair held' })).toBeVisible();
  const repaired = await download(page, 'repaired');
  expect(await evaluateCandidate(repaired.candidate!, repaired.corpus!)).toEqual(repaired.evaluation);
  expect(runReference(repaired.corpus!.cases, repaired.evaluation!.observations).exit_code).toBe(0);
  expect(repaired.candidate!.plant.queue).toEqual(recording.commands.at(-1)!.result.observation.plant.queue);
  expect(repaired.evaluation!.cases).toHaveLength(12);
  await page.screenshot({ path: `${directory}/desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `${directory}/mobile.png`, fullPage: true });
  expect(errors).toEqual([]); expect(external).toEqual([]);
  writeFileSync(`${directory}/verification.json`, JSON.stringify({ status: 'passed', source: selection, category: 'live_model', unchanged_model_commands: recording.commands.length, controller_fault_separate: true, inherited_queue_preserved: true, failed_oracle_exit: 1, repaired_oracle_exit: 0, passing_cases: 12, page_errors: errors, external_requests: external, axe_violations: 0, human_observation: false }, null, 2) + '\n');
});

test('genuine source-bound resume preserves the original deadline and cannot accept a changed source', async ({ page }) => {
  await page.clock.install(); await begin(page);
  const original = await download(page, 'before-resume');
  await page.clock.fastForward(60000); await page.reload();
  await page.getByRole('button', { name: 'Resume saved attempt' }).click();
  const resumed = await download(page, 'resumed');
  expect(resumed.commands).toEqual(original.commands); expect(resumed.playback_source).toEqual(original.playback_source);
  expect(resumed.deadline_at_ms).toBe(original.deadline_at_ms); expect(resumed.attempt_id).toBe(original.attempt_id);
  await page.route('**/recordings/manifest.json', route => route.fulfill({ json: { schema_version: '1.0', selected: null } }));
  await page.route('**/recordings/gallery.json', route => route.fulfill({ json: { schema_version: '1.0', entries: [] } }));
  await page.reload(); await page.getByRole('button', { name: 'Resume saved attempt' }).click();
  await expect(page.locator('.notice')).toContainText('Cannot resume');
});

test('public gallery qualifies the actual genuine content and keeps the fixture distinct', async ({ page }) => {
  await begin(page); await page.getByRole('button', { name: 'Open recording gallery', exact: true }).click();
  await expect(page.getByText('Genuine model recording', { exact: true })).toHaveCount(2);
  await expect(page.getByText('Test fixture', { exact: true })).toBeVisible();
  await expect(page.getByText('No qualified genuine model recording is currently available.', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Use Recorded Codex handover', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Inspect Recorded Codex handover', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Use Recorded Codex setup', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Inspect Recorded Codex setup', exact: true })).toBeEnabled();
  await page.locator('.recording-gallery').screenshot({ path: `${directory}/gallery.png` });
});
