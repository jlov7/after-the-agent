import { expect, test, vi } from 'vitest';
import { createSession, restoreSession, saveSession } from '../../packages/engine/src/session.js';
import { persistSession, checkSavedAttemptSize, savedAttemptByteLimit, autosavePrefix } from '../../apps/web/src/session/persistence.js';
import { buildCorpus } from '../../packages/runner/src/continuations.js';
import { evaluateCandidate } from '../../packages/runner/src/evaluate-browser.js';
import { parseResumableAttempt, serializeResumableAttempt } from '../../apps/web/src/session/resumable.js';

test('128 legal checks above 2 MB restore every candidate with the original deadline and receipt validation', async () => {
  let now = 1000;
  const evaluate = async (...args: Parameters<typeof evaluateCandidate>) => evaluateCandidate(...args);
  const session = createSession({ scenario: 'stale-queue', now: () => now }, evaluate, buildCorpus);
  let restored: ReturnType<typeof restoreSession> | undefined;
  try {
    session.start(); session.act({ type: 'set_epoch_guard', enabled: true });
    for (let check = 0; check < 128; check++) expect((await session.submit()).status).toBe('pass');
    const raw = serializeResumableAttempt(session, null);
    const setItem = vi.fn(); vi.stubGlobal('localStorage', { setItem, getItem: () => null, length: 0, key: () => null });
    vi.stubGlobal('navigator', { locks: { request: async (_name: string, _options: unknown, callback: () => unknown) => callback() } });
    await persistSession(session, { now: () => now });
    expect(setItem).toHaveBeenCalledWith(autosavePrefix + session.getView().attempt_id, JSON.stringify(saveSession(session)));
    checkSavedAttemptSize(setItem.mock.calls[0]![1]);
    expect(new TextEncoder().encode(raw).length).toBeGreaterThan(2_000_000);
    const parsed = parseResumableAttempt(raw); now += 23000;
    restored = restoreSession(parsed.session, evaluate, buildCorpus, { now: () => now });
    expect((await restored.submit()).status).toBe('pass');
    expect(saveSession(restored).submissions).toHaveLength(128);
    expect(restored.getView().plant).toEqual(session.getView().plant);
    expect(restored.getView().remaining_ms).toBe(277000);
    expect(saveSession(restored).deadline_at_ms).toBe(saveSession(session).deadline_at_ms);
    const forged = structuredClone(parsed.session) as ReturnType<typeof saveSession>;
    (forged.commands[0]! as unknown as Record<string, unknown>).result_sha256 = '0'.repeat(64);
    expect(() => restoreSession(forged, evaluate, buildCorpus, { now: () => now })).toThrow();
  } finally { session.dispose(); restored?.dispose(); vi.unstubAllGlobals(); }
}, 30000);

test('resume producers reject oversized output and the shared cap counts UTF-8 bytes', () => {
  const session = createSession({ scenario: 'stale-queue', now: () => 1000 }, async candidate => ({ status: 'pass', candidate_sha256: candidate.candidate_sha256, cases: [], observations: [] }), buildCorpus);
  try {
    expect(() => checkSavedAttemptSize('x'.repeat(savedAttemptByteLimit))).not.toThrow();
    expect(() => parseResumableAttempt('é'.repeat(savedAttemptByteLimit / 2 + 1))).toThrow('8 MiB');
    expect(() => serializeResumableAttempt(session, 'x'.repeat(savedAttemptByteLimit))).toThrow('8 MiB');
  } finally { session.dispose(); }
});
