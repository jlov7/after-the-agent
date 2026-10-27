import { evaluateCandidate } from '../../../../packages/runner/src/evaluate-browser.js';
import type { WorkerRequest, WorkerResponse } from '../../../../packages/contracts/src/index.js';
self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type !== 'evaluate') return;
  try {
    const result = await evaluateCandidate(request.candidate, request.corpus);
    self.postMessage({ id: request.id, result } satisfies WorkerResponse);
  } catch (error) {
    self.postMessage({ id: request.id, result: { status: 'worker_error', candidate_sha256: request.candidate.candidate_sha256, cases: [], observations: [], reason: error instanceof Error ? error.message : 'Worker evaluation failed' } } satisfies WorkerResponse);
  }
};
