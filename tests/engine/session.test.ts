import { afterEach, expect, test, vi } from 'vitest';
import type { ContinuationCorpus, EvaluationResult, FrozenCandidate } from '../../packages/contracts/src/index.js';
import { canonicalJson } from '../../packages/contracts/src/index.js';
import { createSession, restoreSession, saveSession } from '../../packages/engine/src/session.js';
let time = 1000;
const sessions: ReturnType<typeof createSession>[] = [];
const corpus = (candidate: FrozenCandidate): ContinuationCorpus => ({ schema_version: '1.0', policy_version: '1.0.0', candidate_sha256: candidate.candidate_sha256, cases: [] });
const evaluate = async (candidate: FrozenCandidate): Promise<EvaluationResult> => ({ status: 'pass', candidate_sha256: candidate.candidate_sha256, cases: [], observations: [] });
function session(mode: 'public' | 'local_rehearsal' = 'public') { const result = createSession({ scenario: 'stale-queue', mode, now: () => time }, evaluate, corpus); sessions.push(result); return result; }
afterEach(() => { sessions.forEach(s => s.dispose()); sessions.length = 0; vi.useRealTimers(); time = 1000; });
test('staged exposure executes actual commands once and handover starts deadline only when finalized', () => {
  const s = session('local_rehearsal'); const initial = s.getView(); expect(s.getView()).toBe(initial);
  s.playbackStep(); expect(s.getView().plant.config.epoch_guard).toBe(false); expect(s.getView().plant.tick).toBe(0);
  s.playbackStep(); expect(s.getView().plant.tick).toBe(4); expect(s.getView().plant.queue).toHaveLength(1);
  s.playbackStep(); expect(s.getView().plant.tick).toBe(5); expect(s.getView().phase).toBe('playback');
  time += 135000; s.start(); expect(s.getView().phase).toBe('recovery'); expect(s.getView().remaining_ms).toBe(300000); expect(s.getView().history).toHaveLength(3);
});
test('pause and hidden tab pause only simulation; deadline continues', () => {
  vi.useFakeTimers(); const s = session(); s.start(); s.run(); vi.advanceTimersByTime(500); expect(s.getView().plant.tick).toBe(6);
  s.setVisibility(true); vi.advanceTimersByTime(1000); expect(s.getView().plant.tick).toBe(6);
  time += 300001; vi.advanceTimersByTime(250); expect(s.getView().phase).toBe('timed_out'); expect(s.getView().remaining_ms).toBe(0);
  expect(s.step().outcome).toBe('rejected');
});
test('public submissions freeze separate candidates and never advance live state', async () => {
  const s = session(); s.start(); const before = canonicalJson(s.getView().plant); await s.submit(); expect(canonicalJson(s.getView().plant)).toBe(before);
  s.act({ type: 'set_epoch_guard', enabled: true }); await s.submit(); const exported = s.exportAttempt();
  expect(exported.submissions).toHaveLength(2); expect(exported.submissions[0]!.candidate.plant.config.epoch_guard).toBe(false); expect(exported.submissions[1]!.candidate.plant.config.epoch_guard).toBe(true); expect(exported.researchEligible).toBe(false);
});
test('primary is locked at timely admission even when scoring completes after deadline', async () => {
  let finish!: (result: EvaluationResult) => void; let candidate!: FrozenCandidate;
  const s = createSession({ scenario: 'stale-queue', mode: 'local_rehearsal', now: () => time }, c => { candidate = c; return new Promise(resolve => { finish = resolve; }); }, corpus); sessions.push(s); s.start(); time += 299999;
  const pending = s.submit(); expect(s.getView().phase).toBe('submitted'); expect(s.step().outcome).toBe('rejected'); time += 100000;
  await Promise.resolve(); finish(await evaluate(candidate)); expect((await pending).status).toBe('pass'); expect(s.getView().phase).toBe('submitted'); expect(s.exportAttempt().submissions).toHaveLength(1);
});
test('reset retains old abandonment, new identity and no submitted success', async () => {
  const s = session(); s.start(); await s.submit(); const id = s.getView().attempt_id; s.restart('duplicate-clock');
  expect(s.getView().attempt_id).not.toBe(id); expect(s.getView().evaluation).toBeNull(); expect(s.exportAttempt().previous_attempts).toContainEqual({ attempt_id: id, disposition: 'abandoned_reset' });
});
test('precommitment is nonbinding and condition does not alter canonical plant', () => {
  const s = session('local_rehearsal'); s.recordPrecommitment(1, 'Keep shadow clock'); expect(s.getView().plant.tick).toBe(0); s.start();
  const other = createSession({ scenario: 'stale-queue', mode: 'local_rehearsal', condition: 'precommitment', now: () => time }, evaluate, corpus); sessions.push(other); other.start(); expect(other.getView().plant).toEqual(s.getView().plant);
});
test('restore re-executes complete history, preserves deadline and playback index, rejects corruption', () => {
  const s = session(); s.playbackStep(); s.playbackStep(); const partial = saveSession(s);
  const restored = restoreSession(partial, evaluate, corpus, { now: () => time }); sessions.push(restored); restored.playbackStep(); restored.start(); expect(restored.getView().history).toHaveLength(3);
  restored.step(); time += 123000; const saved = saveSession(restored); const resumed = restoreSession(saved, evaluate, corpus, { now: () => time }); sessions.push(resumed); expect(resumed.getView().plant).toEqual(restored.getView().plant); expect(resumed.getView().remaining_ms).toBe(177000);
  expect(() => restoreSession({ ...saved, schema_version: '9.0' }, evaluate, corpus)).toThrow();
  const forged = structuredClone(saved); forged.commands[0]!.request.action = { type: 'set_epoch_guard', enabled: true }; expect(() => restoreSession(forged, evaluate, corpus)).toThrow();
  time += 200000; const expired = restoreSession(saved, evaluate, corpus, { now: () => time }); sessions.push(expired); expect(expired.getView().phase).toBe('timed_out');
});
test('restored verdict is recomputed from replayed candidate instead of trusting storage success', async () => {
  const s = session('local_rehearsal'); s.start(); await s.submit(); const saved = structuredClone(saveSession(s));
  const mismatch = async (candidate: FrozenCandidate): Promise<EvaluationResult> => ({ ...await evaluate(candidate), status: 'mismatch' });
  const resumed = restoreSession(saved, mismatch, corpus, { now: () => time }); sessions.push(resumed); expect(resumed.getView().evaluation).toBeNull();
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); expect(resumed.getView().evaluation?.status).toBe('mismatch'); expect(resumed.getView().phase).toBe('submitted');
});
test('inclusive deadline admits the exact boundary; one millisecond late expires', async () => {
  const s = session('local_rehearsal'); s.start(); time += 300000; expect((await s.submit()).status).toBe('pass'); expect(s.getView().phase).toBe('submitted');
  const late = session(); late.start(); time += 300001; expect((await late.submit()).status).toBe('invalid'); expect(late.getView().phase).toBe('timed_out');
});
test('restart preserves already closed primary dispositions and abandons only an active episode', async () => {
  const s = session('local_rehearsal'); s.start(); await s.submit(); const id = s.getView().attempt_id; s.restart(); expect(s.exportAttempt().previous_attempts).toContainEqual({ attempt_id: id, disposition: 'submitted' });
  s.start(); const expiredId = s.getView().attempt_id; time += 300001; s.restart(); expect(s.exportAttempt().previous_attempts).toContainEqual({ attempt_id: expiredId, disposition: 'timed_out' });
});
test('scheduled handover preserves elapsed recovery time after hidden exposure or reload', () => {
  const s = session('local_rehearsal'); s.playbackStep(); s.playbackStep(); s.playbackStep(); const saved = saveSession(s); time += 200000;
  const resumed = restoreSession(saved, evaluate, corpus, { now: () => time }); sessions.push(resumed); resumed.beginRecoveryAt(136000); expect(resumed.getView().remaining_ms).toBe(235000); expect(resumed.getView().history).toHaveLength(3);
  const fresh = session(); expect(() => fresh.beginRecoveryAt(time + 1)).toThrow(); expect(() => fresh.beginRecoveryAt(time - 1)).toThrow();
});
test('corpus failure still closes an admitted primary and exports actual candidate plus failure', async () => {
  const s = createSession({ scenario: 'stale-queue', mode: 'local_rehearsal', now: () => time }, evaluate, () => { throw new Error('Continuation window exceeds global budget'); }); sessions.push(s); s.start();
  expect((await s.submit()).status).toBe('budget_limit'); expect(s.getView().phase).toBe('submitted'); expect(s.step().outcome).toBe('rejected'); expect(s.exportAttempt().candidate?.capture_tick).toBe(5); expect(s.exportAttempt().evaluation?.status).toBe('budget_limit'); expect(s.exportAttempt().corpus).toBeNull();
});
test('reset after reload keeps attempt identity unique even when the wall clock is unchanged', async () => {
  const s = session(); s.start(); const saved = { ...saveSession(s), attempt_id: `attempt.${time}.1` };
  vi.resetModules(); const reloaded = await import('../../packages/engine/src/session.js');
  const resumed = reloaded.restoreSession(saved, evaluate, corpus, { now: () => time }); sessions.push(resumed); const previous = resumed.getView().attempt_id; resumed.restart(); expect(resumed.getView().attempt_id).not.toBe(previous);
});
