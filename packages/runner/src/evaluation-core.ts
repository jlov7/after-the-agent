import { cloneEngine, dispatch, engineEvents, setInputHorizon, snapshot, setEnginePhase } from '../../engine/src/engine.js';
import type { ContinuationCorpus, EvaluationResult, FrozenCandidate, Observation } from '../../contracts/src/index.js';
import { EvaluationBudgetLimit, validateCorpus } from './continuations.js';
import { caseDigest, type ReferenceVerdict } from './reference-port.js';
export function observeCandidate(candidate: FrozenCandidate, corpus: ContinuationCorpus): Observation[] {
  validateCorpus(candidate, corpus);
  return corpus.cases.map(c => {
    const engine = cloneEngine(candidate.plant, {initial_world:c.initial_world,transitions:c.transitions});
    setEnginePhase(engine,'recovery');
    setInputHorizon(engine,c.enqueue_until_tick);
    let step = 0;
    while (snapshot(engine).tick < c.enqueue_until_tick + 2) {
      const plant = snapshot(engine), ticks = Math.min(64,c.enqueue_until_tick+2-plant.tick);
      const result = dispatch(engine,{schema_version:'1.0',request_id:`evaluation.${step++}`,expected_revision:plant.revision,action:{type:'advance',ticks}},{actor_id:'evaluator',role:'controller',phase:'recovery'});
      if (result.outcome !== 'accepted') {
        if (result.error?.code === 'BUDGET_LIMIT' || result.error?.code === 'HISTORY_CAPACITY') throw new EvaluationBudgetLimit(`Continuation ${c.case_id} exhausted its budget`);
        throw new Error(`Continuation ${c.case_id} failed: ${result.error?.code}`);
      }
    }
    return {schema_version:'1.0',case_id:c.case_id,case_sha256:caseDigest(c),candidate_sha256:candidate.candidate_sha256,status:'complete',terminal_reason:'submitted',handover_tick:candidate.capture_tick,observed_through_tick:snapshot(engine).tick,budget_exhausted:false,reset_during_attempt:false,pulses:engineEvents(engine).filter(event=>event.type==='pulse' && event.tick>candidate.capture_tick).map(event=>({tick:event.tick,lamp:(event as Extract<typeof event,{type:'pulse'}>).lamp}))};
  });
}
export function evaluationResult(verdict: ReferenceVerdict, observations: readonly Observation[]): EvaluationResult {
  const expand = (pulses: ReferenceVerdict['results'][number]['missing']) => pulses.flatMap(({tick,lamp,count}) => Array.from({length:count},()=>({tick,lamp})));
  return {status:verdict.passed?'pass':'mismatch',candidate_sha256:verdict.candidate_sha256,observations,cases:verdict.results.map(r=>({case_id:r.case_id,status:r.passed?'pass':'mismatch',missing:expand(r.missing),extra:expand(r.extra)}))};
}
export function evaluationFailure(candidate: FrozenCandidate, error: unknown, observations: readonly Observation[] = []): EvaluationResult {
  return {status:error instanceof EvaluationBudgetLimit?'budget_limit':'invalid',candidate_sha256:candidate?.candidate_sha256 ?? '',observations,cases:[],reason:error instanceof Error?error.message:'Invalid evaluation'};
}
