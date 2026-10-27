export type ProbeState = 'ready' | 'unavailable' | 'failed' | 'cancelled';
export interface ReadinessCheck { state: ProbeState; detail: string }
export interface ReadinessReport { localStorage: ReadinessCheck; indexedDB: ReadinessCheck; worker: ReadinessCheck; serviceWorker: ReadinessCheck }
const result = (state: ProbeState, detail: string): ReadinessCheck => ({ state, detail });
const probeTimeout = 1500;
function bounded(signal: AbortSignal | undefined, start: (done: (value: ReadinessCheck) => void) => () => void): Promise<ReadinessCheck> {
  return new Promise(resolve => {
    let finished = false, cleanup = () => {};
    const finish = (value: ReadinessCheck) => { if (finished) return; finished = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); cleanup(); resolve(value); };
    const abort = () => finish(result('cancelled', 'Check cancelled.'));
    const timer = setTimeout(() => finish(result('failed', 'Local check timed out.')), probeTimeout);
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    try { cleanup = start(finish); if (finished) cleanup(); } catch { finish(result('failed', 'Local check failed.')); }
  });
}
export async function probeBrowserReadiness(signal?: AbortSignal): Promise<ReadinessReport> {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}`;
  const local = bounded(signal, done => {
    const key = `after-the-agent.readiness.${suffix}`;
    let outcome: ReadinessCheck;
    try { localStorage.setItem(key, 'disposable'); outcome = localStorage.getItem(key) === 'disposable' ? result('ready', 'Disposable value written, read and removed.') : result('failed', 'Disposable value could not be read back.'); }
    catch { outcome = result('unavailable', 'Local storage is unavailable. Download attempts to keep them.'); }
    try { localStorage.removeItem(key); } catch { outcome = result('failed', 'Disposable local-storage cleanup was denied.'); }
    done(outcome);
    return () => {};
  });
  const database = bounded(signal, done => {
    if (typeof indexedDB === 'undefined') { done(result('unavailable', 'IndexedDB is unavailable.')); return () => {}; }
    const name = `after-the-agent.readiness.${suffix}`;
    let connection: IDBDatabase | null = null, stopped = false, deleting = false;
    let outcome = result('cancelled', 'Check cancelled.');
    const remove = () => {
      connection?.close(); connection = null; if (deleting) return; deleting = true;
      try { const deletion = indexedDB.deleteDatabase(name); deletion.onsuccess = () => done(outcome); deletion.onerror = () => done(result('failed', 'Disposable database cleanup failed.')); deletion.onblocked = () => done(result('failed', 'Disposable database cleanup was blocked.')); }
      catch { done(result('failed', 'Disposable database cleanup was denied.')); }
    };
    const finishDatabase = (value: ReadinessCheck) => { outcome = value; remove(); };
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => { if (!stopped) request.result.createObjectStore('probe'); };
    request.onerror = () => finishDatabase(result('unavailable', 'IndexedDB could not open a disposable database.'));
    request.onblocked = () => finishDatabase(result('failed', 'Disposable database was blocked.'));
    request.onsuccess = () => {
      connection = request.result;
      if (stopped) { remove(); return; }
      const transaction = connection.transaction('probe', 'readwrite'), store = transaction.objectStore('probe');
      store.put('disposable', 'value'); const read = store.get('value'); let matched = false;
      read.onsuccess = () => { matched = read.result === 'disposable'; };
      transaction.oncomplete = () => finishDatabase(matched ? result('ready', 'Disposable database written, read and deleted.') : result('failed', 'Disposable database read differed.'));
      transaction.onabort = () => finishDatabase(result('failed', 'Disposable database transaction failed.'));
      transaction.onerror = () => finishDatabase(result('failed', 'Disposable database transaction failed.'));
    };
    return () => { stopped = true; remove(); };
  });
  const worker = bounded(signal, done => {
    if (typeof Worker === 'undefined') { done(result('unavailable', 'Workers are unavailable. Local scoring needs workers.')); return () => {}; }
    const url = URL.createObjectURL(new Blob(['self.onmessage = () => self.postMessage("ready");'], { type: 'text/javascript' }));
    let instance: Worker | null = null;
    try { instance = new Worker(url); instance.onmessage = event => done(event.data === 'ready' ? result('ready', 'Disposable worker replied.') : result('failed', 'Worker reply differed.')); instance.onerror = event => { event.preventDefault(); done(result('failed', 'Disposable worker failed.')); }; instance.postMessage('probe'); }
    catch { URL.revokeObjectURL(url); done(result('unavailable', 'Worker creation is unavailable.')); }
    return () => { instance?.terminate(); URL.revokeObjectURL(url); };
  });
  const service = bounded(signal, done => {
    if (!('serviceWorker' in navigator)) { done(result('unavailable', 'Service workers are unsupported in this context.')); return () => {}; }
    let cancelled = false;
    void navigator.serviceWorker.getRegistration().then(registration => { if (!cancelled) done(result('ready', registration?.active ? 'An active service worker is registered. Offline completeness is checked separately.' : 'Supported. No active service worker is registered.')); }).catch(() => { if (!cancelled) done(result('failed', 'Service-worker readiness could not be read.')); });
    return () => { cancelled = true; };
  });
  const [localStorageCheck, indexedDBCheck, workerCheck, serviceWorker] = await Promise.all([local, database, worker, service]);
  return { localStorage: localStorageCheck, indexedDB: indexedDBCheck, worker: workerCheck, serviceWorker };
}
/** Fixed fields only. Never include location, user agent, attempt bytes or participant text. */
export function readinessDiagnostic(report: ReadinessReport): string {
  const checks = Object.fromEntries((['localStorage', 'indexedDB', 'worker', 'serviceWorker'] as const).map(key => [key, { state: report[key].state }]));
  return JSON.stringify({ format: 'after-the-agent.browser-readiness', version: '1.0', checks }, null, 2);
}
