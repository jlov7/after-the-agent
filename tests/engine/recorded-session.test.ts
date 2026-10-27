import { afterEach, expect, test } from 'vitest';
import { sha256Json } from '../../packages/contracts/src/index.js';
import type { Action, ContinuationCorpus, EvaluationResult, FrozenCandidate } from '../../packages/contracts/src/index.js';
import { createEngine, dispatch, engineAudit, setEnginePhase, snapshot } from '../../packages/engine/src/engine.js';
import { scenarioSetup } from '../../packages/engine/src/scenarios.js';
import { createRecordedSession, restoreSession, saveSession } from '../../packages/engine/src/session.js';
import type { SessionPlaybackSource } from '../../packages/engine/src/session.js';
let now = 1000;
const sessions: ReturnType<typeof createRecordedSession>[] = [];
const corpus = (candidate: FrozenCandidate): ContinuationCorpus => ({ schema_version: '1.0', policy_version: '1.0.0', candidate_sha256: candidate.candidate_sha256, cases: [] });
const evaluate = async (candidate: FrozenCandidate): Promise<EvaluationResult> => ({ status: 'pass', candidate_sha256: candidate.candidate_sha256, cases: [], observations: [] });
function source(actions: readonly Action[] = [{ type: 'inspect', target: 'board' }, { type: 'advance', ticks: 4 }, { type: 'advance', ticks: 1 }], lateCall = false): SessionPlaybackSource {
  const setup = scenarioSetup('stale-queue'), engine = createEngine(setup);
  for (const [index, action] of actions.entries()) dispatch(engine, { schema_version: '1.0', request_id: `capture.${index + 1}`, expected_revision: snapshot(engine).revision, action }, { actor_id: 'fixture-agent', role: 'assessed_agent', phase: 'setup' });
  setEnginePhase(engine, 'recovery');
  if (lateCall) dispatch(engine, { schema_version: '1.0', request_id: 'capture.late', expected_revision: snapshot(engine).revision, action: { type: 'set_clock', clock: 'primary', enabled: false } }, { actor_id: 'fixture-agent', role: 'assessed_agent', phase: 'setup' });
  const commands = engineAudit(engine);
  return { recording_sha256: sha256Json({ setup, commands }), setup, commands, provenance: { category: 'fixture', label: 'Scripted preview', model: null, date: null, replay_verified: true } };
}
function recorded(playback = source()) { const s = createRecordedSession(playback, evaluate, corpus, { now: () => now }); sessions.push(s); return s; }
afterEach(() => { sessions.forEach(s => s.dispose()); sessions.length = 0; now = 1000; });

test('actual source commands replay before a separate settled-five controller fault without resetting inherited work', () => {
  const playback = source(), s = recorded(playback); expect(s.playbackLength()).toBe(playback.commands.length + 1);
  for (const original of playback.commands) { s.playbackStep(); const actual = s.getView().history.at(-1)!; expect(actual.request).toEqual(original.request); expect(actual.actor).toEqual(original.actor); expect(actual.result).toEqual(original.result); expect(actual.tick).toBe(original.tick); expect(actual.seq).toBe(original.seq); }
  const prior = s.getView(), queue = prior.plant.queue; expect(prior.plant.tick).toBe(5); expect(prior.plant.config.epoch_guard).toBe(true); expect(queue).toEqual([{ id: 'primary.4.left', clock: 'primary', enqueue_tick: 4, due_tick: 6, lamp: 'left', enqueue_epoch: 1 }]);
  s.playbackStep(); const fault = s.getView().history.at(-1)!; expect(fault.actor.role).toBe('controller'); expect(fault.actor.actor_id).toBe('recorded-stale-queue-fault'); expect(fault.request.action).toEqual({ type: 'set_epoch_guard', enabled: false }); expect(s.getView().plant.tick).toBe(5); expect(s.getView().plant.queue).toEqual(queue); expect(prior.plant.config.epoch_guard).toBe(true); s.start(); expect(s.getView().phase).toBe('recovery');
  expect(s.exportAttempt().playback_source?.recording_sha256).toBe(playback.recording_sha256); expect(s.exportAttempt().provenance).toEqual(playback.provenance);
});

