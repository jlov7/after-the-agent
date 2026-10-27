import { afterEach, expect, test, vi } from 'vitest';
import type { ContinuationCorpus, EvaluationResult, FrozenCandidate, ScenarioFamily } from '../../packages/contracts/src/index.js';
import { createSession } from '../../packages/engine/src/session.js';
import { createScenario } from '../../packages/engine/src/scenarios.js';
import { dispatch, snapshot } from '../../packages/engine/src/engine.js';
import { createEditReceipt } from '../../packages/runner/src/edit-receipt.js';
const sessions: ReturnType<typeof createSession>[] = [];
let time = 1000;
const corpus = (candidate: FrozenCandidate): ContinuationCorpus => ({ schema_version: '1.0', policy_version: '1.0.0', candidate_sha256: candidate.candidate_sha256, cases: [] });
const evaluate = async (candidate: FrozenCandidate): Promise<EvaluationResult> => ({ status: 'pass', candidate_sha256: candidate.candidate_sha256, cases: [], observations: [] });
function session(mode: 'public' | 'local_rehearsal' = 'public', scenario: ScenarioFamily = 'stale-queue') { const s = createSession({ scenario, mode, now: () => time }, evaluate, corpus); sessions.push(s); s.start(); return s; }
afterEach(() => { sessions.forEach(s => s.dispose()); sessions.length = 0; vi.useRealTimers(); time = 1000; });
test('event run stops after the complete delivery tick, including simultaneous output', () => {
  vi.useFakeTimers(); const s = session('public', 'duplicate-clock'); s.runUntil('delivery'); vi.advanceTimersByTime(5000);
  expect(s.getView().plant.tick).toBe(6); expect(s.getView().running).toBe(false);
  expect(s.getView().events.at(-1)?.type).toBe('settled_tick'); expect(s.getView().latest_result?.events.filter(event => event.type === 'pulse')).toHaveLength(2);
  expect(s.getRunStop()).toMatchObject({ event: 'delivery', reason: 'matched', tick: 6, ticks: 1 });
});
test('event run has a finite unmatched bound and remains absent from rehearsal', () => {
  vi.useFakeTimers(); const s = session(); s.runUntil('discard'); vi.advanceTimersByTime(65000);
  expect(s.getView().plant.tick).toBe(133); expect(s.getRunStop()?.reason).toBe('tick_limit');
  const study = session('local_rehearsal'); study.runUntil('delivery'); expect(study.getView().running).toBe(false); expect(study.getRunStop()).toBeNull();
});
test('event runs stop on visibility, expiry, pause and rejection; ordinary run still runs past delivery', () => {
  vi.useFakeTimers(); const s = session(); s.runUntil('delivery'); s.setVisibility(true);
  expect(s.getRunStop()?.reason).toBe('hidden'); s.setVisibility(false); s.runUntil('delivery'); s.pause(); expect(s.getRunStop()?.reason).toBe('paused');
  s.run(); vi.advanceTimersByTime(1000); expect(s.getView().plant.tick).toBe(7); expect(s.getRunStop()).toBeNull(); s.pause();
  s.runUntil('delivery'); time += 300001; vi.advanceTimersByTime(500); expect(s.getRunStop()?.reason).toBe('expired');
});
test('edit receipts distinguish retained retry, no-op and rejection without inventing dropped work', () => {
  const { engine } = createScenario('duplicate-clock'), before = snapshot(engine);
  const request = { schema_version: '1.0' as const, request_id: 'edit', expected_revision: before.revision, action: { type: 'set_clock' as const, clock: 'shadow' as const, enabled: false } };
  const actor = { actor_id: 'test', role: 'human' as const, phase: 'recovery' as const };
  const result = dispatch(engine, request, actor), receipt = createEditReceipt(before, result);
  expect(receipt.status).toBe('applied'); expect(receipt.tick_before).toBe(receipt.tick_after); expect(receipt.retained_job_ids).toHaveLength(2);
  expect(receipt.changes).toEqual([{ path: 'config.clocks.shadow', before: 'true', after: 'false' }]);
  expect(createEditReceipt(snapshot(engine), dispatch(engine, request, actor)).status).toBe('retry');
  const noOpBefore = snapshot(engine), noop = dispatch(engine, { ...request, request_id: 'noop', expected_revision: noOpBefore.revision }, actor);
  expect(createEditReceipt(noOpBefore, noop).status).toBe('no_op');
  const current = snapshot(engine), rejected = dispatch(engine, { ...request, request_id: 'reject' }, actor);
  expect(createEditReceipt(current, rejected)).toMatchObject({ status: 'rejected', changes: [], retained_job_ids: current.queue.map(job => job.id) });
  expect(createEditReceipt(current, result)).toMatchObject({ status: 'retry', changes: [], tick_after: current.tick });
});
test('event run records a budget rejection after the last settled tick', () => {
  vi.useFakeTimers(); const s = session();
  for (let i = 0; i < 63; i++) expect(s.act({ type: 'advance', ticks: 64 }).outcome).toBe('accepted');
  s.act({ type: 'advance', ticks: 58 }); expect(s.getView().plant.tick).toBe(4095);
  s.runUntil('delivery'); vi.advanceTimersByTime(1000);
  expect(s.getRunStop()).toMatchObject({ reason: 'rejected', tick: 4096, ticks: 1 }); expect(s.getView().running).toBe(false);
});

test('discard run stops after an actual epoch discard without calling it a delivery', () => {
  vi.useFakeTimers(); const s = session(); s.act({ type: 'set_epoch_guard', enabled: true }); s.runUntil('discard'); vi.advanceTimersByTime(5000);
  expect(s.getRunStop()).toMatchObject({ event: 'discard', reason: 'matched', tick: 6, ticks: 1 });
  expect(s.getView().latest_result?.events.some(event => event.type === 'pulse')).toBe(false);
  expect(s.getView().events.at(-1)?.type).toBe('settled_tick');
});
test('scene stop stays paused with an explicit not-scheduled status when the live schedule has no future scene', () => {
  vi.useFakeTimers(); const s = session(), before = s.getView().plant;
  s.runUntil('scene_change'); vi.advanceTimersByTime(1000);
  expect(s.getRunStop()).toMatchObject({ event: 'scene_change', reason: 'not_scheduled', tick: 5, ticks: 0 });
  expect(s.getView().running).toBe(false); expect(s.getView().plant).toEqual(before);
  const rehearsal = session('local_rehearsal'); rehearsal.runUntil('scene_change'); expect(rehearsal.getRunStop()).toBeNull();
});
test.each([1, 3])('manual advance of %i ticks interrupts event-run before applying the canonical command', ticks => {
  vi.useFakeTimers(); const s = session('public', 'valid-pending'), before = s.getView().plant;
  s.runUntil('delivery');
  const result = ticks === 1 ? s.step() : s.act({ type: 'advance', ticks });
  expect(result.outcome).toBe('accepted'); expect(s.getView().running).toBe(false);
  expect(s.getRunStop()).toMatchObject({ event: 'delivery', reason: 'interrupted', tick: 5, ticks: 0 });
  expect(s.getView().plant.tick).toBe(5 + ticks); expect(s.getView().plant.revision).toBe(before.revision + 1);
  expect(result.events.filter(event => event.type === 'pulse')).toHaveLength(1);
  vi.advanceTimersByTime(5000); expect(s.getView().plant.tick).toBe(5 + ticks);
});
