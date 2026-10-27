import { canonicalJson } from '../../contracts/src/index.js';
import type { ContinuationCorpus, DomainEvent, FrozenCandidate, Job, Pulse } from '../../contracts/src/index.js';
import { cloneEngine, dispatch, immutable, setEnginePhase, setInputHorizon, snapshot } from '../../engine/src/engine.js';
import type { SubmissionRecord } from '../../engine/src/session.js';
import { validateCorpus } from './continuations.js';
import { caseDigest, expectedPulses } from './reference-port.js';
import type { ContinuationInspection, InspectionFrame, JobInspection, PulseCounts, RepairComparison } from './inspection-types.js';

const counts = (pulses: readonly Pulse[]): PulseCounts => {
  const result = { left: 0, right: 0, center: 0 };
  for (const pulse of pulses) result[pulse.lamp]++;
  return result;
};
export function inspectContinuation(candidate: FrozenCandidate, corpus: ContinuationCorpus, caseId: string): ContinuationInspection {
  validateCorpus(candidate, corpus);
  const c = corpus.cases.find(value => value.case_id === caseId);
  if (!c) throw new TypeError('Unknown continuation case');
  const engine = cloneEngine(candidate.plant, { initial_world: c.initial_world, transitions: c.transitions });
  setEnginePhase(engine, 'recovery'); setInputHorizon(engine, c.enqueue_until_tick);
  const expected = expectedPulses(c), frames: InspectionFrame[] = [];
  let firstMismatch: number | null = null;
  const frame = (events: readonly DomainEvent[]): void => {
    const plant = snapshot(engine), required = counts(expected.filter(pulse => pulse.tick === plant.tick));
    const observed = counts(events.filter(event => event.type === 'pulse'));
    if (firstMismatch === null && canonicalJson(required) !== canonicalJson(observed)) firstMismatch = plant.tick;
    frames.push({ tick: plant.tick, plant, events, expected: required, observed });
  };
  frame([]);
  while (snapshot(engine).tick < c.enqueue_until_tick + 2) {
    const plant = snapshot(engine);
    const result = dispatch(engine, { schema_version: '1.0', request_id: `inspection.${plant.tick}`, expected_revision: plant.revision, action: { type: 'advance', ticks: 1 } }, { actor_id: 'continuation-inspector', role: 'controller', phase: 'recovery' });
    if (result.outcome !== 'accepted') throw new Error(`Continuation inspection failed: ${result.error?.code}`);
    frame(result.events);
  }
  return immutable({ candidate_sha256: candidate.candidate_sha256, case_id: c.case_id, case_sha256: caseDigest(c), frames, first_mismatch_tick: firstMismatch });
}
export function traceJob(jobId: string, events: readonly DomainEvent[], pending: readonly Job[]): JobInspection {
  const enqueue = events.find((event): event is Extract<DomainEvent, { type: 'job_enqueued' }> => event.type === 'job_enqueued' && event.job.id === jobId);
  const job = enqueue?.job ?? pending.find(value => value.id === jobId) ?? null;
  const terminal = events.find(event => (enqueue === undefined || event.seq > enqueue.seq) && ((event.type === 'pulse' || event.type === 'job_discarded') ? event.job_id === jobId : event.type === 'jobs_dropped' && event.job_ids.includes(jobId)));
  const relevant = events.filter(event => {
    if (event === enqueue || event === terminal) return true;
    return event.type === 'world_changed' && (enqueue !== undefined || job !== null || terminal !== undefined) && (enqueue ? event.seq > enqueue.seq : job ? event.tick > job.enqueue_tick : true) && (!terminal || event.seq < terminal.seq);
  });
  const outcome = terminal?.type === 'pulse' ? 'delivered' : terminal?.type === 'job_discarded' ? 'discarded' : terminal?.type === 'jobs_dropped' ? 'dropped' : pending.some(value => value.id === jobId) ? 'pending' : 'unknown';
  return immutable({ job_id: jobId, job, enqueue_recorded: enqueue !== undefined, events: relevant, outcome });
}
export function compareSubmissions(before: SubmissionRecord, after: SubmissionRecord): RepairComparison {
  const contextNotes: string[] = [], changes: { path: string; before: string; after: string }[] = [];
  const a = before.candidate, b = after.candidate;
  if (a.attempt_id !== b.attempt_id) contextNotes.push('Different attempts.');
  if (a.capture_tick !== b.capture_tick) contextNotes.push('Different candidate ticks.');
  if (canonicalJson([a.world_prefix, a.plant.world]) !== canonicalJson([b.world_prefix, b.plant.world])) contextNotes.push('Different world contexts.');
  if (canonicalJson(a.task) !== canonicalJson(b.task)) contextNotes.push('Different task contexts.');
  if (canonicalJson(before.corpus.cases) !== canonicalJson(after.corpus.cases)) contextNotes.push('Different continuation cases or schedules.');
  const compare = (path: string, left: unknown, right: unknown): void => {
    const before = left === undefined ? 'absent' : canonicalJson(left), after = right === undefined ? 'absent' : canonicalJson(right);
    if (before !== after) changes.push({ path, before, after });
  };
  compare('tick', a.plant.tick, b.plant.tick);
  for (const key of ['primary', 'shadow'] as const) compare(`config.clocks.${key}`, a.plant.config.clocks[key], b.plant.config.clocks[key]);
  for (const key of ['gate_mode', 'epoch_guard'] as const) compare(`config.${key}`, a.plant.config[key], b.plant.config[key]);
  for (const key of ['active', 'epoch'] as const) compare(`gate_cache.${key}`, a.plant.gate_cache[key], b.plant.gate_cache[key]);
  for (const key of ['scene_id', 'active', 'epoch'] as const) compare(`world.${key}`, a.plant.world[key], b.plant.world[key]);
  const queueBefore = new Map(a.plant.queue.map(job => [job.id, job])), queueAfter = new Map(b.plant.queue.map(job => [job.id, job]));
  for (const id of [...new Set([...queueBefore.keys(), ...queueAfter.keys()])].sort()) compare(`queue.${id}`, queueBefore.get(id), queueAfter.get(id));
  const status = (record: SubmissionRecord, id: string): string => {
    if (!record.evaluation) return 'pending';
    const result = record.evaluation.cases.find(c => c.case_id === id);
    return result ? `${result.status} (missing ${result.missing.length}, extra ${result.extra.length})` : `not evaluated (${record.evaluation.status})`;
  };
  const ids = [...new Set([...before.corpus.cases, ...after.corpus.cases].map(c => c.case_id))];
  return immutable({ same_context: contextNotes.length === 0, context_notes: contextNotes, changes, cases: ids.map(case_id => ({ case_id, before: status(before, case_id), after: status(after, case_id) })) });
}
