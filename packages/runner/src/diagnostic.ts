import { z } from 'zod';
import { canonicalJson } from '../../contracts/src/index.js';
import type { Case, FrozenCandidate, Observation } from '../../contracts/src/index.js';
import type { SubmissionRecord } from '../../engine/src/session.js';
import { immutable } from '../../engine/src/engine.js';
import { buildCorpus, validateCorpus } from './continuations.js';
import { inspectContinuation } from './inspection.js';
import { evaluateCase } from './reference-port.js';

const command = 'node dist/packages/runner/src/reproduce-cli.js file.json';
export interface DiagnosticReproducer {
 readonly schema_version:'1.0'; readonly scope:'one-case-diagnostic';
 readonly candidate:FrozenCandidate; readonly case:Case; readonly observation:Observation;
 readonly expected_verdict:'pass'|'mismatch'; readonly reproduction_command:typeof command;
}
const envelope=z.object({schema_version:z.literal('1.0'),scope:z.literal('one-case-diagnostic'),candidate:z.unknown(),case:z.unknown(),observation:z.unknown(),expected_verdict:z.enum(['pass','mismatch']),reproduction_command:z.literal(command)}).strict();
function reconstruct(candidate:FrozenCandidate,caseId:string){
 const corpus=buildCorpus(candidate),selected=corpus.cases.find(c=>c.case_id===caseId);
 if(!selected)throw new TypeError('Unknown canonical continuation case');
 const inspection=inspectContinuation(candidate,corpus,caseId);
 const observation:Observation={schema_version:'1.0',case_id:caseId,case_sha256:inspection.case_sha256,candidate_sha256:candidate.candidate_sha256,status:'complete',terminal_reason:'submitted',handover_tick:candidate.capture_tick,observed_through_tick:selected.enqueue_until_tick+2,budget_exhausted:false,reset_during_attempt:false,pulses:inspection.frames.flatMap(frame=>frame.events.filter(event=>event.type==='pulse').map(event=>({tick:event.tick,lamp:event.lamp})))};
 return {selected,observation,verdict:evaluateCase(selected,observation).passed?'pass' as const:'mismatch' as const};
}
export function validateReproducer(input:unknown):DiagnosticReproducer {
 const value=envelope.parse(input),candidate=value.candidate as FrozenCandidate;
 if(!value.case||typeof value.case!=='object'||!('case_id' in value.case)||typeof value.case.case_id!=='string')throw new TypeError('Invalid canonical case');
 const actual=reconstruct(candidate,value.case.case_id);
 if(canonicalJson(value.case)!==canonicalJson(actual.selected))throw new TypeError('Case differs from canonical continuation');
 if(canonicalJson(value.observation)!==canonicalJson(actual.observation))throw new TypeError('Observation differs from reconstructed candidate output');
 if(value.expected_verdict!==actual.verdict)throw new TypeError('Diagnostic verdict differs from reconstructed output');
 return immutable(value as DiagnosticReproducer);
}
export function createReproducer(record:SubmissionRecord,caseId:string):DiagnosticReproducer {
 validateCorpus(record.candidate,record.corpus);
 const observations=record.evaluation?.observations.filter(observation=>observation.case_id===caseId);
 if(!observations||observations.length!==1||record.evaluation?.candidate_sha256!==record.candidate.candidate_sha256)throw new TypeError('Exactly one retained observation is required');
 const actual=reconstruct(record.candidate,caseId);
 return validateReproducer({schema_version:'1.0',scope:'one-case-diagnostic',candidate:record.candidate,case:actual.selected,observation:observations[0],expected_verdict:actual.verdict,reproduction_command:command});
}
