import type { Action, DomainEvent } from '../../../../packages/contracts/src/index.js';
export function recordingModelLabel(model: string | null): string {
  const prefix = 'Unknown (requested: ';
  if (model?.startsWith(prefix) && model.endsWith(')')) return `Requested model: ${model.slice(prefix.length, -1)}. The provider did not return a model ID.`;
  return model ? `Reported model: ${model}` : 'Model identity unavailable.';
}
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
export function eventText(event: DomainEvent): string {
  switch (event.type) {
    case 'pulse': return `${event.lamp} pulse delivered (${event.job_id})`;
    case 'job_enqueued': return `${event.job.id} queued for tick ${event.job.due_tick}, version ${event.job.enqueue_epoch}`;
    case 'world_changed': return `Scene ${event.world.scene_id}, ${event.world.active ? 'active' : 'inactive'}, version ${event.world.epoch}`;
    case 'job_discarded': return `${event.job_id} discarded: scene version changed`;
    case 'config_changed': return `Settings: primary ${event.config.clocks.primary ? 'on' : 'off'}, standby ${event.config.clocks.shadow ? 'on' : 'off'}, ${event.config.gate_mode} gate, guard ${event.config.epoch_guard ? 'on' : 'off'}`;
    case 'gate_refreshed': return `Cache refreshed: ${event.gate_cache.active ? 'active' : 'inactive'}, version ${event.gate_cache.epoch}`;
    case 'jobs_dropped': return `Dropped ${event.job_ids.join(', ')}`;
    case 'clock_fired': return `${event.clock === 'shadow' ? 'Standby' : 'Primary'} clock fired`;
    case 'settled_tick': return 'Tick settled';
  }
}
