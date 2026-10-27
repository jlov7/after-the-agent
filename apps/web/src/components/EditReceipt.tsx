import type { EditReceiptData } from '../../../../packages/runner/src/edit-receipt.js';
import './interaction.css';
export { createEditReceipt } from '../../../../packages/runner/src/edit-receipt.js';
export type { EditReceiptData } from '../../../../packages/runner/src/edit-receipt.js';
const labels = { applied: 'Edit applied', no_op: 'Accepted, no configuration change', retry: 'Retained retry, no new change', rejected: 'Edit rejected, no change' };
const fields: Record<string, string> = { 'config.clocks.primary': 'Primary clock', 'config.clocks.shadow': 'Standby clock', 'config.gate_mode': 'Gate source', 'config.epoch_guard': 'Delivery guard', 'gate_cache.active': 'Cached scene activity', 'gate_cache.epoch': 'Cached scene version' };
export function describeEditChange(change: EditReceiptData['changes'][number]): string {
  const values: Record<string, string> = change.path === 'gate_cache.active' ? { true: 'Active', false: 'Inactive' } : { true: 'On', false: 'Off', '"live"': 'Live', '"cached"': 'Cached' };
  return `${fields[change.path] ?? change.path}: ${values[change.before] ?? change.before} to ${values[change.after] ?? change.after}`;
}
export function EditReceipt({ receipt }: { receipt: EditReceiptData | null }) {
  if (!receipt) return null;
  return <section className="ata-edit-receipt" role="status" aria-label="Edit receipt"><strong>{labels[receipt.status]}</strong><p>{receipt.tick_before === receipt.tick_after ? `Tick stayed at ${receipt.tick_after}.` : `Tick ${receipt.tick_before} to ${receipt.tick_after}.`}</p>{receipt.error && <p>{receipt.error}</p>}{receipt.changes.length > 0 && <ul>{receipt.changes.map(change => <li key={change.path}>{describeEditChange(change)}</li>)}</ul>}<p>{receipt.retained_job_ids.length} pending {receipt.retained_job_ids.length === 1 ? 'job kept' : 'jobs kept'}.{receipt.removed_job_ids.length > 0 && ` ${receipt.removed_job_ids.length} removed.`}</p><details><summary>Exact edit details</summary><p>Request {receipt.request_id}.</p>{receipt.changes.length > 0 && <ul>{receipt.changes.map(change => <li key={change.path}><code>{change.path}: {change.before} to {change.after}</code></li>)}</ul>}<p>Retained pending work: {receipt.retained_job_ids.length ? receipt.retained_job_ids.join(', ') : 'none'}.</p>{receipt.removed_job_ids.length > 0 && <p>Removed pending work: {receipt.removed_job_ids.join(', ')}.</p>}</details></section>;
}
