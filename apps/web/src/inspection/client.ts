import type { z } from 'zod';
import { canonicalJson, sha256Json } from '../../../../packages/contracts/src/index.js';
import type { ContinuationCorpus, FrozenCandidate } from '../../../../packages/contracts/src/index.js';
import { immutable } from '../../../../packages/engine/src/engine.js';
import type { ContinuationInspection } from '../../../../packages/runner/src/inspection-types.js';
import { caseDigest, expectedPulses } from '../../../../packages/runner/src/reference-port.js';
import { continuationRequest, continuationResponse } from './protocol.js';

export function inspectContinuationInWorker(candidate: FrozenCandidate, corpus: ContinuationCorpus, caseId: string): { promise: Promise<ContinuationInspection>; cancel: () => void } {
  let cancel = (): void => {};
  const promise = new Promise<ContinuationInspection>((resolve, reject) => {
    let current: Worker;
    let request: z.infer<typeof continuationRequest>;
    try {
      request = continuationRequest.parse(structuredClone({ id: crypto.randomUUID(), type: 'inspect-continuation', candidate, corpus, case_id: caseId }));
      current = new Worker(new URL('./continuation.worker.ts', import.meta.url), { type: 'module' });
    } catch { reject(new Error('Continuation inspection could not start.')); return; }
    let settled = false;
    const finish = (result: ContinuationInspection | null, error?: Error): void => {
      if (settled) return;
      settled = true; clearTimeout(timeout); current.onmessage = null; current.onerror = null; current.onmessageerror = null; current.terminate();
      if (result) resolve(immutable(result)); else reject(error);
    };
    const timeout = setTimeout(() => finish(null, new Error('Continuation inspection exceeded its 15-second limit.')), 15000);
    cancel = () => finish(null, new Error('Continuation inspection cancelled.'));
    const c = request.corpus.cases.find(c => c.case_id === request.case_id)!;
    const expected = expectedPulses(c);
    current.onmessage = (event: MessageEvent<unknown>) => {
      if (typeof event.data === 'object' && event.data !== null && 'id' in event.data && event.data.id !== request.id) return;
      const checked = continuationResponse.safeParse(event.data);
      if (!checked.success || checked.data.id !== request.id) { finish(null, new Error('Invalid continuation worker response.')); return; }
      const { result, error } = checked.data;
      if (result === null) { finish(null, new Error(error!)); return; }
      let mismatch: number | null = null, seq = request.candidate.plant.event_seq;
      const validFrames = result.frames.length === c.enqueue_until_tick + 3 - request.candidate.capture_tick && result.frames.every((frame, index) => {
        const required = { left: 0, right: 0, center: 0 }, observed = { left: 0, right: 0, center: 0 };
        for (const pulse of expected) if (pulse.tick === frame.tick) required[pulse.lamp]++;
        for (const event of frame.events) if (event.type === 'pulse') observed[event.lamp]++;
        const validEvents = frame.events.every(event => event.tick === frame.tick && event.seq === ++seq);
        if (canonicalJson(required) !== canonicalJson(observed) && mismatch === null) mismatch = frame.tick;
        return frame.tick === request.candidate.capture_tick + index && frame.plant.tick === frame.tick && validEvents && frame.plant.event_seq === seq && canonicalJson(frame.expected) === canonicalJson(required) && canonicalJson(frame.observed) === canonicalJson(observed) && (index !== 0 || (frame.events.length === 0 && sha256Json(frame.plant) === request.candidate.candidate_sha256));
      });
      if (result.candidate_sha256 !== request.candidate.candidate_sha256 || result.case_id !== request.case_id || result.case_sha256 !== caseDigest(c) || !validFrames || result.first_mismatch_tick !== mismatch) { finish(null, new Error('Continuation worker response did not match the requested candidate or case.')); return; }
      finish(result);
    };
    current.onerror = () => finish(null, new Error('Continuation worker stopped unexpectedly.'));
    current.onmessageerror = () => finish(null, new Error('Continuation worker returned unreadable data.'));
    try { current.postMessage(request); } catch { finish(null, new Error('Continuation inspection request could not be sent.')); }
  });
  return { promise, cancel: () => cancel() };
}
