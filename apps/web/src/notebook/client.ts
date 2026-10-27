import { notebookRequest, notebookResponse } from './protocol.js';
import type { ReplayWorkerPort } from '../replay/client.js';
import type { NotebookImportPreview } from './store.js';
export function createNotebookClient(factory: () => ReplayWorkerPort = () => new Worker(new URL('./backup.worker.ts', import.meta.url), { type: 'module' }), timeoutMs = 15000) {
  let worker: ReplayWorkerPort | null = null, previewId: string | null = null;
  let pending: { id: string; type: string; resolve: (value: ReturnType<typeof notebookResponse.parse>) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  const stop = (message: string) => {
    worker?.terminate(); worker = null; previewId = null;
    if (pending) { clearTimeout(pending.timer); pending.reject(new Error(message)); pending = null; }
  };
  const request = (value: unknown) => {
    const parsed = notebookRequest.parse(value);
    if (parsed.type !== 'commit') stop('Notebook operation superseded');
    if (pending) return Promise.reject(new Error('Notebook operation is already running'));
    return new Promise<ReturnType<typeof notebookResponse.parse>>((resolve, reject) => {
      try {
        if (!worker) {
          if (parsed.type === 'commit') throw new Error('Load the backup again before merging.');
          worker = factory(); const owned = worker;
          worker.onmessage = event => {
            if (!pending || worker !== owned) return;
            if (event.data && typeof event.data === 'object' && 'id' in event.data && event.data.id !== pending.id) return;
            try {
              const response = notebookResponse.parse(event.data);
              if (response.error !== null) { stop(response.error); return; }
              if (pending.type === 'backup' ? response.raw === null || response.preview !== null : response.preview === null || response.raw !== null) throw new Error('Invalid notebook worker response');
              const current = pending; pending = null; clearTimeout(current.timer);
              if (current.type === 'preview') previewId = current.id; else { previewId = null; worker?.terminate(); worker = null; }
              current.resolve(response);
            } catch { stop('Invalid notebook worker response'); }
          };
          worker.onerror = () => { if (worker === owned) stop('Notebook worker failed'); };
          worker.onmessageerror = () => { if (worker === owned) stop('Notebook worker response unreadable'); };
        }
        pending = { id: parsed.id, type: parsed.type, resolve, reject, timer: setTimeout(() => stop('Notebook operation timed out after 15 seconds. Check the notebook before retrying.'), timeoutMs) };
        worker.postMessage(parsed);
      } catch { stop('Notebook worker could not start'); reject(new Error('Notebook worker could not start')); }
    });
  };
  return {
    preview: async (raw: string): Promise<NotebookImportPreview> => (await request({ id: crypto.randomUUID(), type: 'preview', raw })).preview!,
    commit: async (): Promise<NotebookImportPreview> => (await request({ id: crypto.randomUUID(), type: 'commit', preview_id: previewId })).preview!,
    backup: async (): Promise<string> => (await request({ id: crypto.randomUUID(), type: 'backup' })).raw!,
    cancel: () => stop('Notebook operation cancelled. Check stored entries if a merge had already begun.'),
    dispose: () => stop('Notebook closed'),
  };
}
