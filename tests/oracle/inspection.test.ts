import { afterEach, expect, it, vi } from 'vitest';
import type { DomainEvent, FrozenCandidate } from '../../packages/contracts/src/index.js';
import type { SubmissionRecord } from '../../packages/engine/src/session.js';
import { canonicalJson, sha256Json } from '../../packages/contracts/src/index.js';
import { candidate } from './candidate.js';
import { buildCorpus } from '../../packages/runner/src/continuations.js';
import { observeCandidate } from '../../packages/runner/src/evaluation-core.js';
import { inspectContinuation, traceJob, compareSubmissions } from '../../packages/runner/src/inspection.js';
import { inspectContinuationInWorker } from '../../apps/web/src/inspection/client.js';

const inspect = (c: FrozenCandidate, id = 'quiet-prefix') => inspectContinuation(c, buildCorpus(c), id);
const record = (c: FrozenCandidate): SubmissionRecord => ({ candidate: c, corpus: buildCorpus(c), admitted_at_ms: 10, evaluation: null });
it('preserves legitimate inherited pending work and never mutates caller data', () => {
  const c = candidate(), corpus = buildCorpus(c), before = canonicalJson([c, corpus]);
  const result = inspectContinuation(c, corpus, 'quiet-prefix');
  expect(result.frames[0]!.plant).toEqual(c.plant);
  expect(result.frames[0]!.plant.queue).toHaveLength(1);
  expect(result.frames[0]!.events).toEqual([]);
  expect(result.frames[1]).toMatchObject({ tick: 6, expected: { left: 1, right: 0, center: 0 }, observed: { left: 1, right: 0, center: 0 } });
  expect(result.first_mismatch_tick).toBeNull();
  expect(canonicalJson([c, corpus])).toBe(before);
});
it('counts a stale inherited delivery as extra and both duplicate pulses separately', () => {
  const stale = inspect(candidate('stale-queue'));
  expect(stale.frames[1]).toMatchObject({ expected: { left: 0 }, observed: { left: 1 } });
  expect(stale.first_mismatch_tick).toBe(6);
  const duplicate = inspect(candidate('duplicate-clock', [{ type: 'set_clock', clock: 'shadow', enabled: false }]));
  expect(duplicate.frames[0]!.plant.queue).toHaveLength(2);
  expect(duplicate.frames[1]).toMatchObject({ expected: { left: 1 }, observed: { left: 2 } });
  expect(duplicate.first_mismatch_tick).toBe(6);
});
it('retains tick-by-tick output through the final drain and matches the evaluator for every case', () => {
  const c = candidate('valid-pending', [{ type: 'advance', ticks: 1 }]), corpus = buildCorpus(c);
  for (const observation of observeCandidate(c, corpus)) {
    const result = inspectContinuation(c, corpus, observation.case_id);
    expect(result.frames.map(f => f.tick)).toEqual(Array.from({ length: 67 }, (_, i) => c.capture_tick + i));
    expect(result.frames.at(-1)!.tick).toBe(72);
    expect(result.frames.flatMap(f => f.events.filter(e => e.type === 'pulse').map(e => ({ tick: e.tick, lamp: e.lamp })))).toEqual(observation.pulses);
  }
  expect(inspectContinuation(c, corpus, 'quiet-prefix').frames.find(f => f.tick === 70)).toMatchObject({ expected: { left: 1 }, observed: { left: 1 } });
  expect(inspectContinuation(c, corpus, 'quiet-prefix').frames.at(-1)!.plant.queue).toEqual([]);
});
it('rejects unknown cases, substituted corpora and candidate hash changes', () => {
  const c = candidate(), corpus = buildCorpus(c);
  expect(() => inspectContinuation(c, corpus, 'invented')).toThrow();
  expect(() => inspectContinuation(c, { ...corpus, cases: corpus.cases.slice(1) }, 'quiet-prefix')).toThrow();
  const forged = { ...corpus, cases: corpus.cases.map((c, index) => index === 0 ? { ...c, transitions: [...c.transitions, { tick: 6, scene_id: 'forged', active: false }] } : c) };
  expect(() => inspectContinuation(c, forged, 'quiet-prefix')).toThrow();
  expect(() => inspectContinuation({ ...c, candidate_sha256: 'a'.repeat(64) }, corpus, 'quiet-prefix')).toThrow();
});
it('shows only actual job lineage and sequence-bounded intervening world changes', () => {
  const job = candidate().plant.queue[0]!;
  const events: DomainEvent[] = [
    { seq: 1, tick: 4, type: 'world_changed', world: { scene_id: 'before', active: true, epoch: 1 } },
    { seq: 2, tick: 4, type: 'job_enqueued', job },
    { seq: 3, tick: 5, type: 'world_changed', world: { scene_id: 'during', active: true, epoch: 2 } },
    { seq: 4, tick: 6, type: 'job_discarded', job_id: job.id, reason: 'epoch_mismatch' },
    { seq: 5, tick: 6, type: 'world_changed', world: { scene_id: 'after', active: false, epoch: 3 } },
  ];
  expect(traceJob(job.id, events, [])).toEqual({ job_id: job.id, job, enqueue_recorded: true, events: events.slice(1, 4), outcome: 'discarded' });
  expect(traceJob(job.id, [], [job])).toMatchObject({ enqueue_recorded: false, job, events: [], outcome: 'pending' });
  expect(traceJob(job.id, [{ seq: 1, tick: 6, type: 'pulse', job_id: job.id, lamp: 'left' }], [])).toMatchObject({ enqueue_recorded: false, job: null, outcome: 'delivered' });
  expect(traceJob(job.id, [{ seq: 1, tick: 5, type: 'jobs_dropped', job_ids: [job.id] }], [])).toMatchObject({ outcome: 'dropped' });
  expect(traceJob('unknown', events, [])).toMatchObject({ job: null, enqueue_recorded: false, events: [], outcome: 'unknown' });
  expect(traceJob(job.id, events.slice(0, 2), [])).toMatchObject({ enqueue_recorded: true, outcome: 'unknown' });
});
it('compares actual queue/cache/settings and warns on every changed evaluation context', () => {
  const before = record(candidate('duplicate-clock'));
  const after = record(candidate('duplicate-clock', [{ type: 'set_clock', clock: 'shadow', enabled: false }]));
  const same = compareSubmissions(before, after);
  expect(same.same_context).toBe(true);
  expect(same.changes).toContainEqual({ path: 'config.clocks.shadow', before: 'true', after: 'false' });
  expect(same.changes.some(c => c.path.startsWith('queue'))).toBe(false);
  expect(same.cases).toHaveLength(12);
  const changed: SubmissionRecord = { ...after, candidate: { ...after.candidate, attempt_id: 'another-attempt', capture_tick: 6, plant: { ...after.candidate.plant, tick: 6, world: { scene_id: 'other', active: false, epoch: 2 }, gate_cache: { active: false, epoch: 2 }, queue: [] } }, corpus: { ...after.corpus, cases: after.corpus.cases.slice(1) } };
  const comparison = compareSubmissions(before, changed);
  expect(comparison.same_context).toBe(false);
  expect(comparison.context_notes.join(' ')).toMatch(/attempt/i);
  expect(comparison.context_notes.join(' ')).toMatch(/tick/i);
  expect(comparison.context_notes.join(' ')).toMatch(/world/i);
  expect(comparison.context_notes.join(' ')).toMatch(/case/i);
  expect(comparison.changes.map(c => c.path)).toEqual(expect.arrayContaining(['tick', 'world.scene_id', 'gate_cache.active', 'queue.primary.4.left', 'queue.shadow.4.left']));
});

