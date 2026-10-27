import { z } from 'zod';
import { saveSession, validateSavedSession, type SavedSession, type SessionRestoreOptions, type ExtendedBoardSession } from '../../../../packages/engine/src/index.js';
import { buildCorpus } from '../../../../packages/runner/src/continuations.js';
import { parseStrictJson } from '../../../../packages/runner/src/strict-json.js';
import { assertSessionExtends } from './monotonic.js';
export const storageKey = 'after-the-agent.saved.v1';
export const autosavePrefix = 'after-the-agent.saved.v2.';
export const savedAttemptByteLimit = 8 * 1024 * 1024;
export const savedAttemptCountLimit = 20;
export const savedAttemptsTotalByteLimit = 32 * 1024 * 1024;
const attemptId = /^attempt\.\d+\.\d+$/;
export const savedDispositionKey = 'after-the-agent.dispositions.v1';
export const savedDispositionCountLimit = 10000;
const dispositionByteLimit = 1024 * 1024;
const dispositionSchema = z.enum(['abandoned_reset', 'submitted', 'timed_out']);
export type SavedDisposition = z.infer<typeof dispositionSchema>;
const dispositionLedger = z.object({ version: z.literal('1.0'), dispositions: z.record(z.string().regex(attemptId), dispositionSchema) }).strict();
const bytes = (raw: string) => new TextEncoder().encode(raw).length;
export interface SavedAttemptSummary {
  id: string; attemptId: string | null; scenario: string; phase: string; bytes: number; legacy: boolean; corrupt: boolean; retired: boolean; disposition: SavedDisposition | null;
}
export function checkSavedAttemptSize(raw: string) {
  if (bytes(raw) > savedAttemptByteLimit) throw new Error('Saved attempt exceeds 8 MiB.');
}
function keyFor(id: string) {
  if (id === 'legacy') return storageKey;
  // Even corrupt entry identifiers remain explicitly readable and deletable within this prefix.
  return `${autosavePrefix}${id}`;
}
function entries(): { key: string; raw: string }[] {
  const values: { key: string; raw: string }[] = [];
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (key !== null && (key === storageKey || key.startsWith(autosavePrefix))) {
      const raw = localStorage.getItem(key); if (raw !== null) values.push({ key, raw });
    }
  }
  return values;
}
/** Summaries are hints only. Root must replay and validate bytes before restoring. */
export function listSavedAttempts(): SavedAttemptSummary[] {
  const dispositions = readDispositions();
  return entries().map(({ key, raw }) => {
    const legacy = key === storageKey, id = legacy ? 'legacy' : key.slice(autosavePrefix.length);
    const base = { id, attemptId: null, scenario: 'Unknown fault', phase: 'unavailable', bytes: bytes(raw), legacy, corrupt: true, retired: dispositions[id] === 'abandoned_reset', disposition: dispositions[id] ?? null };
    try {
      checkSavedAttemptSize(raw); const value = JSON.parse(raw) as Record<string, unknown>;
      if (!value || typeof value !== 'object' || typeof value.attempt_id !== 'string' || !attemptId.test(value.attempt_id) || (!legacy && value.attempt_id !== id) || !['stale-queue', 'duplicate-clock', 'cached-gate'].includes(String(value.scenario)) || !['setup', 'playback', 'recovery', 'submitted', 'timed_out', 'abandoned_reset'].includes(String(value.phase))) return base;
      return { ...base, retired: dispositions[value.attempt_id] === 'abandoned_reset', disposition: dispositions[value.attempt_id] ?? null, attemptId: value.attempt_id, scenario: String(value.scenario), phase: String(value.phase), corrupt: false };
    } catch { return base; }
  }).sort((a, b) => a.id.localeCompare(b.id));
}
export function readSavedAttempt(id: string): string {
  const raw = localStorage.getItem(keyFor(id));
  if (raw === null) throw new Error('Saved attempt is unavailable.');
  checkSavedAttemptSize(raw); return raw;
}
function withStorageLock<T>(run: () => T): Promise<T> {
  if (typeof navigator === 'undefined' || !navigator.locks) return Promise.reject(new Error('Web Locks are unavailable. Autosave is disabled; download this attempt.'));
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 2000);
  return navigator.locks.request('after-the-agent.autosave.v2', { signal: controller.signal }, () => { clearTimeout(timer); return run(); }).finally(() => clearTimeout(timer));
}
let lastValidated: { raw: string; saved: SavedSession; source: SessionRestoreOptions['playbackSource'] } | null = null;
function retainedSession(saved: SavedSession, options: SessionRestoreOptions): SavedSession | null {
  const raw = localStorage.getItem(keyFor(saved.attempt_id));
  if (raw === null) return null;
  if (lastValidated?.raw === raw && lastValidated.source === options.playbackSource) return lastValidated.saved;
  try {
    checkSavedAttemptSize(raw); const value = validateSavedSession(parseStrictJson(raw), buildCorpus, options);
    lastValidated = { raw, saved: value, source: options.playbackSource }; return value;
  }
  catch { throw new Error('The retained copy of this attempt is invalid. Download its raw autosave before explicitly deleting it.'); }
}
/** Run again after the editing lock is granted. Preflight alone cannot exclude another tab's later edit. */
export function assertLatestSession(session: ExtendedBoardSession, options: SessionRestoreOptions = {}): Promise<void> {
  return withStorageLock(() => {
    const saved = saveSession(session); assertAttemptResumable(saved.attempt_id);
    const retained = retainedSession(saved, options);
    if (retained) assertSessionExtends(retained, saved, (options.now ?? Date.now)());
  });
}
export function assertRestoreExtends(current: ExtendedBoardSession, incoming: ExtendedBoardSession): void {
  const before = saveSession(current), after = saveSession(incoming);
  if (before.attempt_id === after.attempt_id) assertSessionExtends(before, after, Date.now());
}
export function persistSession(session: ExtendedBoardSession, options: SessionRestoreOptions & { canWrite?: () => boolean } = {}): Promise<void> {
  if (session.getView().phase === 'setup' && session.exportAttempt().previous_attempts.length === 0) return Promise.resolve();
  // Capture synchronously. A later session action must not change this queued write's bytes.
  const saved = saveSession(session), raw = JSON.stringify(saved); checkSavedAttemptSize(raw);
  return withStorageLock(() => {
    if (options.canWrite && !options.canWrite()) throw new Error('Editing ownership changed. This stale autosave was not written.');
    const key = keyFor(saved.attempt_id), retained = entries(), existing = retained.find(item => item.key === key);
    if (!existing && retained.length >= savedAttemptCountLimit) throw new Error('Autosave is full (20 entries). Download or explicitly delete a saved attempt.');
    const total = retained.reduce((sum, item) => sum + bytes(item.raw), 0) - (existing ? bytes(existing.raw) : 0) + bytes(raw);
    if (total > savedAttemptsTotalByteLimit) throw new Error('Autosave exceeds its 32 MiB quota. Download or explicitly delete a saved attempt.');
    assertAttemptResumable(saved.attempt_id);
    const previous = retainedSession(saved, options);
    if (previous) assertSessionExtends(previous, saved, (options.now ?? Date.now)());
    // Revalidation clears verdicts while a worker recomputes. Do not erase the retained receipt meanwhile.
    // A queued snapshot cannot infer finality for a later admitted check. Preserve only observed finality.
    const phase = previous && ['submitted', 'timed_out', 'abandoned_reset'].includes(previous.phase) ? previous.phase : saved.phase;
    const stored = { ...saved, phase, submissions: saved.submissions.map((item, index) => ({ ...item, evaluation: item.evaluation ?? previous?.submissions[index]?.evaluation ?? null })) };
    const storedRaw = JSON.stringify(stored); checkSavedAttemptSize(storedRaw);
    if (total - bytes(raw) + bytes(storedRaw) > savedAttemptsTotalByteLimit) throw new Error('Autosave exceeds its 32 MiB quota. Download or explicitly delete a saved attempt.');
    localStorage.setItem(key, storedRaw);
    // One bounded entry, populated only by replay validation or this engine's own accepted snapshot.
    lastValidated = { raw: storedRaw, saved: stored, source: options.playbackSource };
  });
}
export function removeSavedAttempt(id: string): Promise<void> {
  const key = keyFor(id); return withStorageLock(() => localStorage.removeItem(key));
}

