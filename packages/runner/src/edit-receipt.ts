import { canonicalJson } from '../../contracts/src/index.js';
import type { BoardResult, CanonicalPlant } from '../../contracts/src/index.js';
export interface EditReceiptData {
  readonly request_id: string; readonly status: 'applied' | 'no_op' | 'retry' | 'rejected';
  readonly tick_before: number; readonly tick_after: number;
  readonly changes: readonly { readonly path: string; readonly before: string; readonly after: string }[];
  readonly retained_job_ids: readonly string[]; readonly removed_job_ids: readonly string[];
  readonly error: string | null;
}
/** For mutation receipts. A retained response at or below the pre-action revision is a retry. */
export function createEditReceipt(before: CanonicalPlant, result: BoardResult): EditReceiptData {
  const status = result.outcome === 'rejected' ? 'rejected' : result.revision <= before.revision ? 'retry' : result.no_op ? 'no_op' : 'applied';
  const after = status === 'retry' || status === 'rejected' ? before : result.observation.plant;
  const changes: { path: string; before: string; after: string }[] = [];
  const compare = (path: string, a: unknown, b: unknown) => { if (canonicalJson(a) !== canonicalJson(b)) changes.push({ path, before: canonicalJson(a), after: canonicalJson(b) }); };
  for (const key of ['primary', 'shadow'] as const) compare(`config.clocks.${key}`, before.config.clocks[key], after.config.clocks[key]);
  for (const key of ['gate_mode', 'epoch_guard'] as const) compare(`config.${key}`, before.config[key], after.config[key]);
  for (const key of ['active', 'epoch'] as const) compare(`gate_cache.${key}`, before.gate_cache[key], after.gate_cache[key]);
  const pending = new Set(after.queue.map(job => job.id));
  return { request_id: result.request_id, status, tick_before: before.tick, tick_after: after.tick, changes, retained_job_ids: before.queue.filter(job => pending.has(job.id)).map(job => job.id), removed_job_ids: before.queue.filter(job => !pending.has(job.id)).map(job => job.id), error: result.error ? `${result.error.code}: ${result.error.message}` : null };
}
