import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import type { Action, BoardRequest, SetupSpec, Transition } from '../../packages/contracts/src/index.js';
import { createEngine, dispatch, snapshot, cloneEngine, engineEvents, engineAudit, setEnginePhase, setInputHorizon } from '../../packages/engine/src/engine.js';
const actor = { actor_id: 'test', role: 'human', phase: 'recovery' } as const;
export function setup(transitions: Transition[] = []): SetupSpec {
  return { task: { schema_version: '1.0', task_id: 'alternating-lights-v1', scenario: 'valid-pending', period: 4, delay: 2, max_tick: 4096, enqueue_until_tick: 4094, max_queue: 128, max_pulses: 16384, max_audit_records: 10000, recovery_seconds: 300 }, world: { initial_world: { scene_id: 'blue', active: true }, transitions }, config: { clocks: { primary: true, shadow: false }, gate_mode: 'live', epoch_guard: true } };
}
function act(engine: ReturnType<typeof createEngine>, action: Action, id = `req.${engineAudit(engine).length}`) {
  return dispatch(engine, { schema_version: '1.0', request_id: id, expected_revision: snapshot(engine).revision, action }, actor);
}
function pulses(engine: ReturnType<typeof createEngine>) { return engineEvents(engine).filter(e => e.type === 'pulse').map(e => ({ tick: e.tick, lamp: e.type === 'pulse' ? e.lamp : '' })); }
function physical(plant: ReturnType<typeof snapshot>) { return { tick: plant.tick, world: plant.world, config: plant.config, gate_cache: plant.gate_cache, queue: plant.queue }; }
describe('clock queue semantics', () => {
  test('first delivery six, odd-even sides and ordinal-four center', () => {
    const engine = createEngine(setup()); expect(pulses(engine)).toEqual([]);
    act(engine, { type: 'advance', ticks: 18 });
    expect(pulses(engine)).toEqual([{ tick: 6, lamp: 'left' }, { tick: 10, lamp: 'right' }, { tick: 14, lamp: 'left' }, { tick: 18, lamp: 'center' }, { tick: 18, lamp: 'right' }]);
  });
  test('cloning preserves pending delivery even after source disable', () => {
    const engine = createEngine(setup()); act(engine, { type: 'advance', ticks: 5 });
    const copy = cloneEngine(snapshot(engine), setup().world);
    act(copy, { type: 'set_clock', clock: 'primary', enabled: false }); act(copy, { type: 'advance', ticks: 1 });
    expect(pulses(copy)).toEqual([{ tick: 6, lamp: 'left' }]);
  });
  test('transitions precede tick work, redundant commands preserve epoch', () => {
    const engine = createEngine(setup([{ tick: 4, scene_id: 'amber', active: true }, { tick: 6, scene_id: 'red', active: true }, { tick: 8, scene_id: 'red', active: true }]));
    act(engine, { type: 'advance', ticks: 10 });
    expect(snapshot(engine).world.epoch).toBe(3); expect(pulses(engine)).toEqual([{ tick: 10, lamp: 'right' }]);
  });
  test('cached active is never implicitly refreshed', () => {
    const engine = createEngine({ ...setup([{ tick: 5, scene_id: 'blue', active: false }, { tick: 9, scene_id: 'blue', active: true }]), config: { ...setup().config, gate_mode: 'cached' } });
    act(engine, { type: 'advance', ticks: 8 }); expect(snapshot(engine).queue).toHaveLength(1);
    expect(snapshot(engine).gate_cache).toEqual({ active: true, epoch: 1 });
    act(engine, { type: 'refresh_gate' }); act(engine, { type: 'advance', ticks: 8 });
    expect(snapshot(engine).gate_cache).toEqual({ active: false, epoch: 2 }); expect(snapshot(engine).queue).toEqual([]);
  });
  test('unknown-job drop is atomic; selecting one duplicate leaves the other', () => {
    const engine = createEngine({ ...setup(), config: { ...setup().config, clocks: { primary: true, shadow: true } } });
    act(engine, { type: 'advance', ticks: 5 }); const before = snapshot(engine);
    expect(act(engine, { type: 'drop_jobs', job_ids: ['primary.4.left', 'shadow.8.left'] }).error?.code).toBe('UNKNOWN_JOB'); expect(snapshot(engine)).toEqual(before);
    act(engine, { type: 'drop_jobs', job_ids: ['primary.4.left'] }); act(engine, { type: 'advance', ticks: 1 }); expect(pulses(engine)).toHaveLength(1);
  });
  test('toggle keeps global phase and input horizon allows drain only', () => {
    const engine = createEngine(setup()); act(engine, { type: 'advance', ticks: 5 }); act(engine, { type: 'set_clock', clock: 'primary', enabled: false });
    act(engine, { type: 'advance', ticks: 2 }); act(engine, { type: 'set_clock', clock: 'primary', enabled: true }); setInputHorizon(engine, 8); act(engine, { type: 'advance', ticks: 7 });
    expect(pulses(engine)).toEqual([{ tick: 6, lamp: 'left' }, { tick: 10, lamp: 'right' }]); expect(snapshot(engine).queue).toEqual([]);
  });
  test('seed104729 shrinking: chunking preserves physical state and event sequence', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 31 }), fc.integer({ min: 1, max: 31 }), fc.array(fc.boolean(), { minLength: 8, maxLength: 8 }), (a, b, flags) => {
      const spec = setup(flags.map((active, i) => ({ tick: i * 7 + 3, scene_id: i % 2 ? 'blue' : 'amber', active })));
      const one = createEngine(spec), two = createEngine(spec); act(one, { type: 'advance', ticks: a + b }); act(two, { type: 'advance', ticks: a }); act(two, { type: 'advance', ticks: b });
      expect(physical(snapshot(one))).toEqual(physical(snapshot(two))); expect(engineEvents(one)).toEqual(engineEvents(two)); expect(snapshot(one).event_seq).toBe(snapshot(two).event_seq); expect(snapshot(two).revision).toBe(snapshot(one).revision + 1);
    }), { seed: 104729, numRuns: 100 });
  });
});
describe('authority and identity', () => {
  test('exact retry reuses receipt; conflicts and stale revisions leave state intact', () => {
    const engine = createEngine(setup()); const request: BoardRequest = { schema_version: '1.0', request_id: 'retry', expected_revision: 0, action: { type: 'advance', ticks: 5 } };
    const first = dispatch(engine, request, actor); expect(dispatch(engine, request, actor)).toEqual(first); expect(snapshot(engine).tick).toBe(5);
    expect(dispatch(engine, { ...request, action: { type: 'advance', ticks: 6 } }, actor).error?.code).toBe('REQUEST_ID_CONFLICT'); expect(dispatch(engine, { ...request, request_id: 'stale' }, actor).error?.code).toBe('REVISION_CONFLICT'); expect(snapshot(engine).tick).toBe(5);
  });
  test('assessed actor cannot override trusted handover phase; terminal edits forbidden', () => {
    const engine = createEngine(setup()); setEnginePhase(engine, 'recovery'); const request: BoardRequest = { schema_version: '1.0', request_id: 'late', expected_revision: 0, action: { type: 'set_epoch_guard', enabled: false } };
    expect(dispatch(engine, request, { ...actor, role: 'assessed_agent', phase: 'setup' }).error?.code).toBe('ACTOR_FORBIDDEN'); setEnginePhase(engine, 'submitted'); expect(dispatch(engine, { ...request, request_id: 'terminal' }, actor).error?.code).toBe('PHASE_FORBIDDEN'); expect(snapshot(engine).revision).toBe(0);
  });
  test('schema rejection and global tick exhaustion are atomic', () => {
    const engine = createEngine(setup()), before = snapshot(engine);
    expect(dispatch(engine, { schema_version: '1.0', request_id: 'forged', actor: 'controller', action: { type: 'advance', ticks: 65 } } as unknown as BoardRequest, actor).error?.code).toBe('INVALID_REQUEST'); expect(snapshot(engine)).toEqual(before);
    for (let i = 0; i < 64; i++) act(engine, { type: 'advance', ticks: 64 }); const end = snapshot(engine); expect(end.tick).toBe(4096); expect(end.queue).toEqual([]); expect(act(engine, { type: 'advance', ticks: 1 }).error?.code).toBe('BUDGET_LIMIT'); expect(snapshot(engine)).toEqual(end);
  });
});
test('clone rejects forged due, ID, epoch, cache, order and current world', () => {
  const engine = createEngine({ ...setup(), config: { ...setup().config, clocks: { primary: true, shadow: true } } }); act(engine, { type: 'advance', ticks: 5 }); const valid = snapshot(engine);
  const variants = [{ ...valid, world: { ...valid.world, epoch: 2 } }, { ...valid, queue: valid.queue.map(j => ({ ...j, due_tick: 7 })) }, { ...valid, queue: valid.queue.map(j => ({ ...j, enqueue_epoch: 2 })) }, { ...valid, queue: valid.queue.map(j => ({ ...j, id: 'forged' })) }, { ...valid, queue: [...valid.queue].reverse() }, { ...valid, queue: [valid.queue[0]!, valid.queue[0]!] }, { ...valid, gate_cache: { active: false, epoch: 2 } }];
  for (const plant of variants) expect(() => cloneEngine(plant, setup().world)).toThrow(); expect(cloneEngine(valid, setup().world)).toBeDefined();
});
test('assessed setup cannot cross takeover and retry after takeover cannot bypass authority', () => {
  const engine = createEngine(setup()); const assessed = { actor_id: 'agent', role: 'assessed_agent', phase: 'setup' } as const;
  const tooFar: BoardRequest = { schema_version: '1.0', request_id: 'too.far', expected_revision: 0, action: { type: 'advance', ticks: 6 } };
  expect(dispatch(engine, tooFar, assessed).error?.code).toBe('PHASE_FORBIDDEN'); expect(snapshot(engine).tick).toBe(0);
  const accepted: BoardRequest = { ...tooFar, request_id: 'accepted', action: { type: 'advance', ticks: 5 } };
  expect(dispatch(engine, accepted, assessed).outcome).toBe('accepted'); setEnginePhase(engine, 'recovery');
  expect(dispatch(engine, accepted, assessed).error?.code).toBe('ACTOR_FORBIDDEN'); expect(snapshot(engine).tick).toBe(5);
});
test('trusted initial cache override survives cloning without an implicit refresh', () => {
  const spec = { ...setup(), config: { ...setup().config, gate_mode: 'cached' as const }, gate_cache: { active: false, epoch: 1 } };
  const engine = createEngine(spec); act(engine, { type: 'advance', ticks: 5 }); expect(snapshot(engine).queue).toEqual([]);
  const copy = cloneEngine(snapshot(engine), spec.world); act(copy, { type: 'advance', ticks: 5 }); expect(pulses(copy)).toEqual([]); expect(snapshot(copy).gate_cache).toEqual({ active: false, epoch: 1 });
  expect(() => cloneEngine({ ...snapshot(copy), gate_cache: { active: false, epoch: 2 } }, spec.world)).toThrow();
});
