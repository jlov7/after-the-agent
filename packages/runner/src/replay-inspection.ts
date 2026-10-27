import { z } from 'zod';
import { boardSchema, sha256Json, validateRequest, type ActorContext, type BoardRequest, type BoardResult, type CanonicalPlant, type DomainEvent, type Recording, type SetupSpec } from '../../contracts/src/index.js';
import { constructionSetup, createEngine, dispatch, engineEvents, scenarioSetup, setEnginePhase, snapshot } from '../../engine/src/index.js';
import { importRecording, type RecordingTrust } from './recording-schema.js';
import { parseStrictJson } from './strict-json.js';
import { replay } from './replay.js';

export const replayInputByteLimit = 8 * 1024 * 1024;
export const replayCommandLimit = 10000;
export interface ReplayDiagnostic { readonly command: number | null; readonly path: string; readonly recorded: string; readonly reconstructed: string }
export interface ReplayInspectionSummary {
  readonly kind: 'attempt' | 'recording'; readonly label: string; readonly category: string;
  readonly status: 'verified' | 'mismatch' | 'invalid'; readonly commands: number;
  readonly mismatches: readonly string[]; readonly diagnostic: ReplayDiagnostic | null;
  readonly deadline_at_ms: number | null; readonly provenance: string;
}
export interface ReplayFrame {
  readonly position: number; readonly plant: CanonicalPlant; readonly events: readonly DomainEvent[];
  readonly event_count: number; readonly pulses: Readonly<Record<'left' | 'center' | 'right', number>>;
  readonly command: { readonly seq: number; readonly request: string; readonly raw: boolean; readonly actor: ActorContext; readonly elapsed_ms: number; readonly outcome: 'accepted' | 'rejected'; readonly error: string | null } | null;
  readonly result_sha256: string | null; readonly reconstructed_result_sha256: string | null;
}
export interface ReplayInspection { readonly summary: ReplayInspectionSummary; frame(position: number): ReplayFrame }
interface ReplayCommand { seq: number; request: unknown; actor: ActorContext; tick: number; elapsed_ms: number; result_sha256: string; raw: boolean }
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const phase = z.enum(['setup', 'playback', 'recovery', 'submitted', 'timed_out', 'abandoned_reset']);
const actor = z.object({ actor_id: z.string().min(1).max(64), role: z.enum(['human', 'assessed_agent', 'controller']), phase }).strict();
const savedCommand = z.object({ seq: integer.min(1).max(replayCommandLimit), request: z.unknown(), actor, tick: integer.max(4096), elapsed_ms: integer, result_sha256: hash }).strict();
const times = { attempt_started_at_ms: integer, handover_at_ms: integer.nullable(), deadline_at_ms: integer.nullable() };
const shared = { schema_version: z.literal('1.2'), mode: z.enum(['public', 'local_rehearsal']), attempt_id: z.string().max(128), ...times, commands: z.array(savedCommand).max(replayCommandLimit), playback_source: z.unknown().nullable(), submissions: z.array(z.unknown()).max(128), previous_attempts: z.array(z.unknown()).max(10000), precommitments: z.array(z.unknown()).max(3), visibility: z.array(z.unknown()).max(10000) };
const compactSchema = z.object({ ...shared, researchEligible: z.literal(false), setup: z.unknown(), candidate: z.unknown().nullable(), corpus: z.unknown().nullable(), evaluation: z.unknown().nullable(), terminal_reason: phase, provenance: z.unknown(), rehearsal_evidence: z.unknown().optional() }).strict();
const savedSchema = z.object({ ...shared, scenario: z.enum(['valid-pending', 'stale-queue', 'duplicate-clock', 'cached-gate']), condition: z.enum(['observation', 'precommitment']), phase, playback_index: integer.max(10000), request_sequence: integer.max(10000), plant_sha256: hash }).strict();
const envelopeSchema = z.object({ format: z.literal('after-the-agent.resume'), version: z.literal('1.0'), session: savedSchema, rehearsal_evidence: z.unknown().nullable() }).strict();
const bounded = (value: unknown, limit = 512): string => {
  if (value === undefined) return '(missing)';
  const text = JSON.stringify(value); return text.length > limit ? `${text.slice(0, limit - 16)}… [truncated]` : text;
};
const pointer = (key: string) => key.replaceAll('~', '~0').replaceAll('/', '~1');
/** The first structural difference, with no unbounded recorded values in the response. */
export function firstReplayDifference(recorded: unknown, reconstructed: unknown, path: string, command: number | null): ReplayDiagnostic | null {
  if (Object.is(recorded, reconstructed)) return null;
  if (recorded !== null && reconstructed !== null && typeof recorded === 'object' && typeof reconstructed === 'object' && Array.isArray(recorded) === Array.isArray(reconstructed)) {
    const a = recorded as Record<string, unknown>, b = reconstructed as Record<string, unknown>;
    const keys = Array.isArray(recorded) ? Array.from({ length: Math.max(recorded.length, (reconstructed as unknown[]).length) }, (_, i) => String(i)) : [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    for (const key of keys) { const difference = firstReplayDifference(a[key], b[key], `${path}/${pointer(key)}`, command); if (difference) return difference; }
    return null;
  }
  return { command, path: path.slice(0, 256), recorded: bounded(recorded), reconstructed: bounded(reconstructed) };
}
function execute(engine: ReturnType<typeof createEngine>, command: ReplayCommand): BoardResult {
  // Same assessed-agent handover rule as the recording verifier. The host owns phase.
  setEnginePhase(engine, command.actor.role === 'assessed_agent' && snapshot(engine).tick >= 5 ? 'recovery' : command.actor.phase);
  return dispatch(engine, command.request as BoardRequest, command.actor);
}

function savedReplaySetup(saved: z.infer<typeof savedSchema>, commands: ReplayCommand[]): SetupSpec {
  const original = scenarioSetup(saved.scenario);
  if (saved.scenario !== 'stale-queue' || saved.playback_source === null) return original;
  // Version 1 progress files bind their source but do not embed its initial setup.
  // Only the two fixed profiles are supported. This reconstructs commitments,
  // not model provenance or permission to resume an untrusted source.
  const construction = constructionSetup(), engine = createEngine(construction);
  if (!commands.length) return sha256Json(snapshot(engine)) === saved.plant_sha256 ? construction : original;
  for (const command of commands) if (sha256Json(execute(engine, command)) !== command.result_sha256) return original;
  return construction;
}

function prepareReplayInspection(raw: string, kind: 'attempt' | 'recording', trust: RecordingTrust) {
  if (new TextEncoder().encode(raw).length > replayInputByteLimit) throw new Error('Replay input exceeds 8 MiB');
  let setup: SetupSpec, commands: ReplayCommand[], recording: Recording | undefined;
  let label: string, category: string, deadline: number | null = null, finalHash: string | null = null;
  let verdict: ReplayInspectionSummary['status'] = 'verified', mismatches: readonly string[] = [];
  if (kind === 'recording') {
    recording = importRecording(raw, trust); setup = recording.setup; label = recording.manifest.run_id; category = recording.manifest.category;
    const verified = replay(recording, trust); verdict = verified.status; mismatches = verified.mismatches;
    commands = recording.commands.map(command => ({ seq: command.seq, request: 'request_encoding' in command ? command.raw_request : command.request, raw: 'request_encoding' in command, actor: command.actor, tick: command.tick, elapsed_ms: command.elapsed_ms, result_sha256: sha256Json(command.result) }));
  } else {
    const parsed = parseStrictJson(raw);
    if (parsed && typeof parsed === 'object' && 'format' in parsed) {
      const saved = envelopeSchema.parse(parsed).session; commands = saved.commands.map(command => ({ ...command, raw: false }));
      for (const command of commands) validateRequest(command.request);
      setup = savedReplaySetup(saved, commands); label = saved.attempt_id; finalHash = saved.plant_sha256; deadline = saved.deadline_at_ms;
    } else {
      const compact = compactSchema.parse(parsed); setup = compact.setup as SetupSpec; commands = compact.commands.map(command => ({ ...command, raw: false })); label = compact.attempt_id; deadline = compact.deadline_at_ms;
    }
    const metadata = parsed && typeof parsed === 'object' && 'session' in parsed ? (parsed as { session: Record<string, unknown> }).session : parsed as Record<string, unknown>;
    const handover = metadata.handover_at_ms, started = metadata.attempt_started_at_ms;
    if (handover === null ? deadline !== null : typeof handover !== 'number' || typeof started !== 'number' || handover < started || deadline !== handover + 300000) throw new Error('Original attempt deadline is inconsistent');
    for (const command of commands) validateRequest(command.request);
    category = 'attempt';
  }
  let diagnostic: ReplayDiagnostic | null = null;
  const note = (recorded: unknown, reconstructed: unknown, path: string, command: number | null) => { diagnostic ??= firstReplayDifference(recorded, reconstructed, path, command); };
  const validationEngine = createEngine(setup);
  if (recording) note(recording.initial_plant, snapshot(validationEngine), '/initial_plant', null);
  let previousElapsed = 0;
  for (const [index, command] of commands.entries()) {
    note(command.seq, index + 1, `/commands/${index}/seq`, index + 1);
    if (command.elapsed_ms < previousElapsed) note(command.elapsed_ms, previousElapsed, `/commands/${index}/elapsed_ms`, index + 1);
    previousElapsed = command.elapsed_ms;
    const actual = execute(validationEngine, command);
    note(command.tick, snapshot(validationEngine).tick, `/commands/${index}/tick`, index + 1);
    if (recording) note(recording.commands[index]!.result, actual, `/commands/${index}/result`, index + 1);
    else note(command.result_sha256, sha256Json(actual), `/commands/${index}/result_sha256`, index + 1);
  }
  if (recording) {
    const plant = snapshot(validationEngine), events = engineEvents(validationEngine), manifest = recording.manifest;
    note(recording.final_plant, plant, '/final_plant', null); note(recording.events, events, '/events', null);
    note(manifest.initial_plant_sha256, sha256Json(recording.initial_plant), '/manifest/initial_plant_sha256', null);
    note(manifest.final_plant_sha256, sha256Json(plant), '/manifest/final_plant_sha256', null);
    note(manifest.pulses_sha256, sha256Json(events.filter(event => event.type === 'pulse')), '/manifest/pulses_sha256', null);
    note(manifest.tool_schema_sha256, sha256Json(boardSchema), '/manifest/tool_schema_sha256', null);
    note(manifest.world_sha256, sha256Json(setup.world), '/manifest/world_sha256', null);
    note(manifest.tool_calls, commands.length, '/manifest/tool_calls', null);
  }
  else if (finalHash) note(finalHash, sha256Json(snapshot(validationEngine)), '/plant_sha256', null);
  if (kind === 'attempt' && diagnostic) { verdict = 'mismatch'; mismatches = ['Attempt command or plant commitment differs']; }
  const summary: ReplayInspectionSummary = { kind, label, category, status: verdict, commands: commands.length, diagnostic, deadline_at_ms: deadline, mismatches: mismatches.slice(0, 12).map(value => value.slice(0, 512)), provenance: kind === 'recording' ? category === 'live_model' ? 'Owner-trusted recording commitment. Recorded actions replay locally.' : `${category} recording. No model provenance.` : 'Imported attempt metadata is unverified. Command commitments are checked; scoring and model provenance are not established.' };
  return { setup, commands, summary };
}
export function createReplayInspection(raw: string, kind: 'attempt' | 'recording', trust: RecordingTrust = {}): ReplayInspection {
  // The preparation scope releases full recording results and its validation engine.
  // Backward seeks rebuild instead of retaining 10,000 additional plant frames.
  const { setup, commands, summary } = prepareReplayInspection(raw, kind, trust);
  let engine = createEngine(setup), position = 0, latest: BoardResult | null = null;
  return { summary, frame(target) {
    if (!Number.isInteger(target) || target < 0 || target > commands.length) throw new Error('Replay command position is out of range');
    if (target < position) { engine = createEngine(setup); position = 0; latest = null; }
    while (position < target) { latest = execute(engine, commands[position]!); position++; }
    const command = position ? commands[position - 1]! : null, events = engineEvents(engine);
    const pulses = { left: 0, center: 0, right: 0 }; for (const event of events) if (event.type === 'pulse') pulses[event.lamp]++;
    return { position, plant: snapshot(engine), events: events.slice(-256), event_count: events.length, pulses, command: command && latest ? { seq: command.seq, request: bounded(command.request, 4096), raw: command.raw, actor: command.actor, elapsed_ms: command.elapsed_ms, outcome: latest.outcome, error: latest.error?.message ?? null } : null, result_sha256: command?.result_sha256 ?? null, reconstructed_result_sha256: latest ? sha256Json(latest) : null };
  } };
}