test('missing or changed source rejects resume, valid source preserves deadline, history and two public candidates', async () => {
  const playback = source(), s = recorded(playback); s.start(); await s.submit(); s.act({ type: 'set_epoch_guard', enabled: true }); await s.submit(); now += 123000; const saved = saveSession(s);
  expect(() => restoreSession(saved, evaluate, corpus, { now: () => now })).toThrow();
  expect(() => restoreSession(saved, evaluate, corpus, { now: () => now, playbackSource: { ...playback, recording_sha256: '0'.repeat(64) } })).toThrow();
  const changed = { ...playback, provenance: { ...playback.provenance, date: 'changed' } }; expect(() => restoreSession(saved, evaluate, corpus, { now: () => now, playbackSource: changed })).toThrow();
  const restored = restoreSession(saved, evaluate, corpus, { now: () => now, playbackSource: playback }); sessions.push(restored); expect(restored.getView().plant).toEqual(s.getView().plant); expect(restored.getView().history).toEqual(s.getView().history); expect(restored.getView().remaining_ms).toBe(177000); expect(saveSession(restored).deadline_at_ms).toBe(saved.deadline_at_ms); expect((await restored.submit()).status).toBe('pass'); expect(restored.exportAttempt().submissions.map(item => item.evaluation?.status)).toEqual(['pass', 'pass']);
});

test('same-family restart retains source; another fault drops it and returning to stale stays authored', () => {
  const playback = source(), s = recorded(playback); s.start(); s.restart(); expect(saveSession(s).playback_source?.recording_sha256).toBe(playback.recording_sha256); expect(s.playbackLength()).toBe(4);
  s.restart('duplicate-clock'); expect(saveSession(s).playback_source).toBeNull(); expect(s.getView().provenance).toEqual({ category: 'scripted', label: 'Scripted preview', model: null, date: null, replay_verified: true });
  s.restart('stale-queue'); expect(saveSession(s).playback_source).toBeNull(); expect(s.playbackLength()).toBe(3); s.start(); expect(s.getView().history[0]!.actor.actor_id).toBe('scripted-preview');
});

test('source is defensively immutable and a queued assessed call after settled five cannot execute', () => {
  const playback = source(undefined, true), mutable = structuredClone(playback); const s = recorded(mutable); mutable.commands[0]!.request.action = { type: 'advance', ticks: 5 }; s.start();
  expect(s.getView().history[0]!.request.action).toEqual({ type: 'inspect', target: 'board' }); const late = s.getView().history.find(record => record.request.request_id === 'capture.late')!; expect(late.result.error?.code).toBe('ACTOR_FORBIDDEN'); expect(s.getView().plant.config.clocks.primary).toBe(true);
  const restored = restoreSession(saveSession(s), evaluate, corpus, { now: () => now, playbackSource: playback }); sessions.push(restored); expect(restored.getView().history).toEqual(s.getView().history);
});

test('forged receipts, incorrect setup and incorrect final state cannot qualify a recorded source', () => {
  const playback = source(), forged = structuredClone(playback); forged.commands.at(-1)!.result.observation.plant.queue = []; expect(() => recorded(forged)).toThrow();
  expect(() => recorded({ ...playback, setup: { ...playback.setup, config: { ...playback.setup.config, epoch_guard: false } } })).toThrow();
  expect(() => recorded(source([{ type: 'set_clock', clock: 'shadow', enabled: true }, { type: 'advance', ticks: 5 }]))).toThrow();
  expect(() => recorded(source([{ type: 'set_gate_mode', mode: 'cached' }, { type: 'advance', ticks: 5 }]))).toThrow();
  expect(() => recorded(source([{ type: 'set_epoch_guard', enabled: false }, { type: 'advance', ticks: 5 }]))).toThrow();
});

test('a source configured with only the shadow clock preserves its actual pending job', () => {
  const s = recorded(source([{ type: 'set_clock', clock: 'primary', enabled: false }, { type: 'set_clock', clock: 'shadow', enabled: true }, { type: 'advance', ticks: 5 }])); s.start(); expect(s.getView().plant.queue[0]!.id).toBe('shadow.4.left'); expect(s.getView().plant.config.clocks).toEqual({ primary: false, shadow: true });
});


test('partial recorded playback resumes its original sequence and old saved format rejects explicitly', () => {
  const playback = source(), s = recorded(playback); s.playbackStep(); now += 2000; const saved = saveSession(s);
  expect(() => restoreSession({ ...saved, schema_version: '1.1' }, evaluate, corpus, { now: () => now, playbackSource: playback })).toThrow();
  const restored = restoreSession(saved, evaluate, corpus, { now: () => now, playbackSource: playback }); sessions.push(restored); expect(restored.getView().history).toEqual(s.getView().history); restored.start(); expect(restored.getView().history.map(command => command.request.request_id)).toEqual([...playback.commands.map(command => command.request.request_id), 'controller.fault.0']); expect(restored.getView().plant.queue[0]!.due_tick).toBe(6);
});
