import { describe, expect, it, vi } from 'vitest';
import { createReplayInspection } from '../../packages/runner/src/replay-inspection.js';
import { replay } from '../../packages/runner/src/replay.js';
import { authoredRecording } from './fixture.js';
import { compactAttemptExport, createSession, saveSession } from '../../packages/engine/src/index.js';
import { buildCorpus } from '../../packages/runner/src/continuations.js';
import { createReplayClient, type ReplayWorkerPort } from '../../apps/web/src/replay/client.js';
import { firstReplayDifference } from '../../packages/runner/src/replay-inspection.js';
import { recordingCommand } from '../../packages/runner/src/recording-schema.js';
import { createEngine, dispatch, engineAudit, engineEvents, snapshot } from '../../packages/engine/src/index.js';
import { sha256Json, type BoardRequest } from '../../packages/contracts/src/index.js';
const session = () => createSession({ scenario: 'stale-queue', now: () => 1000 }, async candidate => ({ status: 'invalid', candidate_sha256: candidate.candidate_sha256, cases: [], observations: [] }), buildCorpus);

describe('read-only command replay inspection', () => {
  it('reconstructs backward and forward with the inherited queue and exact actual events', () => {
    const recording = authoredRecording();
    const inspection = createReplayInspection(JSON.stringify(recording), 'recording');
    expect(inspection.summary.status).toBe('verified');
    const final = inspection.frame(recording.commands.length);
    expect(final).toMatchObject({ plant: recording.final_plant, events: recording.events, position: recording.commands.length });
    expect(inspection.frame(0)).toMatchObject({ plant: recording.initial_plant, events: [] });
    expect(inspection.frame(recording.commands.length)).toEqual(final);
  });
  it('identifies the first divergent command field without changing the existing verifier verdict', () => {
    const recording = JSON.parse(JSON.stringify(authoredRecording())) as ReturnType<typeof authoredRecording>;
    Object.assign(recording.commands[1]!.result, { revision: recording.commands[1]!.result.revision + 1 });
    expect(replay(recording).status).toBe('mismatch');
    const inspected = createReplayInspection(JSON.stringify(recording), 'recording');
    expect(inspected.summary.status).toBe(replay(recording).status);
    expect(inspected.summary.diagnostic).toMatchObject({ command: 2, path: '/commands/1/result/revision', recorded: String(recording.commands[1]!.result.revision), reconstructed: String(recording.commands[1]!.result.revision - 1) });
  });
  it('preserves compact result hashes and original deadlines for attempts and resumable envelopes', () => {
    const board = session(); board.start(); board.step();
    const compact = compactAttemptExport(board), saved = saveSession(board); board.dispose();
    for (const raw of [JSON.stringify(compact), JSON.stringify({ format: 'after-the-agent.resume', version: '1.0', session: saved, rehearsal_evidence: null })]) {
      const inspection = createReplayInspection(raw, 'attempt');
      expect(inspection.summary).toMatchObject({ status: 'verified', deadline_at_ms: 301000 });
      const frame = inspection.frame(compact.commands.length);
      expect(frame).toMatchObject({ plant: { tick: 6 }, result_sha256: compact.commands.at(-1)!.result_sha256 });
    }
    const tampered = structuredClone(compact); Object.assign(tampered.commands.at(-1)!, { result_sha256: '0'.repeat(64) });
    expect(createReplayInspection(JSON.stringify(tampered), 'attempt').summary.diagnostic).toMatchObject({ command: compact.commands.length, path: `/commands/${compact.commands.length - 1}/result_sha256`, recorded: '"' + '0'.repeat(64) + '"' });
  });
  it('rejects duplicate keys, too many commands, huge input and visitor live-model claims', () => {
    expect(() => createReplayInspection('{"schema_version":"1.2","schema_version":"1.2"}', 'attempt')).toThrow(/strict JSON/);
    const recording = authoredRecording();
    Object.assign(recording.manifest, { category: 'live_model' });
    expect(() => createReplayInspection(JSON.stringify(recording), 'recording')).toThrow(/trusted recording commitment/);
    expect(() => createReplayInspection(' '.repeat(8 * 1024 * 1024 + 1), 'attempt')).toThrow(/8 MiB/);
    const board = session(); const compact = compactAttemptExport(board); board.dispose();
    expect(() => createReplayInspection(JSON.stringify({ ...compact, commands: Array.from({ length: 10001 }, () => ({})) }), 'attempt')).toThrow();
  });
  it('inspects a valid attempt larger than the old 2MB recording summary limit', () => {
    const board = session(); board.start();
    const compact = compactAttemptExport(board); board.dispose();
    const large = { ...compact, rehearsal_evidence: { retained_note: 'a'.repeat(2100000) } };
    expect(createReplayInspection(JSON.stringify(large), 'attempt').summary.status).toBe('verified');
  });
  it('reports initial and final plant divergences at bounded paths and validates seek bounds', () => {
    const recording = JSON.parse(JSON.stringify(authoredRecording())) as ReturnType<typeof authoredRecording>;
    Object.assign(recording.final_plant, { revision: recording.final_plant.revision + 1 });
    const inspection = createReplayInspection(JSON.stringify(recording), 'recording');
    expect(inspection.summary.diagnostic).toMatchObject({ command: null, path: '/final_plant/revision' });
    expect(() => inspection.frame(-1)).toThrow(); expect(() => inspection.frame(1.5)).toThrow(); expect(() => inspection.frame(10001)).toThrow();
  });
});

