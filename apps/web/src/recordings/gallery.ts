import { z } from 'zod';
import { sha256Text, type Recording } from '../../../../packages/contracts/src/index.js';
import type { SessionPlaybackSource } from '../../../../packages/engine/src/index.js';
import { importRecording, recordingCommitment } from '../../../../packages/runner/src/recording-schema.js';
import { replay } from '../../../../packages/runner/src/replay.js';
import { parseRecordingJson, parseStrictJson } from '../../../../packages/runner/src/strict-json.js';
import { assetSchema, loadOwnerPlayback, readLocalAsset, type AssetReader } from './curated.js';
const entrySchema = z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/), title: z.string().min(1).max(120), description: z.string().max(600), category: z.enum(['live_model', 'fixture', 'scripted']), recording: assetSchema, qualification: assetSchema.nullable() }).strict();
const gallerySchema = z.object({ schema_version: z.literal('1.0'), entries: z.array(entrySchema).max(20) }).strict().refine(value => new Set(value.entries.map(entry => entry.id)).size === value.entries.length, 'Duplicate gallery entry');
export type GalleryEntry = { id: string; title: string; description: string; category: 'live_model' | 'fixture' | 'scripted'; recordingSha256: string; rawRecording: string | null; playback: SessionPlaybackSource | null; status: 'qualified' | 'inspection_only' | 'unavailable'; detail: string };
// This fixed local owner manifest is the only source of gallery authority.
export async function loadRecordingGallery(base = import.meta.env.BASE_URL, reader: AssetReader = readLocalAsset): Promise<GalleryEntry[]> {
  const read: AssetReader = async (url, limit) => { const raw = await reader(url, limit); if (new TextEncoder().encode(raw).length > limit) throw new Error('Gallery asset exceeds its size limit.'); return raw; };
  const manifest = gallerySchema.parse(parseStrictJson(await read(`${base}recordings/gallery.json`, 32768)));
  const entries: GalleryEntry[] = [];
  for (const entry of manifest.entries) {
    const value: GalleryEntry = { id: entry.id, title: entry.title, description: entry.description, category: entry.category, recordingSha256: entry.recording.sha256, rawRecording: null, playback: null, status: 'unavailable', detail: 'Recording unavailable.' };
    try {
      const raw = await read(`${base}${entry.recording.path}`, 8 * 1024 * 1024);
      if (sha256Text(raw) !== entry.recording.sha256) throw new Error('Recording asset commitment differs.');
      const trust = entry.category === 'live_model' ? { trusted_live_sha256: recordingCommitment(parseRecordingJson(raw) as Recording) } : {};
      const recording = importRecording(raw, trust);
      if (recording.manifest.category !== entry.category || recording.manifest.replay_status !== 'verified' || recording.manifest.verification_commit === null || replay(recording, trust).status !== 'verified') throw new Error('Recording lacks verified source evidence.');
      value.rawRecording = raw; value.status = 'inspection_only'; value.detail = 'Replay verified. This entry is available for inspection only.';
      if (entry.qualification) {
        const cache: AssetReader = (url, limit) => url === `${base}${entry.recording.path}` ? Promise.resolve(raw) : read(url, limit);
        value.playback = await loadOwnerPlayback({ ...entry, qualification: entry.qualification }, base, cache);
        value.status = 'qualified'; value.detail = 'Replay and all 12 continuations verified for the supported tick-five setup.';
      }
    } catch (error) { value.detail = error instanceof Error ? error.message.slice(0, 500) : 'Recording unavailable.'; }
    entries.push(value);
  }
  return entries;
}
