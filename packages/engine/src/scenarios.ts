import type { Action, CommandRecord, EngineHandle, ScenarioFamily, SetupSpec } from '../../contracts/src/index.js';
import { createEngine, defaultTask, dispatch, engineAudit, immutable, setEnginePhase, snapshot } from './engine.js';
export interface Scenario { readonly setup: SetupSpec; readonly engine: EngineHandle; readonly commands: readonly CommandRecord[] }
export function scenarioSetup(family: ScenarioFamily): SetupSpec {
  if (!['valid-pending', 'stale-queue', 'duplicate-clock', 'cached-gate'].includes(family)) throw new TypeError('Unknown scenario family');
  return immutable({ task: defaultTask(family), world: { initial_world: { scene_id: 'blue', active: true }, transitions: family === 'stale-queue' ? [{ tick: 5, scene_id: 'amber', active: true }] : family === 'cached-gate' ? [{ tick: 5, scene_id: 'blue', active: false }] : [] }, config: { clocks: { primary: true, shadow: false }, gate_mode: 'live', epoch_guard: true } });
}
export function scenarioActions(family: ScenarioFamily): readonly Action[] {
  const fault: Action[] = family === 'stale-queue' ? [{ type: 'set_epoch_guard', enabled: false }] : family === 'duplicate-clock' ? [{ type: 'set_clock', clock: 'shadow', enabled: true }] : family === 'cached-gate' ? [{ type: 'set_gate_mode', mode: 'cached' }] : [];
  return immutable([...fault, { type: 'advance', ticks: 4 }, { type: 'advance', ticks: 1 }]);
}
export function createScenario(family: ScenarioFamily): Scenario {
  const setup = scenarioSetup(family), engine = createEngine(setup);
  setEnginePhase(engine, 'playback');
  scenarioActions(family).forEach((action, index) => {
    const result = dispatch(engine, { schema_version: '1.0', request_id: `setup.${index + 1}`, expected_revision: snapshot(engine).revision, action }, { actor_id: 'scripted-preview', role: 'controller', phase: 'playback' });
    if (result.outcome !== 'accepted') throw new Error('Authored setup was rejected');
  });
  setEnginePhase(engine, 'recovery'); return { setup, engine, commands: engineAudit(engine) };
}
