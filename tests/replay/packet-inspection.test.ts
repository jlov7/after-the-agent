import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { compactAttemptExport, createEngine, createRecordedSession, createSession, dispatch, snapshot } from '../../packages/engine/src/index.js';
import { sha256Json } from '../../packages/contracts/src/index.js';
import { loadCuratedPlayback } from '../../apps/web/src/recordings/curated.js';
import { createEvidencePacket, packetInventory } from '../../packages/runner/src/evidence-packet.js';
import { inspectPacket } from '../../packages/runner/src/packet-inspection.js';
import { createReplayInspection } from '../../packages/runner/src/replay-inspection.js';
const unused = () => { throw new Error('Inspection must not score a repair'); };
function attempt() {
  const session = createSession({ scenario: 'duplicate-clock', now: () => 1000 }, unused, unused);
  try { session.start(); return JSON.stringify(compactAttemptExport(session)); } finally { session.dispose(); }
}
test('packet inspection returns exact embedded attempt bytes and command replay without a scoring claim', () => {
  const raw = attempt() + '\n', packet = createEvidencePacket(raw), inspected = inspectPacket(packet);
  expect(inspected.attempt).toBe(raw); expect(inspected.summary).toMatchObject({ entries: 1, playback_source: 'absent' });
  const replay = createReplayInspection(inspected.attempt, 'attempt'); expect(replay.summary.status).toBe('verified'); expect(replay.summary.category).toBe('attempt');
});
test('changed inventory rejects even when the embedded attempt still replays', () => {
  const value = JSON.parse(createEvidencePacket(attempt())); value.attempt += ' ';
  expect(() => inspectPacket(JSON.stringify(value))).toThrow('inventory');
});
test('packet size above the standalone replay limit remains inspectable within its own bound', () => {
  const value = JSON.parse(attempt()); value.rehearsal_evidence = { note: '"'.repeat(2500000) };
  const raw = JSON.stringify(value), packet = createEvidencePacket(raw); expect(Buffer.byteLength(packet)).toBeGreaterThan(8 * 1024 * 1024);
  expect(inspectPacket(packet).attempt).toBe(raw);
});
test('recorded source is reconstructed and bound; recomputing the inventory cannot hide a source substitution', async () => {
  const source = await loadCuratedPlayback('/', async url => readFileSync('apps/web/public' + url, 'utf8')); expect(source).not.toBeNull();
  const session = createRecordedSession(source!, unused, unused, { now: () => 1000 });
  let raw: string;
  try { session.start(); raw = createEvidencePacket(JSON.stringify(compactAttemptExport(session)), source); } finally { session.dispose(); }
  expect(inspectPacket(raw).summary.playback_source).toBe('consistent');
  const changed = JSON.parse(raw), data = JSON.parse(changed.playback_source); data.recording_sha256 = '0'.repeat(64);
  changed.playback_source = JSON.stringify(data); changed.inventory = packetInventory(changed.attempt, changed.playback_source);
  expect(() => inspectPacket(JSON.stringify(changed))).toThrow('binding');
  changed.playback_source = null; changed.inventory = packetInventory(changed.attempt, null);
  expect(inspectPacket(JSON.stringify(changed)).summary.playback_source).toBe('missing');
});
test('scripted command substitution cannot borrow genuine source metadata even when both streams replay', async () => {
  const source = await loadCuratedPlayback('/', async url => readFileSync('apps/web/public' + url, 'utf8'));
  const recorded = createRecordedSession(source!, unused, unused, { now: () => 1000 });
  try {
    recorded.start();
    const original = compactAttemptExport(recorded), engine = createEngine(original.setup);
    const commands = original.commands.map((command, index) => {
      const request = { ...command.request, request_id: `scripted.${index}` };
      const actor = { actor_id: 'authored-alternative', role: 'controller', phase: 'setup' } as const;
      const result = dispatch(engine, request, actor);
      expect(result.outcome).toBe('accepted');
      return { ...command, request, actor, tick: snapshot(engine).tick, result_sha256: sha256Json(result) };
    });
    const forged = { ...original, commands };
    const raw = JSON.stringify(forged); expect(createReplayInspection(raw, 'attempt').summary.status).toBe('verified');
    expect(() => inspectPacket(createEvidencePacket(raw, source))).toThrow('playback prefix');
  } finally { recorded.dispose(); }
});
test('source inspection allows a factual partial playback but refuses a handover with its fault command omitted', async () => {
  const source = await loadCuratedPlayback('/', async url => readFileSync('apps/web/public' + url, 'utf8'));
  const session = createRecordedSession(source!, unused, unused, { now: () => 1000 });
  try {
    session.start(); const original = compactAttemptExport(session);
    const partial = { ...original, terminal_reason: 'playback', handover_at_ms: null, deadline_at_ms: null, commands: original.commands.slice(0, 1) };
    expect(inspectPacket(createEvidencePacket(JSON.stringify(partial), source)).summary.playback_source).toBe('consistent');
    expect(() => inspectPacket(createEvidencePacket(JSON.stringify({ ...original, commands: original.commands.slice(0, -1) }), source))).toThrow('playback prefix');
    session.act({ type: 'set_epoch_guard', enabled: true });
    expect(inspectPacket(createEvidencePacket(JSON.stringify(compactAttemptExport(session)), source)).summary.playback_source).toBe('consistent');
  } finally { session.dispose(); }
});
