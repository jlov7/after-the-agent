import { z } from 'zod';
import { canonicalJson, sha256Json, sha256Text, type FrozenCandidate, type ContinuationCorpus } from '../../contracts/src/index.js';
import { immutable } from '../../engine/src/engine.js';
import { validateCorpus } from './continuations.js';
import { createReplayInspection, type ReplayFrame } from './replay-inspection.js';
import type { RecordingTrust } from './recording-schema.js';
import { parseStrictJson } from './strict-json.js';
export const replayNotesByteLimit = 1024 * 1024;
const position = z.number().int().min(0).max(10000), identifier = z.string().min(1).max(128);
export const replayAnchorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('command'), position }).strict(),
  z.object({ kind: z.literal('job'), position, identifier }).strict(),
  z.object({ kind: z.literal('case'), position, identifier }).strict(),
]);
export const replayNotesSchema = z.object({ format: z.literal('after-the-agent.replay-notes'), version: z.literal('1.0'), source_sha256: z.string().regex(/^[a-f0-9]{64}$/), notes: z.array(z.object({ anchor: replayAnchorSchema, text: z.string().min(1).max(2000) }).strict()).max(256) }).strict();
export type ReplayAnchor = z.infer<typeof replayAnchorSchema>;
export type ReplayNotes = z.infer<typeof replayNotesSchema>;
export function createReplayNotes(sourceRaw: string, notes: unknown): ReplayNotes {
  const parsed = replayNotesSchema.parse({ format: 'after-the-agent.replay-notes', version: '1.0', source_sha256: sha256Text(sourceRaw), notes });
  if (new TextEncoder().encode(JSON.stringify(parsed)).length > replayNotesByteLimit) throw new Error('Replay notes exceed 1 MiB');
  return immutable(parsed);
}
/** Only identifiers present at this reconstructed command can be pinned. */
export function annotationAnchors(sourceRaw: string, frame: ReplayFrame): readonly ReplayAnchor[] {
  const anchors: ReplayAnchor[] = [{ kind: 'command', position: frame.position }], jobs = new Set(frame.plant.queue.map(job => job.id));
  for (const event of frame.events) {
    if (event.type === 'job_enqueued') jobs.add(event.job.id);
    if (event.type === 'pulse' || event.type === 'job_discarded') jobs.add(event.job_id);
    if (event.type === 'jobs_dropped') event.job_ids.forEach(id => jobs.add(id));
  }
  for (const id of [...jobs].sort()) anchors.push({ kind: 'job', position: frame.position, identifier: id });
  const parsed: unknown = JSON.parse(sourceRaw);
  const metadata = parsed && typeof parsed === 'object' && 'session' in parsed ? parsed.session : parsed;
  const records = metadata && typeof metadata === 'object' && 'submissions' in metadata && Array.isArray(metadata.submissions) ? metadata.submissions : [];
  const cases = new Set<string>(), plantHash = sha256Json(frame.plant);
  for (const record of records) {
    if (!record || typeof record !== 'object' || !('candidate' in record) || !('corpus' in record)) continue;
    const candidate = record.candidate as FrozenCandidate, corpus = record.corpus as ContinuationCorpus;
    try {
      validateCorpus(candidate, corpus);
      if (candidate.candidate_sha256 === plantHash) for (const c of corpus.cases) cases.add(c.case_id);
    } catch { /* Unverified retained scoring metadata cannot supply an anchor. */ }
  }
  for (const id of [...cases].sort()) anchors.push({ kind: 'case', position: frame.position, identifier: id });
  return immutable(anchors);
}
export function parseReplayNotes(raw: string, sourceRaw: string): ReplayNotes {
  if (new TextEncoder().encode(raw).length > replayNotesByteLimit) throw new Error('Replay notes exceed 1 MiB');
  const notes = replayNotesSchema.parse(parseStrictJson(raw));
  if (notes.source_sha256 !== sha256Text(sourceRaw)) throw new Error('Replay notes source hash does not match the original input bytes');
  return notes;
}
export function importReplayNotes(raw: string, sourceRaw: string, kind: 'attempt' | 'recording', trust: RecordingTrust = {}): ReplayNotes {
  const notes = parseReplayNotes(raw, sourceRaw), inspection = createReplayInspection(sourceRaw, kind, trust);
  for (const note of [...notes.notes].sort((a, b) => a.anchor.position - b.anchor.position)) {
    const frame = inspection.frame(note.anchor.position), allowed = annotationAnchors(sourceRaw, frame);
    if (!allowed.some(anchor => canonicalJson(anchor) === canonicalJson(note.anchor))) throw new Error('Replay note anchor is not valid at its pinned position');
  }
  return immutable(notes);
}
