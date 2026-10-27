import { canonicalJson } from '../../../../packages/contracts/src/index.js';
import type { SavedSession } from '../../../../packages/engine/src/session.js';

const same = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);
const prefix = (retained: readonly unknown[], incoming: readonly unknown[]) => retained.length <= incoming.length && retained.every((item, index) => same(item, incoming[index]));
const primary = (saved: SavedSession) => saved.submissions.map(({ candidate, corpus, admitted_at_ms }) => ({ candidate, corpus, admitted_at_ms }));
function phase(saved: SavedSession, now: number) {
  return saved.phase === 'recovery' && saved.deadline_at_ms !== null && now > saved.deadline_at_ms ? saved.submissions.length ? 'submitted' : 'timed_out' : saved.phase;
}
/** Both inputs must first pass engine replay validation. Visibility and recomputed verdicts do not grant editing authority. */
export function assertSessionExtends(retained: SavedSession, incoming: SavedSession, now: number): void {
  const unchanged = ['schema_version', 'attempt_id', 'attempt_started_at_ms', 'scenario', 'mode', 'condition', 'playback_source', 'previous_attempts'] as const;
  // A stale recovery autosave has not observed finality. A timely check may still be waiting to save.
  const before = retained.phase, after = phase(incoming, now);
  const rank = { setup: 0, playback: 1, recovery: 2, submitted: 3, timed_out: 3, abandoned_reset: 3 };
  if (unchanged.some(key => !same(retained[key], incoming[key])) ||
    !prefix(retained.commands, incoming.commands) || !prefix(primary(retained), primary(incoming)) || !prefix(retained.precommitments, incoming.precommitments) ||
    retained.playback_index > incoming.playback_index || retained.request_sequence > incoming.request_sequence ||
    (retained.commands.length === incoming.commands.length && (retained.plant_sha256 !== incoming.plant_sha256 || retained.playback_index !== incoming.playback_index || retained.request_sequence !== incoming.request_sequence)) ||
    (retained.handover_at_ms !== null && (retained.handover_at_ms !== incoming.handover_at_ms || retained.deadline_at_ms !== incoming.deadline_at_ms)) ||
    rank[before] > rank[after] || (rank[before] === 3 && (before !== after || retained.commands.length !== incoming.commands.length || retained.submissions.length !== incoming.submissions.length || retained.precommitments.length !== incoming.precommitments.length))) {
    throw new Error('This saved copy is older than, or diverges from, the latest known state of this attempt. Download it as evidence, or resume the latest autosave.');
  }
}
