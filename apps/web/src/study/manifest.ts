import { createEngine, createScenario, snapshot } from '../../../../packages/engine/src/index.js';
import { sha256Json } from '../../../../packages/contracts/src/index.js';
import type { Action, ScenarioFamily } from '../../../../packages/contracts/src/index.js';
export const schedule = Object.freeze({ before_ms: 25000, after_ms: 20000, windows: 3 });
export function actionLabel(action: Action): string {
  switch (action.type) {
    case 'set_epoch_guard': return `Set delivery guard ${action.enabled ? 'on' : 'off'}`;
    case 'set_clock': return `Set ${action.clock === 'shadow' ? 'standby' : 'primary'} clock ${action.enabled ? 'on' : 'off'}`;
    case 'set_gate_mode': return `Set gate source to ${action.mode}`;
    case 'advance': return `Advance ${action.ticks} ${action.ticks === 1 ? 'tick' : 'ticks'}`;
    case 'refresh_gate': return 'Refresh cached scene state';
    case 'drop_jobs': return `Drop ${action.job_ids.length} selected jobs`;
    case 'inspect': return `Inspect ${action.target}`;
  }
}
export function factualManifest(scenario: ScenarioFamily) {
  const trace = createScenario(scenario);
  const windows = trace.commands.map((command, index) => ({ index, before_plant: index === 0 ? snapshot(createEngine(trace.setup)) : trace.commands[index - 1]!.result.observation.plant, action: command.request.action, alternatives: [actionLabel(command.request.action), 'Inspect current settings', 'Leave the system unchanged', 'Unsure'], before: index === 0 ? 'The primary clock is enabled, the standby clock is disabled, the gate reads live state, and the delivery guard is enabled. The scene is active blue, version 1.' : index === 1 ? 'The first nominal clock firing is tick 4. Each eligible pulse enters a queue with a two-tick delay. Left is owed on the first beat.' : 'Queued work retains its source and enqueue scene version. A scene or activity change increments the authoritative scene version. Delivery compares versions when the guard is enabled.', after: { action: actionLabel(command.request.action), result: command.result.observation.plant, events: command.result.events } }));
  const payload = { schema_version: '1.0', scenario, schedule, windows, trace: trace.commands, handover_sha256: sha256Json(trace.commands.at(-1)!.result.observation.plant) };
  return Object.freeze({ ...payload, factual_payload_sha256: sha256Json(payload) });
}
