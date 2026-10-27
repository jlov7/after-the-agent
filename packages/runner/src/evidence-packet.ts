import { z } from 'zod';
import release from '../../../package.json' with { type: 'json' };
import { boardSchema, evaluationSchema, compileSchema, sha256Json, sha256Text } from '../../contracts/src/index.js';
import type { CompactAttemptExport, SessionPlaybackSource } from '../../engine/src/session.js';
import { packetJson } from './evidence-packet-json.js';

export const packetByteLimit = 32 * 1024 * 1024;
export const attemptByteLimit = 8 * 1024 * 1024;
export const packetIdentifiers = { engine: 'after-the-agent.engine.v1', attempt_schema: '1.2', tool_schema_sha256: sha256Json(boardSchema), reference_manifest_sha256: '2a1e32b4cf42b1c94c802f9a1822d4878959f652a5afedb4b3cd52123184597f', build: release.version } as const;
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const phase = z.enum(['setup', 'playback', 'recovery', 'submitted', 'timed_out', 'abandoned_reset']);
const provenance = z.object({ category: z.enum(['live_model', 'scripted', 'fixture']), label: z.string().max(256), model: z.string().max(256).nullable(), date: z.string().max(64).nullable(), replay_verified: z.boolean() }).strict();
const command = z.object({ seq: integer.min(1).max(10000), request: z.unknown(), actor: z.object({ actor_id: z.string().min(1).max(64), role: z.enum(['human', 'assessed_agent', 'controller']), phase }).strict(), tick: integer.max(4096), elapsed_ms: integer, result_sha256: hash }).strict();
const pulse = z.object({ tick: integer.max(4096), lamp: z.enum(['left', 'center', 'right']) }).strict();
const observation = compileSchema({ $schema: evaluationSchema.$schema, $defs: evaluationSchema.$defs, $ref: '#/$defs/Observation' });
const evaluation = z.object({ status: z.enum(['pass', 'mismatch', 'invalid', 'budget_limit', 'cancelled', 'worker_error']), candidate_sha256: hash, cases: z.array(z.object({ case_id: z.string().max(64), status: z.enum(['pass', 'mismatch', 'invalid']), missing: z.array(pulse).max(16384), extra: z.array(pulse).max(16384), reason: z.string().max(2000).optional() }).strict()).max(12), observations: z.array(z.unknown().refine(value => observation(value).valid)).max(12), reason: z.string().max(2000).optional() }).strict();
const submission = z.object({ candidate: z.unknown(), corpus: z.unknown(), admitted_at_ms: integer, evaluation: evaluation.nullable() }).strict();
const attemptSchema = z.object({ schema_version: z.literal('1.2'), mode: z.enum(['public', 'local_rehearsal']), researchEligible: z.literal(false), setup: z.unknown(), commands: z.array(command).max(10000), candidate: z.unknown().nullable(), corpus: z.unknown().nullable(), evaluation: evaluation.nullable(), attempt_id: z.string().regex(/^attempt\.\d+\.\d+$/).max(64), terminal_reason: phase, playback_source: z.object({ recording_sha256: hash, source_sha256: hash }).strict().nullable(), provenance, previous_attempts: z.array(z.object({ attempt_id: z.string().max(64), disposition: phase }).strict()).max(10000), submissions: z.array(submission).max(128), precommitments: z.array(z.object({ window: integer.min(1).max(3), response: z.string().max(2000).nullable(), at_ms: integer }).strict()).max(3), visibility: z.array(z.object({ hidden: z.boolean(), at_ms: integer }).strict()).max(10000), attempt_started_at_ms: integer, handover_at_ms: integer.nullable(), deadline_at_ms: integer.nullable(), rehearsal_evidence: z.unknown().optional() }).strict();
const identifiers = z.object({ engine: z.string().max(128).nullable(), attempt_schema: z.string().max(128).nullable(), tool_schema_sha256: hash.nullable(), reference_manifest_sha256: hash.nullable(), build: z.string().max(128).nullable() }).strict();
const inventoryEntry = z.object({ name: z.enum(['attempt.json', 'playback-source.json']), bytes: integer.max(packetByteLimit), sha256: hash }).strict();
const schema = z.object({ format: z.literal('after-the-agent-evidence-packet'), version: z.literal('1.0'), declared: identifiers, attempt: z.string(), playback_source: z.string().nullable(), inventory: z.array(inventoryEntry).min(1).max(2) }).strict();
export type EvidencePacket = z.infer<typeof schema>;
export function parseCompactAttempt(raw: string): CompactAttemptExport {
  return attemptSchema.parse(packetJson(raw, attemptByteLimit)) as unknown as CompactAttemptExport;
}
export function parseEvidencePacket(raw: string): EvidencePacket {
  const packet = schema.parse(packetJson(raw, packetByteLimit));
  parseCompactAttempt(packet.attempt);
  if (packet.playback_source !== null) packetJson(packet.playback_source, attemptByteLimit);
  return packet;
}
export function packetInventory(attempt: string, source: string | null): EvidencePacket['inventory'] {
  const entry = (name: 'attempt.json' | 'playback-source.json', raw: string) => ({ name, bytes: new TextEncoder().encode(raw).length, sha256: sha256Text(raw) });
  return [entry('attempt.json', attempt), ...(source === null ? [] : [entry('playback-source.json', source)])];
}
/** Preserve the exact compact attempt bytes. Identifiers and hashes declare consistency, not provenance. */
export function createEvidencePacket(attempt: string, playbackSource: SessionPlaybackSource | null = null): string {
  parseCompactAttempt(attempt);
  const source = playbackSource === null ? null : JSON.stringify(playbackSource);
  if (source !== null) packetJson(source, attemptByteLimit);
  const result = JSON.stringify({ format: 'after-the-agent-evidence-packet', version: '1.0', declared: packetIdentifiers, attempt, playback_source: source, inventory: packetInventory(attempt, source) });
  if (new TextEncoder().encode(result).length > packetByteLimit) throw new TypeError('Packet exceeds 32 MiB');
  return result;
}
