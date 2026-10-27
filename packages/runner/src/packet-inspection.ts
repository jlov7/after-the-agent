import { canonicalJson } from '../../contracts/src/index.js';
import { compactAttemptExport, createRecordedSession, type SessionPlaybackSource } from '../../engine/src/session.js';
import { attemptByteLimit, packetInventory, parseCompactAttempt, parseEvidencePacket } from './evidence-packet.js';
import { packetJson } from './evidence-packet-json.js';

export interface PacketInspectionSummary {
  readonly entries: number;
  readonly playback_source: 'absent' | 'consistent' | 'missing';
  readonly declared_build: string | null;
}
/** Local consistency only. Full submission scoring belongs to the independent CLI. */
export function inspectPacket(raw: string): { attempt: string; summary: PacketInspectionSummary } {
  const packet = parseEvidencePacket(raw), attempt = parseCompactAttempt(packet.attempt);
  if (canonicalJson(packet.inventory) !== canonicalJson(packetInventory(packet.attempt, packet.playback_source))) throw new Error('Packet inventory differs from its exact embedded bytes');
  let sourceStatus: PacketInspectionSummary['playback_source'] = attempt.playback_source === null ? 'absent' : 'missing';
  if (packet.playback_source !== null) {
    if (attempt.playback_source === null || attempt.mode !== 'public' || attempt.setup.task.scenario !== 'stale-queue') throw new Error('Packet contains an unexpected playback source');
    const source = packetJson(packet.playback_source, attemptByteLimit) as SessionPlaybackSource;
    const preview = createRecordedSession(source, async () => { throw new Error('Inspection does not score repairs'); }, () => { throw new Error('Inspection does not create a corpus'); }, { now: () => 0 });
    try {
      const expected = preview.exportAttempt();
      if (canonicalJson(expected.playback_source) !== canonicalJson(attempt.playback_source) || canonicalJson(expected.provenance) !== canonicalJson(attempt.provenance) || canonicalJson(expected.setup) !== canonicalJson(attempt.setup)) throw new Error('Packet playback source binding differs');
      preview.start();
      const prefix = compactAttemptExport(preview).commands;
      const beforeHandover = attempt.terminal_reason === 'setup' || attempt.terminal_reason === 'playback';
      const length = Math.min(attempt.commands.length, prefix.length);
      const commitment = (commands: typeof attempt.commands) => commands.map(({ seq, request, actor, tick, result_sha256 }) => ({ seq, request, actor, tick, result_sha256 }));
      if (attempt.terminal_reason === 'setup' && attempt.commands.length !== 0 || beforeHandover && attempt.commands.length > prefix.length || !beforeHandover && length !== prefix.length || canonicalJson(commitment(attempt.commands.slice(0, length))) !== canonicalJson(commitment(prefix.slice(0, length)))) throw new Error('Packet commands differ from the reconstructed playback prefix');
    } finally { preview.dispose(); }
    sourceStatus = 'consistent';
  }
  return { attempt: packet.attempt, summary: { entries: packet.inventory.length, playback_source: sourceStatus, declared_build: packet.declared.build } };
}
