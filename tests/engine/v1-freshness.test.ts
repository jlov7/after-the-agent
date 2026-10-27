import { afterEach, expect, test, vi } from 'vitest';
import { createSession, saveSession, restoreSession, validateSavedSession, type SavedSession } from '../../packages/engine/src/session.js';
import { buildCorpus } from '../../packages/runner/src/continuations.js';
import { evaluateCandidate as evaluateCandidateInBrowser } from '../../packages/runner/src/evaluate-browser.js';
import { assertSessionExtends } from '../../apps/web/src/session/monotonic.js';
import { assertLatestSession, persistSession, autosavePrefix } from '../../apps/web/src/session/persistence.js';
import { createAttemptOwnership } from '../../apps/web/src/session/ownership.js';
const memory = new Map<string, string>();
afterEach(() => { vi.unstubAllGlobals(); });
function storage() {
  memory.clear();
  vi.stubGlobal('localStorage', { get length() { return memory.size; }, key: (index: number) => [...memory.keys()][index] ?? null, getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => memory.set(key, value) });
  vi.stubGlobal('navigator', { locks: { request: async (_name: string, _options: unknown, run: (lock: object) => unknown) => run({}) } });
}
const make = () => createSession({ scenario: 'stale-queue', now: () => 1000 }, evaluateCandidateInBrowser, buildCorpus);
test('stale setup and divergent commands cannot roll a known attempt back', () => {
  const current = make(), setup = saveSession(current); current.start(); const before = saveSession(current);
  current.act({ type: 'set_epoch_guard', enabled: true }); const after = saveSession(current);
  try {
    expect(() => assertSessionExtends(after, setup, 301001)).toThrow('older');
    expect(() => assertSessionExtends(after, before, 1000)).toThrow('older');
    const divergent = structuredClone(after); (divergent.commands as unknown[])[after.commands.length - 1] = before.commands[0];
    expect(() => assertSessionExtends(after, divergent, 1000)).toThrow('diverges');
  } finally { current.dispose(); }
});
test('a known submission cannot disappear while telemetry and recomputed verdicts may change', async () => {
  const current = make(); current.start(); current.act({ type: 'set_epoch_guard', enabled: true }); const unchecked = saveSession(current); await current.submit(); const checked = saveSession(current);
  try {
    expect(() => assertSessionExtends(checked, unchecked, 1000)).toThrow('older');
    const recomputing = { ...checked, visibility: [{ at_ms: 1200, hidden: true }], submissions: checked.submissions.map(item => ({ ...item, evaluation: null })) };
    expect(() => assertSessionExtends(checked, recomputing, 1000)).not.toThrow();
    expect(() => assertSessionExtends(checked, { ...recomputing, handover_at_ms: 2000, deadline_at_ms: 302000 }, 1000)).toThrow('older');
  } finally { current.dispose(); }
});
test('a recovery autosave may expire on restore without losing its original deadline', () => {
  const current = make(); current.start(); const saved = saveSession(current);
  const expired = restoreSession(saved, evaluateCandidateInBrowser, buildCorpus, { now: () => 301001 });
  try { expect(expired.getView().phase).toBe('timed_out'); expect(() => assertSessionExtends(saved, saveSession(expired), 301001)).not.toThrow(); } finally { current.dispose(); expired.dispose(); }
});
test('a delayed stale autosave is rejected under the storage lock without overwriting bytes', async () => {
  storage(); const current = make(); current.start(); const earlier = saveSession(current);
  current.act({ type: 'set_epoch_guard', enabled: true }); await persistSession(current, { now: () => 1000 }); const retained = memory.get(autosavePrefix + earlier.attempt_id);
  const stale = restoreSession(earlier, evaluateCandidateInBrowser, buildCorpus, { now: () => 1000 });
  try { await expect(persistSession(stale, { now: () => 1000 })).rejects.toThrow('older'); expect(memory.get(autosavePrefix + earlier.attempt_id)).toBe(retained); } finally { current.dispose(); stale.dispose(); }
});
test('corrupt same-ID bytes are retained for download rather than overwritten', async () => {
  storage(); const current = make(); current.start(); const key = autosavePrefix + current.getView().attempt_id;
  await persistSession(current, { now: () => 1000 });
  const corrupt = { ...saveSession(current), plant_sha256: '0'.repeat(64) }; memory.set(key, JSON.stringify(corrupt));
  try { await expect(persistSession(current)).rejects.toThrow('invalid'); expect(memory.get(key)).toBe(JSON.stringify(corrupt)); } finally { current.dispose(); }
});
test('initial ownership rechecks after grant and never enables a stale board; transfer may load the latest', async () => {
  storage(); vi.stubGlobal('BroadcastChannel', class { onmessage = null; postMessage() {} close() {} });
  const current = make(); current.start(); const earlier = saveSession(current), stale = restoreSession(earlier, evaluateCandidateInBrowser, buildCorpus, { now: () => 1000 });
  current.act({ type: 'set_epoch_guard', enabled: true }); await persistSession(current, { now: () => 1000 });
  const states: string[] = [], owner = createAttemptOwnership(earlier.attempt_id, value => states.push(value.state), { beforeAcquire: () => assertLatestSession(stale, { now: () => 1000 }) });
  try {
    expect((await owner.acquire()).state).toBe('readonly'); expect(states).not.toContain('owner'); expect(owner.ownsLock()).toBe(false);
    expect((await owner.requestTransfer()).state).toBe('owner');
  } finally { await owner.dispose(); current.dispose(); stale.dispose(); }
});
test('disposal during freshness validation cannot later publish owner', async () => {
  storage(); vi.stubGlobal('BroadcastChannel', undefined);
  let finish: (() => void) | undefined; const states: string[] = [];
  const owner = createAttemptOwnership('attempt.1000.1', value => states.push(value.state), { beforeAcquire: () => new Promise<void>(resolve => { finish = resolve; }) });
  const acquiring = owner.acquire(); await vi.waitFor(() => expect(finish).toBeDefined()); const disposing = owner.dispose(); finish!(); await acquiring; await disposing; expect(states).not.toContain('owner');
});
test('pending check recomputation preserves the retained verdict until its replacement arrives', async () => {
  storage(); const current = make(); current.start(); await current.submit(); const before = saveSession(current); await persistSession(current, { now: () => 1000 });
  expect(before.submissions[0]!.evaluation).not.toBeNull();
  let finish: ((value: NonNullable<SavedSession['submissions'][number]['evaluation']>) => void) | undefined;
  const resumed = restoreSession(before, () => new Promise(resolve => { finish = resolve; }), buildCorpus, { now: () => 1000 });
  try {
    await persistSession(resumed, { now: () => 1000 });
    expect(JSON.parse(memory.get(autosavePrefix + before.attempt_id)!).submissions).toEqual(before.submissions);
    finish!(before.submissions[0]!.evaluation!); await vi.waitFor(() => expect(resumed.getView().submitting).toBe(false)); await persistSession(resumed, { now: () => 1000 });
  } finally { resumed.dispose(); current.dispose(); }
});
test('pure saved-session validation checks receipt and plant commitments without evaluation calls', () => {
  const current = make(); current.start(); const saved = saveSession(current);
  try { expect(validateSavedSession(saved, buildCorpus)).toBe(saved); expect(() => validateSavedSession({ ...saved, plant_sha256: '0'.repeat(64) }, buildCorpus)).toThrow('commitment'); } finally { current.dispose(); }
});
test('a first check admitted before deadline still saves when its storage lock arrives after deadline', async () => {
  storage(); let now = 1000;
  const current = createSession({ scenario: 'stale-queue', now: () => now }, evaluateCandidateInBrowser, buildCorpus);
  current.start(); await persistSession(current, { now: () => now });
  now = 300999; await current.submit();
  let grant: (() => void) | undefined;
  vi.stubGlobal('navigator', { locks: { request: (_name: string, _options: unknown, run: () => unknown) => new Promise((resolve, reject) => { grant = () => { try { resolve(run()); } catch (error) { reject(error); } }; }) } });
  try {
    const saving = persistSession(current, { now: () => now }); now = 301001;
    const assertion = expect(saving).resolves.toBeUndefined(); grant!(); await assertion;
    const stored = JSON.parse(memory.get(autosavePrefix + current.getView().attempt_id)!);
    expect(stored.submissions).toHaveLength(1); expect(stored.submissions[0].admitted_at_ms).toBe(300999); expect(stored.deadline_at_ms).toBe(301000);
    expect(stored.phase).toBe('recovery'); // Capture phase. Restore applies the original elapsed deadline.
    const resumed = restoreSession(stored, evaluateCandidateInBrowser, buildCorpus, { now: () => now });
    try { expect(resumed.getView().phase).toBe('submitted'); } finally { resumed.dispose(); }
  } finally { current.dispose(); }
});
test('two FIFO saves crossing deadline cannot let the older zero-check snapshot retire a timely check', async () => {
  storage(); let now = 1000;
  const current = createSession({ scenario: 'stale-queue', now: () => now }, evaluateCandidateInBrowser, buildCorpus);
  current.start(); await persistSession(current, { now: () => now });
  const grants: (() => void)[] = [];
  vi.stubGlobal('navigator', { locks: { request: (_name: string, _options: unknown, run: () => unknown) => new Promise((resolve, reject) => { grants.push(() => { try { resolve(run()); } catch (error) { reject(error); } }); }) } });
  try {
    now = 300998; current.act({ type: 'set_epoch_guard', enabled: true }); const older = persistSession(current, { now: () => now });
    now = 300999; await current.submit(); const timely = persistSession(current, { now: () => now });
    const first = expect(older).resolves.toBeUndefined(), second = expect(timely).resolves.toBeUndefined();
    now = 301001; grants[0]!(); await first; grants[1]!(); await second;
    const stored = JSON.parse(memory.get(autosavePrefix + current.getView().attempt_id)!);
    expect(stored.submissions).toHaveLength(1); expect(stored.submissions[0].admitted_at_ms).toBe(300999); expect(stored.deadline_at_ms).toBe(301000);
    const resumed = restoreSession(stored, evaluateCandidateInBrowser, buildCorpus, { now: () => now });
    try { expect(resumed.getView().phase).toBe('submitted'); } finally { resumed.dispose(); }
  } finally { current.dispose(); }
});
test('a delayed recovery copy cannot demote an explicitly saved terminal phase', async () => {
  storage(); let now = 1000;
  const current = createSession({ scenario: 'stale-queue', now: () => now }, evaluateCandidateInBrowser, buildCorpus);
  current.start(); await current.submit(); const earlier = saveSession(current);
  const delayed = restoreSession(earlier, evaluateCandidateInBrowser, buildCorpus, { now: () => 1000 });
  try {
    now = 301001; await persistSession(current, { now: () => now });
    await persistSession(delayed, { now: () => now });
    const stored = JSON.parse(memory.get(autosavePrefix + current.getView().attempt_id)!);
    expect(stored.phase).toBe('submitted'); expect(stored.submissions).toHaveLength(1);
  } finally { delayed.dispose(); current.dispose(); }
});
