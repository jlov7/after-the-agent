import type { Action, FrozenCandidate, ScenarioFamily } from '../../packages/contracts/src/index.js';
import { sha256Json } from '../../packages/contracts/src/index.js';
import { createScenario } from '../../packages/engine/src/scenarios.js';
import { dispatch, snapshot } from '../../packages/engine/src/engine.js';
export function candidate(family: ScenarioFamily = 'valid-pending', actions: Action[] = []): FrozenCandidate {
  const scenario = createScenario(family);
  for (const [index,action] of actions.entries()) {
    const result = dispatch(scenario.engine,{schema_version:'1.0',request_id:`repair.${index}`,expected_revision:snapshot(scenario.engine).revision,action},{actor_id:'test-human',role:'human',phase:'recovery'});
    if (result.outcome !== 'accepted') throw new Error('Test repair rejected');
  }
  const plant=snapshot(scenario.engine);
  return {schema_version:'1.0',plant,task:scenario.setup.task,world_prefix:{initial_world:scenario.setup.world.initial_world,transitions:scenario.setup.world.transitions.filter(t=>t.tick<=plant.tick)},candidate_sha256:sha256Json(plant),capture_tick:plant.tick,original_handover_tick:5,attempt_id:'test-attempt',terminal_reason:'submitted',reset_during_attempt:false};
}
