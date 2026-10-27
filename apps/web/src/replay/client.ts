import { parseReplayWorkerResponse, replayWorkerRequest, type ReplayWorkerResponse } from './protocol.js';
export const replayWorkerTimeoutMs = 15000;
export interface ReplayWorkerPort {
  onmessage: ((event: MessageEvent<unknown>) => void) | null; onerror: ((event: ErrorEvent) => void) | null; onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(value: unknown): void; terminate(): void;
}
export function createReplayClient(factory: () => ReplayWorkerPort = () => new Worker(new URL('./replay.worker.ts', import.meta.url), { type: 'module' }), timeoutMs = replayWorkerTimeoutMs) {
  let worker: ReplayWorkerPort | null = null;
  let pending: { id: string; resolve(value: ReplayWorkerResponse): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> } | null = null;
  const stop = (message: string) => {
    worker?.terminate(); worker = null;
    if (pending) { clearTimeout(pending.timer); pending.reject(new Error(message)); pending = null; }
  };
  const request = (value: ReplayClientRequest): Promise<ReplayWorkerResponse> => {
    if (pending) stop('Replay inspection superseded');
    if (value.type === 'load') stop('Replay inspection superseded');
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      try {
        const parsed = replayWorkerRequest.parse({ ...value, id });
        if (!worker) {
          if (value.type !== 'load') throw new Error('Load an attempt or recording before seeking');
          worker = factory();
          const ownedWorker = worker;
          worker.onmessage = event => {
            if (!pending || worker !== ownedWorker) return;
            // Late responses cannot settle a different request. Malformed responses
            // from the current worker end it rather than leaving a dangling seek.
            if (event.data && typeof event.data === 'object' && 'id' in event.data && event.data.id !== pending.id) return;
            try {
              const response = parseReplayWorkerResponse(event.data);
              if (response.error) { stop(response.error); return; }
              const current = pending; pending = null; clearTimeout(current.timer); current.resolve(response);
            } catch { stop('Invalid replay worker response'); }
          };
          worker.onerror = () => { if (worker === ownedWorker) stop('Replay worker failed'); };
          worker.onmessageerror = () => { if (worker === ownedWorker) stop('Replay worker response could not be read'); };
        }
        pending = { id, resolve, reject, timer: setTimeout(() => stop('Replay inspection timed out after 15 seconds'), timeoutMs) };
        worker.postMessage(parsed);
      } catch (error) { stop('Replay worker could not start'); reject(error instanceof Error ? error : new Error('Replay worker could not start')); }
    });
  };
  return { load: (raw: string, kind: 'attempt' | 'recording' | 'packet', trustedLiveSha256?: string) => request({ type: 'load', raw, kind, ...(trustedLiveSha256 ? { trustedLiveSha256 } : {}) }), seek: (position: number) => request({ type: 'seek', position }), cancel: () => stop('Replay inspection cancelled'), dispose: () => stop('Replay inspection closed') };
}
type ReplayClientRequest = { type: 'load'; raw: string; kind: 'attempt' | 'recording' | 'packet'; trustedLiveSha256?: string } | { type: 'seek'; position: number };
