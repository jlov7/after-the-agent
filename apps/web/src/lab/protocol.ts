import { z } from 'zod';
import { canonicalJson, sha256Json, type FrozenCandidate } from '../../../../packages/contracts/src/index.js';
import { buildCorpus, validateCandidate } from '../../../../packages/runner/src/continuations.js';
import { continuationResponse } from '../inspection/protocol.js';
import { repairEditsSchema, prepareRepairBranch, type RepairLabResult } from '../../../../packages/runner/src/repair-lab.js';
import { evaluationResult } from '../../../../packages/runner/src/evaluation-core.js';
import { caseDigest, expectedPulses, evaluateSuite } from '../../../../packages/runner/src/reference-port.js';
export const labRequest = z.object({ id: z.string().uuid(), type: z.literal('repair-lab'), base: z.custom<FrozenCandidate>(value => { try { validateCandidate(value as FrozenCandidate); return true; } catch { return false; } }), edits: z.tuple([repairEditsSchema, repairEditsSchema]), case_id: z.string().min(1).max(64) }).strict().superRefine((request, context) => {
  try { if (!buildCorpus(request.base).cases.some(c => c.case_id === request.case_id)) throw new Error(); }
  catch { context.addIssue({ code: 'custom', message: 'Unknown lab case' }); }
});
export function parseLabResult(value: unknown, request: z.infer<typeof labRequest>): RepairLabResult {
  if (!value || typeof value !== 'object' || !('base_candidate_sha256' in value) || !('case_id' in value) || !('branches' in value) || value.base_candidate_sha256 !== request.base.candidate_sha256 || value.case_id !== request.case_id || !Array.isArray(value.branches) || value.branches.length !== 2) throw new Error('Lab response binding differs');
  const result = value as RepairLabResult;
  for (const [index, branch] of result.branches.entries()) {
    const prepared = prepareRepairBranch(request.base, request.edits[index]), corpus = buildCorpus(prepared.candidate);
    if (canonicalJson({ base_candidate_sha256: branch.base_candidate_sha256, edits: branch.edits, edits_sha256: branch.edits_sha256, candidate: branch.candidate, changes: branch.changes }) !== canonicalJson(prepared)) throw new Error('Lab branch differs from requested edits');
    continuationResponse.parse({ id: request.id, result: branch.inspection, error: null });
    const c = corpus.cases.find(c => c.case_id === request.case_id)!;
    let seq = prepared.candidate.plant.event_seq, firstMismatch: number | null = null;
    const expectedPulsesForCase = expectedPulses(c);
    const validFrames = branch.inspection.frames.every((frame, index) => {
      const expected = { left: 0, center: 0, right: 0 }, observed = { left: 0, center: 0, right: 0 };
      for (const pulse of expectedPulsesForCase) if (pulse.tick === frame.tick) expected[pulse.lamp]++;
      for (const event of frame.events) if (event.type === 'pulse') observed[event.lamp]++;
      if (canonicalJson(expected) !== canonicalJson(observed) && firstMismatch === null) firstMismatch = frame.tick;
      return frame.events.every(event => event.seq === ++seq && event.tick === frame.tick) && frame.plant.event_seq === seq && canonicalJson(expected) === canonicalJson(frame.expected) && canonicalJson(observed) === canonicalJson(frame.observed) && (index !== 0 || frame.events.length === 0);
    });
    if (!validFrames || branch.inspection.first_mismatch_tick !== firstMismatch || branch.inspection.case_sha256 !== caseDigest(c) || branch.inspection.candidate_sha256 !== prepared.candidate.candidate_sha256 || branch.inspection.case_id !== request.case_id || branch.inspection.frames.length !== 67 || sha256Json(branch.inspection.frames[0]!.plant) !== prepared.candidate.candidate_sha256 || branch.inspection.frames.some((frame, i) => frame.tick !== request.base.capture_tick + i || frame.plant.tick !== frame.tick) || branch.inspection.frames.at(-1)!.tick !== c.enqueue_until_tick + 2) throw new Error('Lab frames differ from the candidate');
    const expected = evaluationResult(evaluateSuite(corpus.cases, branch.evaluation.observations), branch.evaluation.observations);
    if (canonicalJson(expected) !== canonicalJson(branch.evaluation)) throw new Error('Lab evaluation differs from observations');
  }
  return result;
}