it('retains actual rejected raw requests without applying them or inventing an action', () => {
  const base = authoredRecording('valid-pending'), engine = createEngine(base.setup);
  const raw = { request_id: 'raw.invalid', action: { type: 'set_epoch_guard', enabled: 'yes' } };
  const actor = { actor_id: 'controller', role: 'controller', phase: 'setup' } as const;
  dispatch(engine, raw as unknown as BoardRequest, actor);
  const recording = { ...base, commands: engineAudit(engine).map(recordingCommand), events: engineEvents(engine), final_plant: snapshot(engine), manifest: { ...base.manifest, tool_calls: 1, final_plant_sha256: sha256Json(snapshot(engine)), pulses_sha256: sha256Json([]) } };
  const inspected = createReplayInspection(JSON.stringify(recording), 'recording');
  expect(inspected.summary.status).toBe('verified');
  expect(inspected.frame(1)).toMatchObject({ plant: base.initial_plant, command: { raw: true, outcome: 'rejected' } });
  expect(inspected.frame(1).command?.request).toContain('"enabled":"yes"');
});
it('bounds oversized first-divergence values without hiding their field', () => {
  const difference = firstReplayDifference({ text: 'x'.repeat(10000) }, { text: 'safe' }, '/result', 4);
  expect(difference?.path).toBe('/result/text'); expect(difference?.recorded.length).toBeLessThanOrEqual(512); expect(difference?.recorded).toContain('[truncated]');
});
function fakeWorker() {
  const sent: { id: string; type: string }[] = [];
  const port: ReplayWorkerPort = { onmessage: null, onerror: null, onmessageerror: null, postMessage(value) { sent.push(value as { id: string; type: string }); }, terminate: vi.fn() };
  return { port, sent, message(value: unknown) { port.onmessage?.({ data: value } as MessageEvent<unknown>); } };
}
it('worker requests ignore stale responses, and cancellation, errors, invalid responses and timeout terminate', async () => {
  const inspected = createReplayInspection(JSON.stringify(authoredRecording()), 'recording');
  const response = { error: null, summary: inspected.summary, frame: inspected.frame(0) };
  const fake = fakeWorker(), client = createReplayClient(() => fake.port, 10);
  const first = client.load('{}', 'attempt');
  fake.message({ id: crypto.randomUUID(), ...response });
  fake.message({ id: fake.sent[0]!.id, ...response });
  await expect(first).resolves.toMatchObject({ frame: { position: 0 } });
  const invalid = client.seek(1); const invalidRejection = expect(invalid).rejects.toThrow(/Invalid replay worker response/);
  fake.message({ id: fake.sent[1]!.id, error: null, summary: null, frame: { forged: true } }); await invalidRejection;
  expect(fake.port.terminate).toHaveBeenCalledTimes(1);
  const cancelled = client.load('{}', 'attempt'); const cancelledRejection = expect(cancelled).rejects.toThrow(/cancelled/); client.cancel(); await cancelledRejection;
  const failed = client.load('{}', 'attempt'); const failedRejection = expect(failed).rejects.toThrow(/worker failed/); fake.port.onerror?.({} as ErrorEvent); await failedRejection;
  await expect(client.load('{}', 'attempt')).rejects.toThrow(/timed out/);
  expect(fake.port.terminate).toHaveBeenCalledTimes(4); client.dispose();
});
it('a new file terminates a pending worker and cannot display its late response', async () => {
  const old = fakeWorker(), next = fakeWorker(); let count = 0;
  const client = createReplayClient(() => ++count === 1 ? old.port : next.port);
  const first = client.load('{}', 'attempt'), rejected = expect(first).rejects.toThrow(/superseded/);
  const second = client.load('{}', 'attempt'); await rejected;
  old.message({ id: old.sent[0]!.id, error: 'old error', summary: null, frame: null });
  const inspection = createReplayInspection(JSON.stringify(authoredRecording()), 'recording');
  next.message({ id: next.sent[0]!.id, error: null, summary: inspection.summary, frame: inspection.frame(0) });
  await expect(second).resolves.toMatchObject({ summary: { status: 'verified' } });
  client.dispose(); expect(old.port.terminate).toHaveBeenCalledTimes(1); expect(next.port.terminate).toHaveBeenCalledTimes(1);
});

it('retains precise commitment divergences and does not relabel the verifier status', () => {
  const recording = JSON.parse(JSON.stringify(authoredRecording())) as ReturnType<typeof authoredRecording>;
  Object.assign(recording.manifest, { pulses_sha256: '0'.repeat(64) });
  const inspection = createReplayInspection(JSON.stringify(recording), 'recording');
  expect(inspection.summary.status).toBe(replay(recording).status);
  expect(inspection.summary.diagnostic?.path).toBe('/manifest/pulses_sha256');
});
it('bounds event rows while keeping all actual pulse totals and backward reconstruction', () => {
  const board = session(); board.start();
  for (let step = 0; step < 10; step++) board.act({ type: 'advance', ticks: 64 });
  const compact = compactAttemptExport(board), actual = board.getView(); board.dispose();
  const inspection = createReplayInspection(JSON.stringify(compact), 'attempt'), final = inspection.frame(compact.commands.length);
  expect(final.event_count).toBe(actual.events.length); expect(final.events).toHaveLength(256);
  expect(Object.values(final.pulses).reduce((sum, count) => sum + count, 0)).toBe(actual.events.filter(event => event.type === 'pulse').length);
  expect(inspection.frame(0).event_count).toBe(0); expect(inspection.frame(compact.commands.length)).toEqual(final);
});
