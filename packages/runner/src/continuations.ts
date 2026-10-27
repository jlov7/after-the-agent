import policy from '../../../fixtures/continuation-policy.json' with { type: 'json' };
import { canonicalJson, sha256Json, validatePlantShape } from '../../contracts/src/index.js';
import type { ContinuationCorpus, FrozenCandidate, World } from '../../contracts/src/index.js';
import { InvalidEvidence, validateCase } from './reference-port.js';
export class EvaluationBudgetLimit extends Error {}
export function validateCandidate(candidate: FrozenCandidate): void {
  validatePlantShape(candidate.plant);
  const keys = ['schema_version','plant','world_prefix','task','candidate_sha256','attempt_id','capture_tick','original_handover_tick','terminal_reason','reset_during_attempt'];
  if (canonicalJson(Object.keys(candidate).sort()) !== canonicalJson(keys.sort()) || candidate.schema_version !== '1.0' || candidate.terminal_reason !== 'submitted' || candidate.reset_during_attempt !== false) throw new InvalidEvidence('Invalid candidate provenance');
  if ((typeof candidate.attempt_id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(candidate.attempt_id) || /[^A-Za-z0-9_.-]/.test(candidate.attempt_id)) || candidate.capture_tick !== candidate.plant.tick || !Number.isInteger(candidate.original_handover_tick) || candidate.original_handover_tick < 0 || candidate.original_handover_tick > candidate.capture_tick) throw new InvalidEvidence('Invalid candidate identity or cut');
  if (candidate.candidate_sha256 !== sha256Json(candidate.plant)) throw new InvalidEvidence('Candidate plant hash differs');
  const task = candidate.task;
  const fixed = { schema_version:'1.0',task_id:'alternating-lights-v1',scenario:task.scenario,period:4,delay:2,max_tick:4096,enqueue_until_tick:4094,max_queue:128,max_pulses:16384,max_audit_records:10000,recovery_seconds:300 };
  if (!['valid-pending','stale-queue','duplicate-clock','cached-gate'].includes(task.scenario) || canonicalJson(task) !== canonicalJson(fixed)) throw new InvalidEvidence('Task identity or fixed budgets differ');
  const history = candidate.world_prefix;
  if (canonicalJson(Object.keys(history).sort()) !== canonicalJson(['initial_world','transitions'])) throw new InvalidEvidence('Invalid world prefix');
  validateCase({schema_version:'1.0',case_id:'candidate-prefix',handover_tick:0,enqueue_until_tick:4094,initial_world:history.initial_world,transitions:history.transitions});
  const world: World = {...history.initial_world,epoch:1};
  for (const change of history.transitions) {
    if (change.tick > candidate.capture_tick) throw new InvalidEvidence('Prefix includes future world');
    if (change.scene_id !== world.scene_id || change.active !== world.active) world.epoch++;
    world.scene_id = change.scene_id; world.active = change.active;
  }
  if (canonicalJson(world) !== canonicalJson(candidate.plant.world)) throw new InvalidEvidence('Candidate world is unreachable from prefix');
  if (candidate.capture_tick > 4030) throw new EvaluationBudgetLimit('Candidate cannot fit the 64 tick continuation and two tick drain');
}
export function buildCorpus(candidate: FrozenCandidate): ContinuationCorpus {
  validateCandidate(candidate);
  const cut = candidate.capture_tick;
  return {schema_version:'1.0',policy_version:'1.0.0',candidate_sha256:candidate.candidate_sha256,cases:policy.patterns.map(pattern => ({
    schema_version:'1.0',case_id:pattern.case_id,handover_tick:cut,enqueue_until_tick:cut+64,
    initial_world:structuredClone(candidate.world_prefix.initial_world),
    transitions:[...structuredClone(candidate.world_prefix.transitions),...pattern.transitions.map((change,index) => ({tick:cut+change.offset,scene_id:pattern.same_scene ? candidate.plant.world.scene_id : `${pattern.case_id}.${index}`,active:change.active}))],
  }))};
}
export const buildContinuations = buildCorpus;
export function validateCorpus(candidate: FrozenCandidate, corpus: ContinuationCorpus): void {
  const expected = buildCorpus(candidate);
  if (canonicalJson(Object.keys(corpus).sort()) !== canonicalJson(['schema_version','policy_version','candidate_sha256','cases'].sort()) || corpus.schema_version !== expected.schema_version || corpus.policy_version !== expected.policy_version || corpus.candidate_sha256 !== expected.candidate_sha256 || !Array.isArray(corpus.cases) || corpus.cases.length !== expected.cases.length || corpus.cases.some((c,index) => canonicalJson(c) !== canonicalJson(expected.cases[index]))) throw new InvalidEvidence('Corpus must contain exactly the twelve frozen policy continuations for this candidate');
}
