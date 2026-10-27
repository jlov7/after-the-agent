import { afterEach, expect, test, vi } from 'vitest';
import { createSession, saveSession } from '../../packages/engine/src/session.js';
import { buildCorpus } from '../../packages/runner/src/continuations.js';
import { persistSession, listSavedAttempts, readSavedAttempt, removeSavedAttempt, storageKey, autosavePrefix, savedAttemptCountLimit } from '../../apps/web/src/session/persistence.js';
import { createAttemptOwnership } from '../../apps/web/src/session/ownership.js';
const memory = new Map<string, string>();
function storage() {
  memory.clear();
  vi.stubGlobal('localStorage', { get length() { return memory.size; }, key: (i: number) => [...memory.keys()][i] ?? null, getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => memory.set(key, value), removeItem: (key: string) => memory.delete(key) });
  vi.stubGlobal('navigator', { locks: { request: async (_: string, _options: unknown, callback: (lock: object) => unknown) => callback({}) } });
}
function session(now: number) { const value = createSession({ scenario: 'stale-queue', now: () => now }, async candidate => ({ status: 'pass', candidate_sha256: candidate.candidate_sha256, cases: [], observations: [] }), buildCorpus); value.start(); return value; }
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
test('distinct attempts retain both autosaves and never rewrite legacy bytes', async () => {
  storage(); const first = session(1000), second = session(2000), legacy = JSON.stringify(saveSession(first)); memory.set(storageKey, legacy);
  try { await persistSession(first); await persistSession(second); expect(listSavedAttempts()).toHaveLength(3); expect(memory.get(storageKey)).toBe(legacy); expect(JSON.parse(readSavedAttempt(second.getView().attempt_id)).deadline_at_ms).toBe(302000); await removeSavedAttempt(first.getView().attempt_id); expect(readSavedAttempt('legacy')).toBe(legacy); expect(listSavedAttempts()).toHaveLength(2); } finally { first.dispose(); second.dispose(); }
});
test('full autosave collection refuses a new attempt without deleting retained or corrupt entries', async () => {
  storage(); for (let index = 0; index < savedAttemptCountLimit; index++) memory.set(`${autosavePrefix}attempt.${index}.1`, 'corrupt');
  const current = session(5000), before = new Map(memory);
  try { await expect(persistSession(current)).rejects.toThrow('full'); expect(memory).toEqual(before); expect(listSavedAttempts().every(item => item.corrupt)).toBe(true); } finally { current.dispose(); }
});
test('a delayed save from the previous editing owner cannot overwrite the transferred attempt', async () => {
  storage(); const current = session(1000); let owner = true; let grant: (() => Promise<unknown>) | undefined;
  vi.stubGlobal('navigator', { locks: { request: (_: string, _options: unknown, callback: (lock: object) => Promise<unknown>) => new Promise((resolve, reject) => { grant = async () => { try { resolve(await callback({})); } catch (error) { reject(error); } }; }) } });
  const pending = persistSession(current, { canWrite: () => owner }); owner = false;
  try { await grant!(); await expect(pending).rejects.toThrow('ownership'); expect(memory.size).toBe(0); } finally { current.dispose(); }
});
test('storage and lock denial is explicit and retains the in-memory attempt', async () => {
  storage(); const current = session(1000); vi.stubGlobal('navigator', {});
  try { await expect(persistSession(current)).rejects.toThrow('Web Locks'); expect(current.getView().phase).toBe('recovery'); } finally { current.dispose(); }
});
test('disposing before a delayed ownership grant cannot reactivate the disposed session', async () => {
  let grant: (() => Promise<unknown>) | undefined; const statuses: string[] = [];
  vi.stubGlobal('navigator', { locks: { request: (_: string, _options: unknown, callback: (lock: object) => Promise<unknown>) => new Promise(resolve => { grant = async () => resolve(await callback({})); }) } });
  vi.stubGlobal('BroadcastChannel', undefined);
  const owner = createAttemptOwnership('attempt.1.1', status => statuses.push(status.state)), pending = owner.acquire(); let disposalFinished = false; const disposing = owner.dispose(); void disposing.then(() => { disposalFinished = true; }); await Promise.resolve(); expect(disposalFinished).toBe(false); await grant!(); await disposing; await pending;
  expect(statuses.at(-1)).toBe('released'); expect(statuses).not.toContain('owner');
});

