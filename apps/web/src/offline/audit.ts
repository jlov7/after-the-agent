import { z } from 'zod';
const count = z.number().int().nonnegative().max(10000);
const responseSchema = z.object({ type: z.literal('offline-cache-audit'), id: z.string().uuid(), release_id: z.string().regex(/^[a-f0-9]{64}$/), checked: count.min(1), matched: count, missing: count, altered: count }).strict().refine(value => value.matched + value.missing + value.altered === value.checked);
export type OfflineAudit = z.infer<typeof responseSchema>;
type AuditWorker = { scriptURL: string; postMessage: (message: unknown, transfer: Transferable[]) => void };
const repairSchema = z.object({ type: z.literal('offline-cache-repair'), id: z.string().uuid(), status: z.enum(['complete', 'incomplete', 'refused']), repaired: count, reason: z.enum(['verified', 'busy', 'other_tabs', 'timeout', 'mismatch', 'storage', 'unavailable']) }).strict().refine(result => result.status !== 'complete' || result.reason === 'verified');
export function repairOfflineCache(worker: AuditWorker, expectedScript: string, timeoutMs = 35000): Promise<z.infer<typeof repairSchema>> {
  if (worker.scriptURL !== expectedScript) return Promise.reject(new Error('The active offline worker does not belong to this application.'));
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID(), channel = new MessageChannel();
    const finish = (error?: Error, result?: z.infer<typeof repairSchema>) => { clearTimeout(timer); channel.port1.close(); channel.port2.close(); if (error) reject(error); else resolve(result!); };
    const timer = setTimeout(() => finish(new Error('Offline repair outcome is unknown after 35 seconds. Some verified replacements may have completed. Check saved offline files before retrying.')), timeoutMs);
    channel.port1.onmessage = event => {
      const parsed = repairSchema.safeParse(event.data);
      if (!parsed.success || parsed.data.id !== id) finish(new Error('Offline repair returned an invalid response. Check saved offline files before retrying.'));
      else finish(undefined, parsed.data);
    };
    channel.port1.onmessageerror = () => finish(new Error('Offline repair response is unreadable. Check saved offline files before retrying.'));
    try { worker.postMessage({ type: 'repair-cache', id }, [channel.port2]); } catch { finish(new Error('Offline repair could not start.')); }
  });
}
export function auditOfflineCache(worker: AuditWorker, expectedScript: string, signal?: AbortSignal, timeoutMs = 15000): Promise<OfflineAudit> {
  if (worker.scriptURL !== expectedScript) return Promise.reject(new Error('The active offline worker does not belong to this application.'));
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID(), channel = new MessageChannel(); let settled = false;
    const finish = (error?: Error, result?: OfflineAudit) => {
      if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', aborted); channel.port1.close(); channel.port2.close();
      if (error) reject(error); else resolve(result!);
    };
    const aborted = () => finish(new Error('Offline check cancelled.'));
    const timer = setTimeout(() => finish(new Error('Offline file check timed out after 15 seconds. Completeness is unknown.')), timeoutMs);
    channel.port1.onmessage = event => {
      try { const result = responseSchema.parse(event.data); if (result.id !== id) throw new Error('Wrong request'); finish(undefined, result); }
      catch { finish(new Error('Offline file check returned an invalid response. Completeness is unknown.')); }
    };
    channel.port1.onmessageerror = () => finish(new Error('Offline file check response is unreadable. Completeness is unknown.'));
    signal?.addEventListener('abort', aborted, { once: true });
    if (signal?.aborted) { aborted(); return; }
    try { worker.postMessage({ type: 'audit-cache', id }, [channel.port2]); }
    catch { finish(new Error('Offline file check could not start. Completeness is unknown.')); }
  });
}
export function describeOfflineAudit(result: OfflineAudit): string {
  return result.matched === result.checked ? `All saved offline files match this release (${result.checked} files). Browser storage can still be cleared or evicted later.` : `Offline files are incomplete: ${result.missing} missing, ${result.altered} altered, ${result.matched} of ${result.checked} match. This check did not fetch, repair or delete anything. Keep important attempts downloaded separately.`;
}