class FakeWorker {
  static latest: FakeWorker;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  request: { id: string; case_id: string; candidate: FrozenCandidate } | null = null;
  terminated = false;
  constructor() { FakeWorker.latest = this; }
  postMessage(request: NonNullable<FakeWorker['request']>) { this.request = request; }
  terminate() { this.terminated = true; }
  respond(data: unknown) { this.onmessage?.({ data } as MessageEvent); }
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it('binds worker responses to request/candidate/case and terminates after completion', async () => {
  vi.stubGlobal('Worker', FakeWorker);
  const c = candidate(), corpus = buildCorpus(c), result = inspectContinuation(c, corpus, 'quiet-prefix');
  const task = inspectContinuationInWorker(c, corpus, 'quiet-prefix'), worker = FakeWorker.latest;
  worker.respond({ id: 'stale', result, error: null });
  expect(worker.terminated).toBe(false);
  worker.respond({ id: worker.request!.id, result, error: null });
  expect(await task.promise).toEqual(result);
  expect(worker.terminated).toBe(true);
});
it('rejects malformed and misbound worker output instead of displaying it', async () => {
  vi.stubGlobal('Worker', FakeWorker);
  const c = candidate(), corpus = buildCorpus(c);
  for (const result of [{}, { ...inspect(c), candidate_sha256: 'a'.repeat(64) }, { ...inspect(c), case_id: 'active-cycle' }, { ...inspect(c), case_sha256: 'b'.repeat(64) }, { ...inspect(c), frames: inspect(c).frames.slice(0, -1) }]) {
    const task = inspectContinuationInWorker(c, corpus, 'quiet-prefix'), worker = FakeWorker.latest;
    worker.respond({ id: worker.request!.id, result, error: null });
    await expect(task.promise).rejects.toThrow();
    expect(worker.terminated).toBe(true);
  }
});
it('cancels, times out and terminates failed workers without retaining stale handlers', async () => {
  vi.stubGlobal('Worker', FakeWorker); vi.useFakeTimers();
  const c = candidate(), corpus = buildCorpus(c);
  const cancelled = inspectContinuationInWorker(c, corpus, 'quiet-prefix'), old = FakeWorker.latest;
  cancelled.cancel();
  await expect(cancelled.promise).rejects.toThrow(/cancel/i);
  expect(old.terminated).toBe(true); expect(old.onmessage).toBeNull();
  const timed = inspectContinuationInWorker(c, corpus, 'quiet-prefix');
  const rejection = expect(timed.promise).rejects.toThrow(/15-second/);
  await vi.advanceTimersByTimeAsync(15000); await rejection;
  expect(FakeWorker.latest.terminated).toBe(true);
  const failed = inspectContinuationInWorker(c, corpus, 'quiet-prefix');
  FakeWorker.latest.onerror?.();
  await expect(failed.promise).rejects.toThrow();
  expect(FakeWorker.latest.terminated).toBe(true);
  expect(sha256Json(c.plant)).toBe(c.candidate_sha256);
});
