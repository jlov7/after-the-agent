import { expect, test, vi } from 'vitest';
import type { ContinuationCorpus, EvaluationResult, FrozenCandidate } from '../../packages/contracts/src/index.js';
import { compactAttemptExport, createSession, restoreSession, saveSession } from '../../packages/engine/src/session.js';
const corpus = (candidate: FrozenCandidate): ContinuationCorpus => ({ schema_version: '1.0', policy_version: '1.0.0', candidate_sha256: candidate.candidate_sha256, cases: [] });
const evaluate = async (candidate: FrozenCandidate): Promise<EvaluationResult> => ({ status: 'pass', candidate_sha256: candidate.candidate_sha256, cases: [], observations: [] });

test('normal maximum recovery fits practical storage and replays every receipt across refresh', async () => {
  vi.useFakeTimers(); let now = 1000;
  const session = createSession({ scenario: 'stale-queue', now: () => now }, evaluate, corpus);
  let resumed: ReturnType<typeof createSession> | undefined;
  try {
    session.start();
    for (let step = 1; step <= 600; step++) {
      now += 500; expect(session.step().outcome).toBe('accepted');
      if (step === 350 || step === 525) {
        const raw = JSON.stringify(saveSession(session));
        expect(Buffer.byteLength(raw, 'utf8')).toBeLessThan(1024 * 1024);
      }
    }
    await session.submit();
    const saved = saveSession(session), raw = JSON.stringify(saved);
    const exported = compactAttemptExport(session);
    expect(Buffer.byteLength(JSON.stringify(exported), 'utf8')).toBeLessThan(1024 * 1024);
    expect(exported.commands).toEqual(saved.commands);
    expect(exported.setup).toEqual(session.exportAttempt().setup);
    expect(exported.candidate).toEqual(session.exportAttempt().candidate);
    expect(exported.deadline_at_ms).toBe(saved.deadline_at_ms);
    expect(Buffer.byteLength(raw, 'utf8')).toBeLessThan(1024 * 1024);
    expect(raw.length * 2).toBeLessThan(5 * 1024 * 1024);
    resumed = restoreSession(JSON.parse(raw), evaluate, corpus, { now: () => now });
    expect(resumed.getView().plant).toEqual(session.getView().plant);
    expect(resumed.getView().history).toEqual(session.getView().history);
    expect(resumed.getView().phase).toBe('recovery');
    expect(resumed.getView().remaining_ms).toBe(0);
    expect(saveSession(resumed).deadline_at_ms).toBe(saved.deadline_at_ms);
    expect(resumed.exportAttempt().candidate).toEqual(session.exportAttempt().candidate);
    now++; expect(resumed.getView().phase).toBe('submitted');
    expect(saveSession(resumed).deadline_at_ms).toBe(saved.deadline_at_ms);
  } finally { session.dispose(); resumed?.dispose(); vi.useRealTimers(); }
}, 60000);

test('compact receipt commitments reject altered request, tick, order or result digest', () => {
  const session = createSession({ scenario: 'stale-queue', now: () => 1000 }, evaluate, corpus);
  try {
    session.start(); session.step(); const saved = saveSession(session);
    expect(() => restoreSession({ ...saved, schema_version: '1.0' }, evaluate, corpus, { now: () => 1000 })).toThrow();
    const mutations = [
      (value: Record<string, unknown>) => { value.result_sha256 = '0'.repeat(64); },
      (value: Record<string, unknown>) => { value.tick = 7; },
      (value: Record<string, unknown>) => { value.seq = 9; },
      (value: Record<string, unknown>) => { value.request = { schema_version: '1.0', request_id: 'session.1', expected_revision: 3, action: { type: 'advance', ticks: 2 } }; },
    ];
    for (const mutate of mutations) {
      const altered = structuredClone(saved); mutate(altered.commands.at(-1)! as unknown as Record<string, unknown>);
      expect(() => restoreSession(altered, evaluate, corpus, { now: () => 1000 })).toThrow();
    }
  } finally { session.dispose(); }
});
