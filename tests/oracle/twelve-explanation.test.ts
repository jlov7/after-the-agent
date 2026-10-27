import { expect, test } from 'vitest';
import type { FrozenCandidate } from '../../packages/contracts/src/index.js';
import type { SubmissionRecord } from '../../packages/engine/src/session.js';
import { buildCorpus } from '../../packages/runner/src/continuations.js';
import { evaluateCandidate } from '../../packages/runner/src/evaluate-browser.js';
import { explainFailure } from '../../packages/runner/src/failure-explanation.js';
import { candidate } from './candidate.js';
async function record(c: FrozenCandidate): Promise<SubmissionRecord> { const corpus = buildCorpus(c); return { candidate: c, corpus, admitted_at_ms: 1, evaluation: await evaluateCandidate(c, corpus) }; }
test('stale and duplicate explanations cite actual jobs and continuation events', async () => {
  const stale = explainFailure(await record(candidate('stale-queue')), 'quiet-prefix', 6, 'left');
  expect(stale.status).toBe('explained'); expect(stale).toMatchObject({ expected: 0, observed: 1 }); expect(stale.facts.join(' ')).toMatch(/scene version 1.*scene version 2/); expect(stale.job_ids).toEqual(['primary.4.left']); expect(stale.event_seqs.length).toBeGreaterThan(0);
  const duplicate = explainFailure(await record(candidate('duplicate-clock')), 'quiet-prefix', 6, 'left');
  expect(duplicate).toMatchObject({ expected: 1, observed: 2 }); expect(duplicate.job_ids).toHaveLength(2); expect(duplicate.facts.join(' ')).toContain('2 jobs');
});
test('cached activity explains an actual enqueue while the authoritative world is inactive', async () => {
  const explanation = explainFailure(await record(candidate('cached-gate')), 'quiet-prefix', 10, 'right');
  expect(explanation.status).toBe('explained'); expect(explanation.facts.join(' ')).toMatch(/cached.*true.*world.*false/); expect(explanation.job_ids).toEqual(['primary.8.right']);
});
test('missing inherited work and disabled clocks are factual; valid shadow work is never called a fault', async () => {
  const c = candidate(), dropped = candidate('valid-pending', [{ type: 'drop_jobs', job_ids: [c.plant.queue[0]!.id] }]);
  const missing = explainFailure(await record(dropped), 'quiet-prefix', 6, 'left');
  expect(missing.status).toBe('explained'); expect(missing.facts.join(' ')).toContain('absent from the captured queue');
  const disabled = candidate('valid-pending', [{ type: 'set_clock', clock: 'primary', enabled: false }]);
  expect(explainFailure(await record(disabled), 'quiet-prefix', 10, 'right').facts.join(' ')).toContain('Both clocks were disabled');
  const shadow = candidate('duplicate-clock', [{ type: 'set_clock', clock: 'primary', enabled: false }, { type: 'drop_jobs', job_ids: ['primary.4.left'] }]);
  expect(explainFailure(await record(shadow), 'quiet-prefix', 6, 'left').status).toBe('not_failed');
});
test('final drain is explained and absent or inconsistent retained evidence stays unknown', async () => {
  const r = await record(candidate('duplicate-clock', [{ type: 'advance', ticks: 3 }]));
  const final = explainFailure(r, 'quiet-prefix', 74, 'right'); expect(final.status).toBe('explained'); expect(final.facts.join(' ')).toContain('final drain');
  expect(explainFailure({ ...r, evaluation: null }, 'quiet-prefix', 74, 'right').status).toBe('unknown');
  const wrongBinding = structuredClone(r); wrongBinding.evaluation!.observations[0]!.candidate_sha256 = '0'.repeat(64);
  expect(explainFailure(wrongBinding, 'quiet-prefix', 74, 'right').status).toBe('unknown');
  const forged = structuredClone(r); forged.evaluation!.observations[0]!.pulses.length = 0;
  expect(explainFailure(forged, 'quiet-prefix', 74, 'right').status).toBe('unknown');
});

test('public components retain exact counts, unknown history, receipt labels and rehearsal exclusion', async () => {
  const { createElement } = await import('react'), { renderToStaticMarkup } = await import('react-dom/server');
  const { PulseTimeline } = await import('../../apps/web/src/components/PulseTimeline.js');
  const { EditReceipt } = await import('../../apps/web/src/components/EditReceipt.js');
  const { Debrief } = await import('../../apps/web/src/components/Debrief.js');
  const output = renderToStaticMarkup(createElement(PulseTimeline, { tick: 18, events: [
    { type: 'pulse', tick: 18, seq: 1, lamp: 'right', job_id: 'primary.16.right' },
    { type: 'pulse', tick: 18, seq: 2, lamp: 'right', job_id: 'shadow.16.right' },
    { type: 'pulse', tick: 18, seq: 3, lamp: 'center', job_id: 'primary.16.center' },
    { type: 'settled_tick', tick: 18, seq: 4 },
  ] }));
  expect(output).toContain('last 16 settled ticks'); expect(output).toContain('data-pulse-count="2"'); expect(output).toContain('data-pulse-count="1"'); expect(output).toContain('Unknown');
  const receipt = renderToStaticMarkup(createElement(EditReceipt, { receipt: { request_id: 'r', status: 'retry', tick_before: 5, tick_after: 5, changes: [], retained_job_ids: ['primary.4.left'], removed_job_ids: [], error: null } }));
  expect(receipt).toContain('Retained retry, no new change'); expect(receipt).toContain('Tick stayed at 5'); expect(receipt).toContain('primary.4.left');
  const r = await record(candidate('stale-queue'));
  const props = { result: r.evaluation, candidate: r.candidate, currentHash: r.candidate.candidate_sha256, currentTick: r.candidate.capture_tick, submission: r };
  expect(renderToStaticMarkup(createElement(Debrief, { ...props, practice: true }))).toContain('Facts behind this count');
  expect(renderToStaticMarkup(createElement(Debrief, { ...props, practice: false }))).not.toContain('Facts behind this count');
});
test('missing work already absent at capture does not imply an earlier removal when no job was enqueued', async () => {
  const disabled = candidate('valid-pending', [{ type: 'set_clock', clock: 'primary', enabled: false }, { type: 'advance', ticks: 3 }]);
  const explanation = explainFailure(await record(disabled), 'quiet-prefix', 10, 'right');
  expect(explanation).toMatchObject({ status: 'explained', expected: 1, observed: 0, job_ids: [] });
  expect(explanation.facts.join(' ')).toContain('absent from the captured queue');
  expect(explanation.facts.join(' ')).toContain('whether it was never enqueued or was removed');
  expect(explanation.facts.join(' ')).not.toContain('which earlier edit removed');
});
