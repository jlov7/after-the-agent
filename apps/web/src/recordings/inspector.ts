import { inspectionResponse, type InspectionSummary } from './inspection-schema.js';
export function inspectRecording(raw: string) {
  let cancel = () => {};
  const promise = new Promise<InspectionSummary>((resolve, reject) => {
    let worker: Worker;
    try { worker = new Worker(new URL('./inspection.worker.ts', import.meta.url), { type: 'module' }); } catch { reject(new Error('Recording inspection worker could not start.')); return; }
    const id = crypto.randomUUID();
    const finish = (summary: InspectionSummary | null, error?: string) => { clearTimeout(timeout); worker.terminate(); if (error) reject(new Error(error)); else if (summary) resolve(summary); };
    const timeout = setTimeout(() => finish(null, 'Recording inspection worker exceeded its 15-second limit.'), 15000);
    cancel = () => finish(null, 'Recording inspection cancelled.');
    worker.onerror = () => finish(null, 'Recording inspection worker stopped unexpectedly.');
    worker.onmessageerror = () => finish(null, 'Recording inspection worker returned unreadable data.');
    worker.onmessage = event => {
      const parsed = inspectionResponse.safeParse(event.data);
      if (!parsed.success || parsed.data.id !== id || parsed.data.error === null && parsed.data.summary === null) { finish(null, 'Recording inspection worker returned an invalid response.'); return; }
      finish(parsed.data.summary, parsed.data.error ?? undefined);
    };
    worker.postMessage({ id, raw });
  });
  return { promise, cancel: () => cancel() };
}