test('aggregate UTF-8 quota refusal preserves the previous bytes of this attempt', async () => {
  storage(); const current = session(1000), id = current.getView().attempt_id;
  memory.set(`${autosavePrefix}${id}`, 'previous');
  for (let index = 0; index < 4; index++) memory.set(`${autosavePrefix}attempt.${index + 10}.1`, 'é'.repeat(4 * 1024 * 1024));
  try { await expect(persistSession(current)).rejects.toThrow('32 MiB'); expect(memory.get(`${autosavePrefix}${id}`)).toBe('previous'); expect(memory.size).toBe(5); } finally { current.dispose(); }
});

test('quota exception does not discard previously saved attempts', async () => {
  storage(); const current = session(1000); memory.set(storageKey, 'legacy bytes');
  vi.stubGlobal('localStorage', { get length() { return memory.size; }, key: (i: number) => [...memory.keys()][i] ?? null, getItem: (key: string) => memory.get(key) ?? null, setItem: () => { throw new Error('QuotaExceededError'); } });
  try { await expect(persistSession(current)).rejects.toThrow('QuotaExceededError'); expect(memory.get(storageKey)).toBe('legacy bytes'); } finally { current.dispose(); }
});

test('corrupt identifiers remain explicitly deletable without touching unrelated storage', async () => {
  storage(); memory.set(`${autosavePrefix}bad identity`, 'corrupt retained bytes'); memory.set('unrelated', 'keep');
  expect(readSavedAttempt('bad identity')).toBe('corrupt retained bytes'); await removeSavedAttempt('bad identity'); expect(memory.get('unrelated')).toBe('keep');
});

test('transfer pauses immediately and retains ownership until the latest accepted edit is saved', async () => {
  storage(); const channels: { onmessage: ((event: { data: string }) => void) | null }[] = [];
  vi.stubGlobal('BroadcastChannel', class { onmessage: ((event: { data: string }) => void) | null = null; constructor() { channels.push(this); } close() {} });
  const current = session(1000); let finishFlush: (() => void) | undefined; const states: string[] = [];
  const owner = createAttemptOwnership(current.getView().attempt_id, status => states.push(status.state), { beforeTransfer: async () => { await new Promise<void>(resolve => { finishFlush = resolve; }); await persistSession(current, { canWrite: owner.ownsLock }); } });
  try {
    await owner.acquire(); current.act({ type: 'set_epoch_guard', enabled: true }); channels[0]!.onmessage!({ data: 'request-transfer' }); await Promise.resolve();
    expect(states.at(-1)).toBe('readonly'); expect(owner.ownsLock()).toBe(true); finishFlush!();
    await vi.waitFor(() => expect(owner.ownsLock()).toBe(false));
    expect(JSON.parse(readSavedAttempt(current.getView().attempt_id)).commands).toEqual(saveSession(current).commands);
  } finally { owner.dispose(); current.dispose(); }
});

test('failed transfer flush keeps the lock and explicitly requires downloading the latest state', async () => {
  storage(); const channels: { onmessage: ((event: { data: string }) => void) | null }[] = []; let message = '';
  vi.stubGlobal('BroadcastChannel', class { onmessage: ((event: { data: string }) => void) | null = null; constructor() { channels.push(this); } close() {} });
  const owner = createAttemptOwnership('attempt.1.1', status => { message = status.message; }, { beforeTransfer: async () => { throw new Error('storage denied'); } });
  try { await owner.acquire(); channels[0]!.onmessage!({ data: 'request-transfer' }); await vi.waitFor(() => expect(message).toContain('Download')); expect(owner.ownsLock()).toBe(true); expect((await owner.acquire()).state).toBe('readonly'); } finally { owner.dispose(); }
});

test('diagnostics export only fixed feature states even when detail contains sensitive text', async () => {
  const { readinessDiagnostic } = await import('../../apps/web/src/session/readiness.js');
  const check = { state: 'failed' as const, detail: 'https://private.test /Users/private attempt contents participant text UA-fingerprint' };
  const raw = readinessDiagnostic({ localStorage: check, indexedDB: check, worker: check, serviceWorker: check });
  expect(JSON.parse(raw)).toEqual({ format: 'after-the-agent.browser-readiness', version: '1.0', checks: { localStorage: { state: 'failed' }, indexedDB: { state: 'failed' }, worker: { state: 'failed' }, serviceWorker: { state: 'failed' } } });
  expect(raw).not.toContain('private');
});

