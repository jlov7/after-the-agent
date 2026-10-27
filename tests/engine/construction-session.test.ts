import { expect, test } from 'vitest';
import { sha256Json, type Action, type FrozenCandidate, type SetupSpec } from '../../packages/contracts/src/index.js';
import { createEngine, createRecordedSession, dispatch, engineAudit, restoreSession, saveSession, scenarioSetup, setEnginePhase, snapshot, type SessionPlaybackSource } from '../../packages/engine/src/index.js';
import { buildCorpus } from '../../packages/runner/src/continuations.js';
import { evaluateCandidate } from '../../packages/runner/src/evaluate-browser.js';
import { createReplayInspection } from '../../packages/runner/src/replay-inspection.js';

function source(): SessionPlaybackSource {
  const setup: SetupSpec = { ...scenarioSetup('stale-queue'), config: { clocks: { primary: false, shadow: false }, gate_mode: 'cached', epoch_guard: false } };
  const engine = createEngine(setup);
  const actions: Action[] = [{ type: 'inspect', target: 'board' }, { type: 'set_clock', clock: 'primary', enabled: true }, { type: 'set_gate_mode', mode: 'live' }, { type: 'set_epoch_guard', enabled: true }, { type: 'advance', ticks: 5 }];
  for (const [index, action] of actions.entries()) dispatch(engine, { schema_version: '1.0', request_id: `construction.${index}`, expected_revision: snapshot(engine).revision, action }, { actor_id: 'fixture', role: 'assessed_agent', phase: 'setup' });
  setEnginePhase(engine, 'recovery');
  dispatch(engine, { schema_version: '1.0', request_id: 'late.edit', expected_revision: snapshot(engine).revision, action: { type: 'set_clock', clock: 'primary', enabled: false } }, { actor_id: 'fixture', role: 'assessed_agent', phase: 'setup' });
  const commands = engineAudit(engine);
  return { setup, commands, recording_sha256: sha256Json({ setup, commands }), provenance: { category: 'fixture', label: 'Scripted preview', model: null, date: null, replay_verified: true } };
}
const evaluate = (candidate: FrozenCandidate) => evaluateCandidate(candidate, buildCorpus(candidate));

test('progress-file inspection reconstructs the fixed construction profile before and after setup without trusting model metadata', () => {
  const session = createRecordedSession(source(), evaluate, buildCorpus, { now: () => 1000 });
  try {
    for (const start of [false, true]) {
      if (start) session.start();
      const saved = saveSession(session);
      const envelope = { format: 'after-the-agent.resume', version: '1.0', session: saved, rehearsal_evidence: null };
      const inspected = createReplayInspection(JSON.stringify(envelope), 'attempt');
      expect(inspected.summary.status).toBe('verified');
      expect(inspected.frame(saved.commands.length).plant).toEqual(session.getView().plant);
      expect(inspected.summary.provenance).toContain('model provenance are not established');
      const corrupted = structuredClone(envelope); corrupted.session = { ...corrupted.session, plant_sha256: '0'.repeat(64) };
      expect(createReplayInspection(JSON.stringify(corrupted), 'attempt').summary.status).toBe('mismatch');
    }
  } finally { session.dispose(); }
});

test('a fixed construction source retains actual configuration edits and pending work through playback and resume', async () => {
  const playback = source(); let now = 1000;
  const session = createRecordedSession(playback, evaluate, buildCorpus, { now: () => now });
  try {
    expect(session.getView().plant.config).toEqual(playback.setup.config);
    session.start();
    const handover = session.getView();
    expect(handover.history.slice(0, playback.commands.length).map(item => item.result)).toEqual(playback.commands.map(item => item.result));
    expect(handover.history.find(item => item.request.request_id === 'late.edit')?.result.error?.code).toBe('ACTOR_FORBIDDEN');
    expect(handover.history.at(-1)?.actor.role).toBe('controller');
    expect(handover.plant.queue).toEqual([{ id: 'primary.4.left', clock: 'primary', enqueue_tick: 4, due_tick: 6, lamp: 'left', enqueue_epoch: 1 }]);
    expect(handover.plant.config).toEqual({ clocks: { primary: true, shadow: false }, gate_mode: 'live', epoch_guard: false });
    expect((await session.submit()).status).toBe('mismatch');
    session.act({ type: 'set_epoch_guard', enabled: true }); expect((await session.submit()).status).toBe('pass');
    const saved = saveSession(session); now += 123000;
    const restored = restoreSession(saved, evaluate, buildCorpus, { now: () => now, playbackSource: playback });
    try {
      expect(restored.getView().history).toEqual(session.getView().history);
      expect(restored.getView().plant).toEqual(session.getView().plant);
      expect(saveSession(restored).deadline_at_ms).toBe(saved.deadline_at_ms);
      expect(restored.getView().remaining_ms).toBe(177000);
    } finally { restored.dispose(); }
  } finally { session.dispose(); }
});

test('construction support does not admit arbitrary starting settings or altered world truth', () => {
  const playback = source();
  for (const setup of [
    { ...playback.setup, config: { ...playback.setup.config, epoch_guard: true } },
    { ...playback.setup, world: { ...playback.setup.world, transitions: [] } },
    { ...playback.setup, gate_cache: { active: false, epoch: 1 } },
  ]) expect(() => createRecordedSession({ ...playback, setup }, evaluate, buildCorpus)).toThrow('curated stale-queue setup');
});