function readDispositions(): Record<string, SavedDisposition> {
  const raw = localStorage.getItem(savedDispositionKey); if (raw === null) return {};
  if (bytes(raw) > dispositionByteLimit) throw new Error('Local attempt dispositions exceed their limit. Download this attempt before resetting.');
  const parsed = dispositionLedger.safeParse(JSON.parse(raw));
  if (!parsed.success || Object.keys(parsed.data.dispositions).length > savedDispositionCountLimit) throw new Error('Local attempt dispositions are invalid. Download this attempt before resetting or restoring.');
  return parsed.data.dispositions;
}
/** Local remembered lifecycle only. Browser data clearing can erase this record. */
export function assertAttemptResumable(id: string): void {
  if (!attemptId.test(id)) throw new Error('Invalid attempt identity.');
  if (readDispositions()[id] === 'abandoned_reset') throw new Error('This attempt was abandoned by reset and cannot resume. Its saved evidence remains downloadable.');
}
export function recordSavedDisposition(id: string, phase: SavedDisposition, options: { canWrite?: () => boolean } = {}): Promise<void> {
  if (!attemptId.test(id)) throw new Error('Invalid attempt identity.');
  const disposition = dispositionSchema.parse(phase);
  return withStorageLock(() => {
    if (options.canWrite && !options.canWrite()) throw new Error('Editing ownership changed. Attempt disposition was not written.');
    const dispositions = readDispositions(), previous = dispositions[id];
    if (previous !== undefined && previous !== disposition) throw new Error('This attempt already has a final local disposition.');
    if (previous === undefined && Object.keys(dispositions).length >= savedDispositionCountLimit) throw new Error('Local disposition history is full. Download this attempt before closing it.');
    dispositions[id] = disposition; const raw = JSON.stringify({ version: '1.0', dispositions });
    if (bytes(raw) > dispositionByteLimit) throw new Error('Local disposition history exceeds its byte limit. Download this attempt before closing it.');
    localStorage.setItem(savedDispositionKey, raw);
  });
}
