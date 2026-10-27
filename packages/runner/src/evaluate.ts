import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import type { ContinuationCorpus, EvaluationResult, FrozenCandidate } from '../../contracts/src/index.js';
import { evaluationFailure, evaluationResult, observeCandidate } from './evaluation-core.js';
import { parseStrictJson } from './strict-json.js';
import type { ReferenceVerdict } from './reference-port.js';
import { referenceDirectory } from './reference-files.js';
export { referenceDirectory, REFERENCE_MANIFEST_SHA256 } from './reference-files.js';
export function runReference(cases: unknown, observations: unknown): {exit_code:0|1|2;verdict:ReferenceVerdict|{error:string;detail:string}} {
  const reference = referenceDirectory(), base = resolve('work');
  mkdirSync(base,{recursive:true}); mkdirSync(join(base,'uv-cache'),{recursive:true});
  const directory = mkdtempSync(join(base,'oracle-'));
  try {
    const casePath = join(directory,'cases.json'), observedPath = join(directory,'observations.json');
    writeFileSync(casePath,JSON.stringify(cases)); writeFileSync(observedPath,JSON.stringify(observations));
    let output: string, exit_code: 0|1|2 = 0;
    try { output = execFileSync('uv',['run','--no-project','python',join(reference,'oracle/reference.py'),casePath,observedPath],{encoding:'utf8',timeout:15000,maxBuffer:8*1024*1024,env:{...process.env,UV_CACHE_DIR:join(base,'uv-cache')}}); }
    catch (error) {
      const failure = error as {status?:number;stdout?:string};
      if ((failure.status !== 1 && failure.status !== 2) || typeof failure.stdout !== 'string') throw error;
      exit_code = failure.status; output = failure.stdout;
    }
    const verdict = parseStrictJson(output) as ReferenceVerdict|{error:string;detail:string};
    if (exit_code === 2 ? !('error' in verdict) : !('passed' in verdict) || verdict.passed !== (exit_code === 0)) throw new Error('Oracle output and exit classification differ');
    return {exit_code,verdict};
  } finally { rmSync(directory,{recursive:true,force:true}); }
}
export async function evaluateCandidate(candidate: FrozenCandidate, corpus: ContinuationCorpus): Promise<EvaluationResult> {
  try {
    const observations = observeCandidate(candidate,corpus), result = runReference(corpus.cases,observations);
    if (result.exit_code === 2 || 'error' in result.verdict) return evaluationFailure(candidate,new Error('error' in result.verdict?result.verdict.detail:'Invalid oracle evidence'),observations);
    return evaluationResult(result.verdict,observations);
  } catch (error) { return evaluationFailure(candidate,error); }
}
