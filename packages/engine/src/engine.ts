import { canonicalJson, compileSchema, evaluationSchema, validatePlantShape, validateRequest } from '../../contracts/src/index.js';
import type { ActorContext, BoardErrorCode, BoardRequest, BoardResult, CanonicalPlant, CommandRecord, DomainEvent, EngineHandle, Job, Lamp, Phase, SetupSpec, TaskSpec, World, WorldHistory } from '../../contracts/src/index.js';

// Only values copied and deeply frozen here may be reused across published views.
const immutableValues = new WeakSet<object>();
export function immutable<T>(value: T): T {
  const copies = new WeakMap<object, object>();
  const copy = (item: unknown): unknown => {
    if (typeof item === 'function' || typeof item === 'symbol') throw new TypeError('Immutable values must be data');
    if (item === null || typeof item !== 'object') return item;
    if (immutableValues.has(item)) return item;
    const existing = copies.get(item); if (existing) return existing;
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) throw new TypeError('Immutable values must be plain data');
    const result: Record<string, unknown> | unknown[] = Array.isArray(item) ? new Array(item.length) : {};
    copies.set(item, result);
    for (const [key, child] of Object.entries(item)) Object.defineProperty(result, key, { value: copy(child), enumerable: true, writable: true, configurable: true });
    Object.freeze(result); immutableValues.add(result); return result;
  };
  return copy(value) as T;
}
interface State {
  plant: CanonicalPlant; world: WorldHistory; task: TaskSpec; phase: Phase;
  events: DomainEvent[]; audit: CommandRecord[];
  event_view: readonly DomainEvent[]; audit_view: readonly CommandRecord[];
  requests: Map<string, { payload: string; result: BoardResult }>;
  pulses: number;
}
const states = new WeakMap<EngineHandle, State>();
const get = (engine: EngineHandle): State => {
  const state = states.get(engine); if (!state) throw new TypeError('Unknown engine handle'); return state;
};
const historyValidator = compileSchema<WorldHistory>({
  $schema: evaluationSchema.$schema, $defs: evaluationSchema.$defs, type: 'object', additionalProperties: false,
  properties: { initial_world: { $ref: '#/$defs/InitialWorld' }, transitions: { type: 'array', maxItems: 4096, items: { $ref: '#/$defs/Transition' } } }, required: ['initial_world', 'transitions'],
});
function validateHistory(world: WorldHistory): void {
  canonicalJson(world);
  if (!historyValidator(world).valid) throw new TypeError('Invalid world history');
  let previous = 0;
  for (const transition of world.transitions) {
    if (transition.tick <= previous) throw new TypeError('World ticks must strictly increase'); previous = transition.tick;
  }
}
export function worldAt(world: WorldHistory, tick: number): World {
  let current: World = { ...world.initial_world, epoch: 1 };
  for (const transition of world.transitions) {
    if (transition.tick > tick) break;
    if (current.scene_id !== transition.scene_id || current.active !== transition.active) current = { scene_id: transition.scene_id, active: transition.active, epoch: current.epoch + 1 };
  }
  return current;
}
const orderJobs = (a: Job, b: Job): number => a.due_tick - b.due_tick || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
function validatePlant(plant: CanonicalPlant, world: WorldHistory): void {
  canonicalJson(plant); validatePlantShape(plant); validateHistory(world);
  if (canonicalJson(plant.world) !== canonicalJson(worldAt(world, plant.tick))) throw new TypeError('Plant world disagrees with authoritative history');
  // Trusted setup/fault events may set the cached bit independently of a refresh.
  if (plant.gate_cache.epoch > plant.world.epoch) throw new TypeError('Cache references a future world version');
  if (plant.event_seq < plant.tick + plant.world.epoch - 1 || plant.revision < Math.ceil(plant.tick / 64)) throw new TypeError('Plant counters cannot describe a settled reachable state');
  const ids = new Set<string>();
  for (const [index, job] of plant.queue.entries()) {
    const ordinal = job.enqueue_tick / 4;
    const side = ordinal % 2 ? 'left' : 'right';
    if (ids.has(job.id) || job.id !== `${job.clock}.${job.enqueue_tick}.${job.lamp}` || job.due_tick !== job.enqueue_tick + 2 || job.enqueue_tick > plant.tick || job.due_tick <= plant.tick || job.due_tick > 4096 || job.enqueue_epoch !== worldAt(world, job.enqueue_tick).epoch || (job.lamp !== side && !(job.lamp === 'center' && ordinal % 4 === 0)) || (index > 0 && orderJobs(plant.queue[index - 1]!, job) >= 0)) throw new TypeError('Invalid or unreachable pending job');
    ids.add(job.id);
  }
}
function taskFor(scenario: TaskSpec['scenario'] = 'valid-pending'): TaskSpec {
  return { schema_version: '1.0', task_id: 'alternating-lights-v1', scenario, period: 4, delay: 2, max_tick: 4096, enqueue_until_tick: 4094, max_queue: 128, max_pulses: 16384, max_audit_records: 10000, recovery_seconds: 300 };
}
export function defaultTask(scenario: TaskSpec['scenario']): TaskSpec { return immutable(taskFor(scenario)); }
function allocate(plant: CanonicalPlant, world: WorldHistory, task: TaskSpec): EngineHandle {
  const engine = Object.freeze({}) as EngineHandle;
  states.set(engine, { plant: immutable(plant), world: immutable(world), task: immutable(task), phase: 'setup', events: [], audit: [], event_view: immutable([]), audit_view: immutable([]), requests: new Map(), pulses: 0 }); return engine;
}
export function createEngine(setup: SetupSpec): EngineHandle {
  const expected = taskFor(setup.task.scenario);
  if (!Number.isInteger(setup.task.enqueue_until_tick) || setup.task.enqueue_until_tick < 0 || setup.task.enqueue_until_tick > 4094 || canonicalJson({ ...setup.task, enqueue_until_tick: 4094 }) !== canonicalJson(expected)) throw new TypeError('Unsupported task');
  const plant: CanonicalPlant = { schema_version: '1.0', tick: 0, revision: 0, world: { ...setup.world.initial_world, epoch: 1 }, config: structuredClone(setup.config), gate_cache: structuredClone(setup.gate_cache ?? { active: setup.world.initial_world.active, epoch: 1 }), queue: [], event_seq: 0 };
  validatePlant(plant, setup.world); return allocate(plant, setup.world, setup.task);
}
export function snapshot(engine: EngineHandle): CanonicalPlant { return immutable(get(engine).plant); }
export function cloneEngine(plant: CanonicalPlant, world: WorldHistory): EngineHandle {
  validatePlant(plant, world); return allocate(plant, world, taskFor());
}
export function setEnginePhase(engine: EngineHandle, phase: Phase): void {
  if (!['setup', 'playback', 'recovery', 'submitted', 'timed_out', 'abandoned_reset'].includes(phase)) throw new TypeError('Invalid engine phase'); get(engine).phase = phase;
}
export function setInputHorizon(engine: EngineHandle, end: number): void {
  if (!Number.isInteger(end) || end < 0 || end > 4094) throw new TypeError('Invalid input horizon'); const state = get(engine); state.task = immutable({ ...state.task, enqueue_until_tick: end });
}
export function engineEvents(engine: EngineHandle): readonly DomainEvent[] { return get(engine).event_view; }
export function engineAudit(engine: EngineHandle): readonly CommandRecord[] { return get(engine).audit_view; }
type EventBody = DomainEvent extends infer E ? E extends DomainEvent ? Omit<E, 'seq' | 'tick'> : never : never;
function runMutation(state: State, request: BoardRequest): { plant: CanonicalPlant; events: DomainEvent[]; no_op: boolean } {
  const plant = structuredClone(state.plant), events: DomainEvent[] = [];
  const emit = (body: EventBody): void => { events.push({ ...body, tick: plant.tick, seq: ++plant.event_seq } as DomainEvent); };
  const action = request.action;
  const before = canonicalJson({ config: plant.config, gate_cache: plant.gate_cache, queue: plant.queue, tick: plant.tick });
  switch (action.type) {
    case 'set_clock': plant.config.clocks[action.clock] = action.enabled; break;
    case 'set_gate_mode': plant.config.gate_mode = action.mode; break;
    case 'set_epoch_guard': plant.config.epoch_guard = action.enabled; break;
    case 'refresh_gate': plant.gate_cache = { active: plant.world.active, epoch: plant.world.epoch }; break;
    case 'drop_jobs':
      if (action.job_ids.some(id => !plant.queue.some(job => job.id === id))) throw new MutationError('UNKNOWN_JOB', 'Every selected job must exist');
      plant.queue = plant.queue.filter(job => !action.job_ids.includes(job.id)); emit({ type: 'jobs_dropped', job_ids: action.job_ids }); break;
    case 'advance':
      if (plant.tick + action.ticks > state.task.max_tick) throw new MutationError('BUDGET_LIMIT', 'Logical tick budget exhausted');
      for (let n = 0; n < action.ticks; n++) {
        plant.tick++;
        const transition = state.world.transitions.find(t => t.tick === plant.tick);
        if (transition && (transition.scene_id !== plant.world.scene_id || transition.active !== plant.world.active)) {
          plant.world = { scene_id: transition.scene_id, active: transition.active, epoch: plant.world.epoch + 1 }; emit({ type: 'world_changed', world: structuredClone(plant.world) });
        }
        if (plant.tick % 4 === 0 && plant.tick <= state.task.enqueue_until_tick) {
          for (const clock of ['primary', 'shadow'] as const) {
            if (!plant.config.clocks[clock]) continue;
            emit({ type: 'clock_fired', clock });
            if (!(plant.config.gate_mode === 'live' ? plant.world.active : plant.gate_cache.active)) continue;
            const ordinal = plant.tick / 4;
            const lamps: Lamp[] = [ordinal % 2 ? 'left' : 'right']; if (ordinal % 4 === 0) lamps.push('center');
            for (const lamp of lamps) {
              const job: Job = { id: `${clock}.${plant.tick}.${lamp}`, clock, enqueue_tick: plant.tick, due_tick: plant.tick + 2, lamp, enqueue_epoch: plant.world.epoch };
              plant.queue.push(job); emit({ type: 'job_enqueued', job: structuredClone(job) });
            }
          }
        }
        plant.queue.sort(orderJobs);
        if (plant.queue.length > state.task.max_queue) throw new MutationError('BUDGET_LIMIT', 'Queue capacity exhausted');
        for (const job of plant.queue.filter(j => j.due_tick === plant.tick)) {
          if (plant.config.epoch_guard && job.enqueue_epoch !== plant.world.epoch) emit({ type: 'job_discarded', job_id: job.id, reason: 'epoch_mismatch' });
          else emit({ type: 'pulse', job_id: job.id, lamp: job.lamp });
        }
        plant.queue = plant.queue.filter(j => j.due_tick > plant.tick); emit({ type: 'settled_tick' });
      }
      break;
    case 'inspect': break;
  }
  const no_op = before === canonicalJson({ config: plant.config, gate_cache: plant.gate_cache, queue: plant.queue, tick: plant.tick });
  if (!no_op && (action.type === 'set_clock' || action.type === 'set_gate_mode' || action.type === 'set_epoch_guard')) emit({ type: 'config_changed', config: structuredClone(plant.config) });
  if (!no_op && action.type === 'refresh_gate') emit({ type: 'gate_refreshed', gate_cache: structuredClone(plant.gate_cache) });
  if (state.pulses + events.filter(e => e.type === 'pulse').length > state.task.max_pulses) throw new MutationError('BUDGET_LIMIT', 'Pulse budget exhausted');
  plant.revision++; return { plant, events, no_op };
}
class MutationError extends Error { constructor(readonly code: BoardErrorCode, message: string) { super(message); } }
export function dispatch(engine: EngineHandle, input: BoardRequest, actor: ActorContext): BoardResult {
  const state = get(engine);
  const requestId = input && typeof input.request_id === 'string' ? input.request_id : 'invalid';
  const result = (events: readonly DomainEvent[], error?: { code: BoardErrorCode; message: string }, no_op?: boolean): BoardResult => immutable({ request_id: requestId, outcome: error ? 'rejected' : 'accepted', revision: state.plant.revision, observation: { plant: state.plant, events: state.events.slice(-256) }, events, ...(error ? { error } : {}), ...(no_op === undefined ? {} : { no_op }) });
  if (state.audit.length >= state.task.max_audit_records) return result([], { code: 'HISTORY_CAPACITY', message: 'Command history capacity exhausted' });
  const record = (receipt: BoardResult): BoardResult => {
    try { state.audit.push(immutable({ seq: state.audit.length + 1, request: input, actor: { ...actor, phase: state.phase }, tick: state.plant.tick, elapsed_ms: 0, result: receipt })); state.audit_view = immutable(state.audit); } catch { /* Non-data invalid payloads cannot be persisted. */ }
    return receipt;
  };
  let request: BoardRequest, payload: string;
  try { request = validateRequest(input); payload = canonicalJson(request); } catch { return record(result([], { code: 'INVALID_REQUEST', message: 'Canonical request validation failed' })); }
  const reject = (code: BoardErrorCode, message: string): BoardResult => {
    const receipt = result([], { code, message }); state.requests.set(request.request_id, { payload, result: receipt }); return record(receipt);
  };
  if (!actor || !['human', 'assessed_agent', 'controller'].includes(actor.role) || typeof actor.actor_id !== 'string' || !actor.actor_id) return reject('ACTOR_FORBIDDEN', 'Trusted actor is invalid');
  if (actor.role === 'assessed_agent' && !['setup', 'playback'].includes(state.phase)) return record(result([], { code: 'ACTOR_FORBIDDEN', message: 'Assessed agent assistance has ended' }));
  const prior = state.requests.get(request.request_id);
  if (prior) return record(prior.payload === payload ? prior.result : result([], { code: 'REQUEST_ID_CONFLICT', message: 'Request ID was used with a different payload' }));
  if (actor.role === 'assessed_agent' && request.action.type === 'advance' && state.plant.tick + request.action.ticks > 5) return reject('PHASE_FORBIDDEN', 'Assessed setup cannot advance past takeover tick 5');
  if (request.action.type !== 'inspect' && ['submitted', 'timed_out', 'abandoned_reset'].includes(state.phase)) return reject('PHASE_FORBIDDEN', 'Attempt no longer admits mutations');
  if (request.action.type !== 'inspect' && request.expected_revision !== state.plant.revision) return reject('REVISION_CONFLICT', 'Expected revision is stale');
  let receipt: BoardResult;
  if (request.action.type === 'inspect') receipt = result([]);
  else {
    try {
      const mutation = runMutation(state, request); state.plant = immutable(mutation.plant); const emitted = immutable(mutation.events); state.events.push(...emitted); if (emitted.length) state.event_view = immutable(state.events); state.pulses += emitted.filter(e => e.type === 'pulse').length;
      receipt = result(emitted, undefined, mutation.no_op);
    } catch (error) {
      if (error instanceof MutationError) return reject(error.code, error.message); throw error;
    }
  }
  state.requests.set(request.request_id, { payload, result: receipt }); return record(receipt);
}