test('cancelled readiness probes do not touch storage or create a worker', async () => {
  storage(); vi.stubGlobal('crypto', undefined); const worker = vi.fn(); vi.stubGlobal('Worker', worker); vi.stubGlobal('indexedDB', undefined);
  const { probeBrowserReadiness } = await import('../../apps/web/src/session/readiness.js'); const controller = new AbortController(); controller.abort();
  const report = await probeBrowserReadiness(controller.signal); expect(Object.values(report).every(check => check.state === 'cancelled')).toBe(true); expect(memory.size).toBe(0); expect(worker).not.toHaveBeenCalled();
});

test('reset retirement survives deletion of saved bytes and prevents a second recovery allowance', async () => {
  storage(); const api = await import('../../apps/web/src/session/persistence.js'); const previous = session(1000), next = session(2000);
  try {
    await persistSession(previous); const raw = readSavedAttempt(previous.getView().attempt_id);
    await api.recordSavedDisposition(previous.getView().attempt_id, 'abandoned_reset'); await persistSession(next);
    expect(readSavedAttempt(previous.getView().attempt_id)).toBe(raw); expect(listSavedAttempts().find(item => item.attemptId === previous.getView().attempt_id)?.retired).toBe(true);
    await removeSavedAttempt(next.getView().attempt_id); await removeSavedAttempt(previous.getView().attempt_id);
    expect(() => api.assertAttemptResumable(previous.getView().attempt_id)).toThrow('abandoned'); expect(() => api.assertAttemptResumable(next.getView().attempt_id)).not.toThrow();
  } finally { previous.dispose(); next.dispose(); }
});

test('retirement refuses stale owners, invalid ledgers and a full history without losing dispositions', async () => {
  storage(); const api = await import('../../apps/web/src/session/persistence.js');
  await expect(api.recordSavedDisposition('attempt.1.1', 'abandoned_reset', { canWrite: () => false })).rejects.toThrow('ownership'); expect(memory.has(api.savedDispositionKey)).toBe(false);
  memory.set(api.savedDispositionKey, 'corrupt'); expect(() => api.assertAttemptResumable('attempt.1.1')).toThrow();
  const dispositions = Object.fromEntries(Array.from({ length: api.savedDispositionCountLimit }, (_, index) => [`attempt.${index}.1`, 'abandoned_reset'])); const raw = JSON.stringify({ version: '1.0', dispositions }); memory.set(api.savedDispositionKey, raw);
  await expect(api.recordSavedDisposition('attempt.999999.1', 'abandoned_reset')).rejects.toThrow('full'); expect(memory.get(api.savedDispositionKey)).toBe(raw);
  await expect(api.recordSavedDisposition('attempt.1.1', 'submitted')).rejects.toThrow('final'); expect(memory.get(api.savedDispositionKey)).toBe(raw);
});

test('disposal waits for actual lock release before a replacement adapter acquires the same attempt', async () => {
  let locked = false, finishRelease: (() => void) | undefined, gateFirstRelease = true;
  vi.stubGlobal('BroadcastChannel', undefined);
  vi.stubGlobal('navigator', { locks: { request: async (_: string, _options: unknown, callback: (lock: object | null) => Promise<unknown>) => {
    if (locked) return callback(null); locked = true; await callback({});
    if (gateFirstRelease) await new Promise<void>(resolve => { finishRelease = resolve; }); locked = false;
  } } });
  const first = createAttemptOwnership('attempt.1.1', () => {}), replacement = createAttemptOwnership('attempt.1.1', () => {});
  await first.acquire(); let disposed = false; const releasing = first.dispose(); expect(releasing).toBeInstanceOf(Promise); void releasing.then(() => { disposed = true; });
  await vi.waitFor(() => expect(finishRelease).toBeDefined()); expect(disposed).toBe(false); expect(locked).toBe(true);
  gateFirstRelease = false; finishRelease!(); await releasing; expect(locked).toBe(false); expect((await replacement.acquire()).state).toBe('owner'); await replacement.dispose();
});
