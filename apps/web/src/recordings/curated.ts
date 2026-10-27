import { z } from 'zod';
import { canonicalJson, sha256Json, sha256Text, type CommandRecord, type FrozenCandidate, type Recording } from '../../../../packages/contracts/src/index.js';
import { immutable, isSupportedRecordingSetup, type SessionPlaybackSource } from '../../../../packages/engine/src/index.js';
import { buildCorpus } from '../../../../packages/runner/src/continuations.js';
import { evaluateCandidate } from '../../../../packages/runner/src/evaluate-browser.js';
import { importRecording, recordingCommitment } from '../../../../packages/runner/src/recording-schema.js';
import { replay } from '../../../../packages/runner/src/replay.js';
import { parseRecordingJson, parseStrictJson } from '../../../../packages/runner/src/strict-json.js';

const anchor = '2a1e32b4cf42b1c94c802f9a1822d4878959f652a5afedb4b3cd52123184597f';
export const assetSchema = z.object({
  path: z.string().regex(/^recordings\/(fixtures|curated)\/[a-z0-9][a-z0-9-]*\.json$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
const manifestSchema = z.object({
  schema_version: z.literal('1.0'),
  selected: z.object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
    category: z.enum(['live_model', 'fixture', 'scripted']),
    recording: assetSchema,
    qualification: assetSchema,
  }).strict().nullable(),
}).strict();
const qualificationSchema = z.object({
  schema_version: z.literal('1.0'), status: z.literal('passed'), reason: z.string().max(512),
  reference_manifest_sha256: z.literal(anchor), reference_directory: z.string().max(1024),
  elapsed_ms: z.number().int().nonnegative(), candidate: z.unknown(), corpus: z.unknown(), result: z.unknown(),
}).strict();
export type AssetReader = (url: string, maximumBytes: number) => Promise<string>;

export const readLocalAsset: AssetReader = async (url, maximumBytes) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok || !response.body) throw new Error('Curated recording asset is unavailable');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let bytes = 0, raw = '';
  try {
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maximumBytes) throw new Error('Curated recording asset exceeds its size limit');
      raw += decoder.decode(chunk.value, { stream: true });
    }
    return raw + decoder.decode();
  } finally { await reader.cancel(); }
};

// Only the owner-curated local manifest selects a public source. Uploads and URL parameters do not reach this path.
export async function loadCuratedPlayback(base = import.meta.env.BASE_URL, readAsset: AssetReader = readLocalAsset): Promise<SessionPlaybackSource | null> {
  const manifest = manifestSchema.parse(parseStrictJson(await readAsset(`${base}recordings/manifest.json`, 16384)));
  const selected = manifest.selected; if (selected === null) return null;
  return loadOwnerPlayback(selected, base, readAsset);
}

export type OwnerSelection = NonNullable<z.infer<typeof manifestSchema>['selected']>;
export async function loadOwnerPlayback(selected: OwnerSelection, base: string, readAsset: AssetReader): Promise<SessionPlaybackSource> {
  const [rawRecording, rawQualification] = await Promise.all([
    readAsset(`${base}${selected.recording.path}`, 8 * 1024 * 1024),
    readAsset(`${base}${selected.qualification.path}`, 8 * 1024 * 1024),
  ]);
  if (sha256Text(rawRecording) !== selected.recording.sha256 || sha256Text(rawQualification) !== selected.qualification.sha256) throw new Error('Curated recording commitment differs');
  const trust = selected.category === 'live_model' ? { trusted_live_sha256: recordingCommitment(parseRecordingJson(rawRecording) as Recording) } : {};
  const recording = importRecording(rawRecording, trust);
  if (recording.manifest.category !== selected.category || recording.manifest.replay_status !== 'verified' || recording.manifest.verification_commit === null) throw new Error('Curated recording lacks verified source evidence');
  const replayed = replay(recording, trust);
  if (replayed.status !== 'verified' || replayed.plant?.tick !== 5 || !isSupportedRecordingSetup(recording.setup)) throw new Error('Curated recording does not reconstruct the supported tick-five setup');
  if (recording.commands.some(command => 'request_encoding' in command)) throw new Error('Curated public playback requires canonical command records');
  const plant = replayed.plant;
  const enabledClock = plant.config.clocks.primary ? 'primary' : 'shadow';
  if (Number(plant.config.clocks.primary) + Number(plant.config.clocks.shadow) !== 1 || plant.config.gate_mode !== 'live' || !plant.config.epoch_guard || plant.queue.length !== 1 || canonicalJson(plant.queue[0]) !== canonicalJson({ id: `${enabledClock}.4.left`, clock: enabledClock, enqueue_tick: 4, due_tick: 6, lamp: 'left', enqueue_epoch: 1 })) throw new Error('Curated setup must preserve its actual inherited stale job');
  const candidate: FrozenCandidate = {
    schema_version: '1.0', plant, world_prefix: { initial_world: recording.setup.world.initial_world, transitions: recording.setup.world.transitions.filter(change => change.tick <= 5) },
    task: recording.setup.task, candidate_sha256: sha256Json(plant), attempt_id: recording.manifest.run_id,
    capture_tick: 5, original_handover_tick: 5, terminal_reason: 'submitted', reset_during_attempt: false,
  };
  const corpus = buildCorpus(candidate);
  const qualification = qualificationSchema.parse(parseStrictJson(rawQualification));
  if (canonicalJson(qualification.candidate) !== canonicalJson(candidate) || canonicalJson(qualification.corpus) !== canonicalJson(corpus)) throw new Error('Curated qualification belongs to another candidate');
  const evaluated = await evaluateCandidate(candidate, corpus);
  if (evaluated.status !== 'pass' || evaluated.cases.length !== 12 || evaluated.cases.some(item => item.status !== 'pass') || canonicalJson(qualification.result) !== canonicalJson(evaluated)) throw new Error('Curated target behavior did not verify');
  const genuine = selected.category === 'live_model';
  return immutable({
    recording_sha256: selected.recording.sha256, setup: recording.setup, commands: recording.commands as readonly CommandRecord[],
    provenance: { category: selected.category, label: genuine ? 'Recorded agent run' : 'Scripted preview', model: genuine ? recording.manifest.returned_model ?? `Unknown (requested: ${recording.manifest.requested_model})` : null, date: genuine ? recording.manifest.started_at.slice(0, 10) : null, replay_verified: true },
  });
}
