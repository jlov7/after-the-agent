import { z } from 'zod';
import { canonicalJson, sha256Json, validateRequest, type Action, type FrozenCandidate, type EvaluationResult } from '../../contracts/src/index.js';
import { cloneEngine, dispatch, immutable, setEnginePhase, snapshot } from '../../engine/src/engine.js';
import { buildCorpus, validateCandidate } from './continuations.js';
import { evaluateCandidate } from './evaluate-browser.js';
import { inspectContinuation } from './inspection.js';
import type { ContinuationInspection } from './inspection-types.js';

export type RepairEdit = Exclude<Action, { type: 'advance' | 'inspect' }>;
export const repairActionLimit = 32;
export const repairEditsSchema = z.array(z.custom<RepairEdit>(value => {
  try {
    validateRequest({ schema_version: '1.0', request_id: 'lab.validate', expected_revision: 0, action: value });
    return !!value && typeof value === 'object' && 'type' in value && ['set_clock', 'set_epoch_guard', 'set_gate_mode', 'refresh_gate', 'drop_jobs'].includes(String(value.type));
  } catch { return false; }
})).max(repairActionLimit);
export interface RepairBranch {
  readonly base_candidate_sha256: string; readonly edits: readonly RepairEdit[]; readonly edits_sha256: string;
  readonly candidate: FrozenCandidate; readonly changes: readonly { path: string; before: string; after: string }[];
}
export interface RepairLabBranch extends RepairBranch { readonly evaluation: EvaluationResult; readonly inspection: ContinuationInspection }
export interface RepairLabResult { readonly base_candidate_sha256: string; readonly case_id: string; readonly branches: readonly [RepairLabBranch, RepairLabBranch] }
export function prepareRepairBranch(base: FrozenCandidate, input: unknown): RepairBranch {
  validateCandidate(base);
  const edits = repairEditsSchema.parse(input), engine = cloneEngine(base.plant, base.world_prefix);
  setEnginePhase(engine, 'recovery');
  for (const [index, action] of edits.entries()) {
    const result = dispatch(engine, { schema_version: '1.0', request_id: `lab.${index}`, expected_revision: snapshot(engine).revision, action }, { actor_id: 'repair-lab', role: 'human', phase: 'recovery' });
    if (result.outcome !== 'accepted') throw new Error(`Repair edit ${index + 1} rejected: ${result.error?.code}`);
  }
  const plant = snapshot(engine), candidate = { ...base, plant, candidate_sha256: sha256Json(plant) };
  const changes: { path: string; before: string; after: string }[] = [];
  for (const key of ['config', 'gate_cache', 'queue', 'revision', 'event_seq'] as const) if (canonicalJson(base.plant[key]) !== canonicalJson(plant[key])) changes.push({ path: key, before: canonicalJson(base.plant[key]), after: canonicalJson(plant[key]) });
  return immutable({ base_candidate_sha256: base.candidate_sha256, edits, edits_sha256: sha256Json(edits), candidate, changes });
}
export async function runRepairLab(base: FrozenCandidate, alternatives: unknown, caseId: string): Promise<RepairLabResult> {
  const edits = z.tuple([repairEditsSchema, repairEditsSchema]).parse(alternatives), corpus = buildCorpus(base);
  if (!corpus.cases.some(c => c.case_id === caseId)) throw new Error('Unknown lab continuation case');
  const branches = await Promise.all(edits.map(async actions => {
    const branch = prepareRepairBranch(base, actions), branchCorpus = buildCorpus(branch.candidate);
    if (canonicalJson(branchCorpus.cases) !== canonicalJson(corpus.cases)) throw new Error('Lab continuation schedules differ');
    return { ...branch, evaluation: await evaluateCandidate(branch.candidate, branchCorpus), inspection: inspectContinuation(branch.candidate, branchCorpus, caseId) };
  }));
  return immutable({ base_candidate_sha256: base.candidate_sha256, case_id: caseId, branches: branches as [RepairLabBranch, RepairLabBranch] });
}
