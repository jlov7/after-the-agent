import type { ContinuationCorpus, EvaluationResult, FrozenCandidate } from '../../contracts/src/index.js';
import { evaluateSuite } from './reference-port.js';
import { evaluationFailure, evaluationResult, observeCandidate } from './evaluation-core.js';
export async function evaluateCandidate(candidate: FrozenCandidate, corpus: ContinuationCorpus): Promise<EvaluationResult> {
  try { const observations = observeCandidate(candidate,corpus); return evaluationResult(evaluateSuite(corpus.cases,observations),observations); }
  catch (error) { return evaluationFailure(candidate,error); }
}
