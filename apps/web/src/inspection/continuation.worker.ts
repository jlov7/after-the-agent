import { inspectContinuation } from '../../../../packages/runner/src/inspection.js';
import { continuationRequest, continuationResponse } from './protocol.js';

self.onmessage = (event: MessageEvent<unknown>) => {
  const checked = continuationRequest.safeParse(event.data);
  if (!checked.success) return;
  const request = checked.data;
  try {
    const result = inspectContinuation(request.candidate, request.corpus, request.case_id);
    self.postMessage(continuationResponse.parse({ id: request.id, result, error: null }));
  } catch (error) {
    self.postMessage({ id: request.id, result: null, error: (error instanceof Error ? error.message : 'Continuation inspection failed.').slice(0, 512) });
  }
};
