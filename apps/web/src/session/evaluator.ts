import type { CandidateEvaluator, EvaluationResult, WorkerResponse } from '../../../../packages/contracts/src/index.js';
export function createWorkerEvaluator() {
  let worker: Worker | null = null;
  let active: { cancel: () => void } | null = null;
  const evaluate: CandidateEvaluator = (candidate, corpus) => {
    if (active) return Promise.resolve({ status: 'worker_error', candidate_sha256: candidate.candidate_sha256, cases: [], observations: [], reason: 'An evaluation is already running.' });
    return new Promise<EvaluationResult>(resolve => {
      worker ??= new Worker(new URL('./evaluation.worker.ts', import.meta.url), { type: 'module' });
      const current = worker;
      const id = crypto.randomUUID();
      const failure = (status: 'worker_error' | 'cancelled', reason: string): EvaluationResult => ({ status, candidate_sha256: candidate.candidate_sha256, cases: [], observations: [], reason });
      const finish = (result: EvaluationResult) => {
        clearTimeout(timeout); current.onmessage = null; current.onerror = null; current.onmessageerror = null; active = null;
        if (result.status === 'worker_error' || result.status === 'cancelled') { current.terminate(); worker = null; }
        resolve(result);
      };
      const timeout = setTimeout(() => finish(failure('worker_error', 'Evaluation exceeded its 15-second limit.')), 15000);
      active = { cancel: () => finish(failure('cancelled', 'Evaluation cancelled.')) };
      current.onmessage = (event: MessageEvent<WorkerResponse>) => {
        if (event.data.id !== id) return;
        const result = event.data.result;
        if (result.candidate_sha256 !== candidate.candidate_sha256 || !Array.isArray(result.cases) || !Array.isArray(result.observations)) return finish(failure('worker_error', 'Worker response did not match the submitted candidate.'));
        finish(result);
      };
      current.onerror = () => finish(failure('worker_error', 'Evaluation worker stopped unexpectedly.'));
      current.onmessageerror = () => finish(failure('worker_error', 'Evaluation worker returned unreadable data.'));
      current.postMessage({ id, type: 'evaluate', candidate, corpus });
    });
  };
  return { evaluate, cancel: () => active?.cancel(), dispose: () => { active?.cancel(); worker?.terminate(); worker = null; } };
}
