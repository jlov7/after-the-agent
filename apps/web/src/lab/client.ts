import { immutable } from '../../../../packages/engine/src/engine.js';
import type { FrozenCandidate } from '../../../../packages/contracts/src/index.js';
import { parseReplayNotes, type ReplayNotes } from '../../../../packages/runner/src/replay-annotations.js';
import type { ReplayWorkerPort } from '../replay/client.js';
import { labRequest, parseLabResult } from './protocol.js';
function operation<T>(request: { id: string }, factory: () => ReplayWorkerPort, parse: (value: unknown) => T, timeoutMs: number) {
  let cancel = () => {};
  const promise = new Promise<T>((resolve, reject) => {
    let worker: ReplayWorkerPort;
    try { worker = factory(); } catch { reject(new Error('Exploration worker could not start')); return; }
    let settled = false;
    const finish = (error?: Error, result?: T) => {
      if (settled) return; settled = true; clearTimeout(timer); worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null; worker.terminate();
      if (error) reject(error); else resolve(immutable(result!));
    };
    const timer = setTimeout(() => finish(new Error('Exploration worker timed out after its 15-second limit')), timeoutMs);
    cancel = () => finish(new Error('Exploration cancelled'));
    worker.onmessage = event => {
      if (event.data && typeof event.data === 'object' && 'id' in event.data && event.data.id !== request.id) return;
      try {
        const data = event.data as { id?: unknown; error?: unknown; result?: unknown };
        if (!data || data.id !== request.id) throw new Error('Invalid exploration worker response');
        if (data.error !== null) throw new Error(typeof data.error === 'string' ? data.error.slice(0, 512) : 'Invalid exploration worker error');
        finish(undefined, parse(data.result));
      } catch (error) { finish(error instanceof Error ? error : new Error('Invalid exploration worker response')); }
    };
    worker.onerror = () => finish(new Error('Exploration worker failed')); worker.onmessageerror = () => finish(new Error('Exploration response unreadable'));
    try { worker.postMessage(request); } catch { finish(new Error('Exploration request could not be sent')); }
  });
  return { promise, cancel: () => cancel() };
}
export function startRepairLab(base: FrozenCandidate, edits: unknown, caseId: string, factory: () => ReplayWorkerPort = () => new Worker(new URL('./repair.worker.ts', import.meta.url), { type: 'module' }), timeoutMs = 15000) {
  const request = labRequest.parse({ id: crypto.randomUUID(), type: 'repair-lab', base, edits, case_id: caseId });
  // Validate actions, counts and candidate before creating a worker.
  return operation(request, factory, value => parseLabResult(value, request), timeoutMs);
}
export function startReplayNotesImport(raw: string, source: string, kind: 'attempt' | 'recording', trustedLiveSha256?: string): { promise: Promise<ReplayNotes>; cancel: () => void } {
  parseReplayNotes(raw, source);
  const request = { id: crypto.randomUUID(), raw, source, kind, ...(trustedLiveSha256 ? { trustedLiveSha256 } : {}) };
  return operation(request, () => new Worker(new URL('./annotations.worker.ts', import.meta.url), { type: 'module' }), value => parseReplayNotes(JSON.stringify(value), source), 15000);
}
