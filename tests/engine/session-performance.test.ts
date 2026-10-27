import { afterEach, expect, test, vi } from 'vitest';
import type { ContinuationCorpus, EvaluationResult, FrozenCandidate } from '../../packages/contracts/src/index.js';
import { immutable } from '../../packages/engine/src/engine.js';
import { createSession, restoreSession, saveSession } from '../../packages/engine/src/session.js';
const sessions: ReturnType<typeof createSession>[] = [];
const corpus = (candidate: FrozenCandidate): ContinuationCorpus => ({ schema_version: '1.0', policy_version: '1.0.0', candidate_sha256: candidate.candidate_sha256, cases: [] });
const evaluate = async (candidate: FrozenCandidate): Promise<EvaluationResult> => ({ status: 'pass', candidate_sha256: candidate.candidate_sha256, cases: [], observations: [] });
afterEach(() => { sessions.forEach(s => s.dispose()); sessions.length = 0; vi.useRealTimers(); });

test('wall presentation reuses immutable history and physical data without changing a retained view', () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }); let now = 1000;
  const s = createSession({ scenario: 'stale-queue', now: () => now }, evaluate, corpus); sessions.push(s); s.start();
  const prior = s.getView(), priorJson = JSON.stringify(prior);
  now += 250; vi.advanceTimersByTime(250); const timed = s.getView();
  expect(timed.history[0]).toBe(prior.history[0]); expect(timed.events[0]).toBe(prior.events[0]); expect(timed.plant).toBe(prior.plant);
  s.step(); expect(s.getView().history[0]).toBe(prior.history[0]); expect(JSON.stringify(prior)).toBe(priorJson);
  expect(() => { prior.history[0]!.result.observation.plant.config.clocks.primary = false; }).toThrow();
  expect(() => { Object.defineProperty(prior.events, '0', { value: { ...prior.events[0], seq: 99 } }); }).toThrow();
});

test('shallow freezing caller data never authorizes sharing its mutable descendants', () => {
  const nested = { value: 1 }, input = Object.freeze({ nested }); const output = immutable(input);
  nested.value = 2; expect(output.nested.value).toBe(1); expect(output).not.toBe(input); expect(output.nested).not.toBe(nested);
  expect(() => { output.nested.value = 3; }).toThrow();
});

test('600 real run ticks with wall updates and autosave stay within a five-second processing budget', () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }); let now = 1000;
  const s = createSession({ scenario: 'stale-queue', now: () => now }, evaluate, corpus); sessions.push(s); s.start();
  const prior = s.getView(), priorJson = JSON.stringify(prior), deadline = saveSession(s).deadline_at_ms;
  const unlisten = s.subscribe(() => { saveSession(s); }); const began = performance.now(); s.run();
  try {
    for (let halfStep = 1; halfStep <= 1200; halfStep++) {
      now += 250; vi.advanceTimersByTime(250);
      if (halfStep % 200 === 0) expect(performance.now() - began).toBeLessThan(5000);
    }
    s.pause(); expect(s.getView().plant.tick).toBe(605); expect(s.getView().history).toHaveLength(603); expect(saveSession(s).deadline_at_ms).toBe(deadline); expect(JSON.stringify(prior)).toBe(priorJson);
  } finally { unlisten(); }
}, 15000);

test('restore serializes public checks through a single-active evaluator and preserves result order', async () => {
  const s = createSession({ scenario: 'stale-queue', now: () => 1000 }, evaluate, corpus); sessions.push(s); s.start(); await s.submit(); s.act({ type: 'set_epoch_guard', enabled: true }); await s.submit();
  const saved = saveSession(s); let active = false, maximum = 0, calls = 0;
  const singleActive = async (candidate: FrozenCandidate): Promise<EvaluationResult> => {
    if (active) return { ...await evaluate(candidate), status: 'worker_error', reason: 'Only one evaluation can run' };
    active = true; calls++; maximum = Math.max(maximum, Number(active)); await Promise.resolve(); await Promise.resolve(); active = false; return evaluate(candidate);
  };
  const restored = restoreSession(saved, singleActive, corpus, { now: () => 1000 }); sessions.push(restored);
  // submit returns the already running replay-scoring promise instead of adding a candidate.
  expect((await restored.submit()).status).toBe('pass');
  expect(calls).toBe(2); expect(maximum).toBe(1); expect(restored.exportAttempt().submissions.map(item => item.evaluation?.status)).toEqual(['pass', 'pass']); expect(restored.getView().evaluation?.status).toBe('pass'); expect(saveSession(restored).deadline_at_ms).toBe(saved.deadline_at_ms);
});
