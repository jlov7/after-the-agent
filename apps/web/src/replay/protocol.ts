import { z } from 'zod';
import { validatePlantShape, type CanonicalPlant } from '../../../../packages/contracts/src/index.js';
import type { ReplayFrame, ReplayInspectionSummary } from '../../../../packages/runner/src/replay-inspection.js';
import type { PacketInspectionSummary } from '../../../../packages/runner/src/packet-inspection.js';
const integer = z.number().int().nonnegative();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const actor = z.object({ actor_id: z.string().min(1).max(64), role: z.enum(['human', 'assessed_agent', 'controller']), phase: z.enum(['setup', 'playback', 'recovery', 'submitted', 'timed_out', 'abandoned_reset']) }).strict();
const summarySchema = z.object({ kind: z.enum(['attempt', 'recording']), label: z.string().max(128), category: z.string().max(64), status: z.enum(['verified', 'mismatch', 'invalid']), commands: integer.max(10000), mismatches: z.array(z.string().max(512)).max(12), diagnostic: z.object({ command: integer.min(1).max(10000).nullable(), path: z.string().max(256), recorded: z.string().max(512), reconstructed: z.string().max(512) }).strict().nullable(), deadline_at_ms: integer.max(Number.MAX_SAFE_INTEGER).nullable(), provenance: z.string().max(512) }).strict();
const frameSchema = z.object({ position: integer.max(10000), plant: z.custom<CanonicalPlant>(value => { try { validatePlantShape(value); return true; } catch { return false; } }), events: z.array(z.object({ seq: integer.min(1), tick: integer.max(4096), type: z.enum(['world_changed', 'clock_fired', 'job_enqueued', 'pulse', 'job_discarded', 'settled_tick', 'config_changed', 'gate_refreshed', 'jobs_dropped']) }).passthrough()).max(256), event_count: integer.max(100000), pulses: z.object({ left: integer.max(16384), center: integer.max(16384), right: integer.max(16384) }).strict(), command: z.object({ seq: integer.min(1).max(10000), request: z.string().max(4096), raw: z.boolean(), actor, elapsed_ms: integer.max(Number.MAX_SAFE_INTEGER), outcome: z.enum(['accepted', 'rejected']), error: z.string().max(512).nullable() }).strict().nullable(), result_sha256: hash.nullable(), reconstructed_result_sha256: hash.nullable() }).strict();
export const replayWorkerRequest = z.discriminatedUnion('type', [
  z.object({ id: z.string().uuid(), type: z.literal('load'), kind: z.enum(['attempt', 'recording', 'packet']), raw: z.string().max(32 * 1024 * 1024), trustedLiveSha256: hash.optional() }).strict(),
  z.object({ id: z.string().uuid(), type: z.literal('seek'), position: integer.max(10000) }).strict(),
]);
const responseSchema = z.object({ id: z.string().uuid(), error: z.string().max(512).nullable(), summary: summarySchema.nullable(), frame: frameSchema.nullable(), packet: z.object({ entries: integer.min(1).max(2), playback_source: z.enum(['absent', 'consistent', 'missing']), declared_build: z.string().max(128).nullable() }).strict().optional(), inspectedRaw: z.string().max(8 * 1024 * 1024).optional() }).strict();
export interface ReplayWorkerResponse { id: string; error: string | null; summary: ReplayInspectionSummary | null; frame: ReplayFrame | null; packet?: PacketInspectionSummary; inspectedRaw?: string }
export function parseReplayWorkerResponse(value: unknown): ReplayWorkerResponse {
  const parsed = responseSchema.parse(value);
  if (parsed.error === null ? parsed.summary === null || parsed.frame === null || parsed.frame.position > parsed.summary.commands : parsed.summary !== null || parsed.frame !== null) throw new Error('Invalid replay worker response');
  if ((parsed.packet === undefined) !== (parsed.inspectedRaw === undefined) || parsed.packet !== undefined && (parsed.error !== null || parsed.summary?.kind !== 'attempt')) throw new Error('Invalid packet worker response');
  return parsed as ReplayWorkerResponse;
}
