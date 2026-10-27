import { canonicalJson } from '../../contracts/src/index.js';
import type { Job, Lamp } from '../../contracts/src/index.js';
import { worldAt } from '../../engine/src/engine.js';
import type { SubmissionRecord } from '../../engine/src/session.js';
import { inspectContinuation } from './inspection.js';
export interface FailureExplanation {
  readonly status: 'explained' | 'not_failed' | 'unknown';
  readonly case_id: string; readonly tick: number; readonly lamp: Lamp;
  readonly expected: number | null; readonly observed: number | null;
  readonly facts: readonly string[]; readonly event_seqs: readonly number[]; readonly job_ids: readonly string[];
}
export function explainFailure(record: SubmissionRecord, caseId: string, tick: number, lamp: Lamp): FailureExplanation {
  const unknown: FailureExplanation = { status: 'unknown', case_id: caseId, tick, lamp, expected: null, observed: null, facts: ['The retained evidence does not establish an explanation for this count.'], event_seqs: [], job_ids: [] };
  try {
    const evaluation = record.evaluation, c = record.corpus.cases.find(item => item.case_id === caseId);
    const observation = evaluation?.observations.find(item => item.case_id === caseId);
    if (!evaluation || evaluation.candidate_sha256 !== record.candidate.candidate_sha256 || !c || !observation) return unknown;
    const inspection = inspectContinuation(record.candidate, record.corpus, caseId);
    if (observation.candidate_sha256 !== record.candidate.candidate_sha256 || observation.case_sha256 !== inspection.case_sha256 || observation.status !== 'complete' || observation.observed_through_tick !== c.enqueue_until_tick + 2 || observation.handover_tick !== record.candidate.capture_tick || observation.budget_exhausted || observation.reset_during_attempt) return unknown;
    const pulses = inspection.frames.flatMap(frame => frame.events.filter(event => event.type === 'pulse').map(event => ({ tick: event.tick, lamp: event.lamp })));
    if (canonicalJson(pulses) !== canonicalJson(observation.pulses)) return unknown;
    const frame = inspection.frames.find(item => item.tick === tick);
    if (!frame || tick <= record.candidate.capture_tick) return unknown;
    const expected = frame.expected[lamp], observed = frame.observed[lamp];
    if (expected === observed) return { ...unknown, status: 'not_failed', expected, observed, facts: ['This retained tick and lamp have no count mismatch.'] };
    const enqueueTick = tick - 2, world = { initial_world: c.initial_world, transitions: c.transitions };
    const enqueueWorld = worldAt(world, enqueueTick), deliveryWorld = frame.plant.world;
    const facts = [`At tick ${tick}, ${lamp} owes ${expected} and emitted ${observed}. Nominal enqueue tick ${enqueueTick}: scene active ${enqueueWorld.active}, scene version ${enqueueWorld.epoch}; delivery scene version ${deliveryWorld.epoch}.`];
    if (tick > c.enqueue_until_tick) facts.push('This output is in the final drain after the enqueue horizon.');
    const allEvents = inspection.frames.flatMap(item => item.events);
    const jobs = new Map<string, Job>(record.candidate.plant.queue.map(job => [job.id, job]));
    for (const event of allEvents) if (event.type === 'job_enqueued') jobs.set(event.job.id, event.job);
    const relevantJobs = [...jobs.values()].filter(job => job.due_tick === tick && job.lamp === lamp);
    const ids = new Set(relevantJobs.map(job => job.id));
    const events = allEvents.filter(event => (event.type === 'pulse' || event.type === 'job_discarded') ? ids.has(event.job_id) : event.type === 'job_enqueued' ? ids.has(event.job.id) : event.type === 'world_changed' ? event.tick >= enqueueTick && event.tick <= tick : (event.type === 'clock_fired' || event.type === 'settled_tick') && (event.tick === enqueueTick || event.tick === tick));
    const delivered = events.filter(event => event.type === 'pulse');
    if (delivered.length) facts.push(`${delivered.length} jobs delivered: ${delivered.map(event => event.type === 'pulse' ? event.job_id : '').join(', ')}.`);
    for (const job of relevantJobs) {
      facts.push(`Job ${job.id} used ${job.clock === 'shadow' ? 'Standby' : 'Primary'} clock, queued scene version ${job.enqueue_epoch}, due tick ${job.due_tick}.`);
      if (events.some(event => event.type === 'job_discarded' && event.job_id === job.id)) facts.push(`Job ${job.id} was discarded because its scene version no longer matched.`);
      else if (job.enqueue_epoch !== deliveryWorld.epoch && delivered.some(event => event.type === 'pulse' && event.job_id === job.id)) facts.push(`Job ${job.id} crossed from scene version ${job.enqueue_epoch} to scene version ${deliveryWorld.epoch} while Delivery guard was disabled.`);
    }
    const enqueueFrame = inspection.frames.find(item => item.tick === enqueueTick);
    if (enqueueFrame && enqueueFrame.plant.config.gate_mode === 'cached') facts.push(`At enqueue tick ${enqueueTick}, cached activity was ${enqueueFrame.plant.gate_cache.active}; authoritative world activity was ${enqueueFrame.plant.world.active}.`);
    if (expected > observed && relevantJobs.length === 0) {
      if (enqueueTick <= record.candidate.capture_tick) facts.push('The owed pending work was absent from the captured queue. The retained candidate does not establish whether it was never enqueued or was removed before capture.');
      else if (enqueueFrame && !enqueueFrame.plant.config.clocks.primary && !enqueueFrame.plant.config.clocks.shadow) facts.push('Both clocks were disabled at the nominal enqueue tick; no job was enqueued.');
      else if (enqueueFrame) facts.push(`No matching job was enqueued. Gate mode ${enqueueFrame.plant.config.gate_mode}, cached activity ${enqueueFrame.plant.gate_cache.active}, world activity ${enqueueFrame.plant.world.active}.`);
      else facts.push('The available frames do not establish why the owed work is missing.');
    }
    return { status: 'explained', case_id: caseId, tick, lamp, expected, observed, facts, event_seqs: events.map(event => event.seq), job_ids: [...ids] };
  } catch { return unknown; }
}
