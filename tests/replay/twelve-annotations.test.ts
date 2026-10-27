import { expect, it } from 'vitest';
import { authoredRecording } from './fixture.js';
import { createReplayInspection } from '../../packages/runner/src/replay-inspection.js';
import { annotationAnchors, createReplayNotes, importReplayNotes } from '../../packages/runner/src/replay-annotations.js';
import { buildCorpus } from '../../packages/runner/src/continuations.js';
import { evaluateCandidate } from '../../packages/runner/src/evaluate-browser.js';
import { createSession, compactAttemptExport } from '../../packages/engine/src/index.js';
it('keeps inert notes separate and pins valid initial, end and job positions to original bytes', () => {
  const raw = JSON.stringify(authoredRecording()), inspection = createReplayInspection(raw, 'recording');
  const initial = inspection.frame(0), final = inspection.frame(inspection.summary.commands);
  const anchors = annotationAnchors(raw, final), job = anchors.find(a => a.kind === 'job')!;
  const notes = createReplayNotes(raw, [{ anchor: { kind: 'command', position: 0 }, text: '<img src=x onerror=alert(1)>' }, { anchor: job, text: 'Pending at this exact command' }]);
  expect(importReplayNotes(JSON.stringify(notes), raw, 'recording')).toEqual(notes);
  expect(annotationAnchors(raw, initial)).toEqual([{ kind: 'command', position: 0 }]);
  expect(createReplayInspection(raw, 'recording').summary.category).toBe('fixture');
  expect(() => importReplayNotes(JSON.stringify(notes), raw + '\n', 'recording')).toThrow(/source/);
});
it('rejects unknown positions/jobs/cases, extra fields, duplicate JSON, oversized notes/count/file and invalid hashes', () => {
  const raw = JSON.stringify(authoredRecording());
  const valid = createReplayNotes(raw, [{ anchor: { kind: 'command', position: 0 }, text: 'note' }]);
  for (const anchor of [{ kind: 'command', position: 999 }, { kind: 'job', position: 0, identifier: 'primary.4.left' }, { kind: 'case', position: 3, identifier: 'invented' }]) {
    expect(() => importReplayNotes(JSON.stringify({ ...valid, notes: [{ anchor, text: 'note' }] }), raw, 'recording')).toThrow();
  }
  for (const value of [{ ...valid, extra: true }, { ...valid, source_sha256: 'x' }, { ...valid, notes: [{ anchor: { kind: 'command', position: 0 }, text: 'x'.repeat(2001) }] }, { ...valid, notes: Array.from({ length: 257 }, () => valid.notes[0]) }]) expect(() => importReplayNotes(JSON.stringify(value), raw, 'recording')).toThrow();
  expect(() => importReplayNotes('{"format":"x","format":"y"}', raw, 'recording')).toThrow();
  expect(() => importReplayNotes(' '.repeat(1024 * 1024 + 1), raw, 'recording')).toThrow(/1 MiB/);
});
it('case pins require an exact candidate state and canonical retained corpus', async () => {
  const session = createSession({ scenario: 'valid-pending', now: () => 1000 }, evaluateCandidate, buildCorpus); session.start(); await session.submit();
  try {
    const raw = JSON.stringify(compactAttemptExport(session)), replay = createReplayInspection(raw, 'attempt'), frame = replay.frame(replay.summary.commands);
    const anchor = annotationAnchors(raw, frame).find(a => a.kind === 'case')!; expect(anchor).toBeDefined();
    const notes = createReplayNotes(raw, [{ anchor, text: 'Frozen continuation case' }]);
    expect(importReplayNotes(JSON.stringify(notes), raw, 'attempt')).toEqual(notes);
    expect(() => importReplayNotes(JSON.stringify({ ...notes, notes: [{ anchor: { ...anchor, position: 0 }, text: 'bad' }] }), raw, 'attempt')).toThrow();
  } finally { session.dispose(); }
});
it('applies the complete UTF-8 byte budget when creating notes, including multibyte text', () => {
  const raw = JSON.stringify(authoredRecording());
  expect(() => createReplayNotes(raw, Array.from({ length: 200 }, () => ({ anchor: { kind: 'command', position: 0 }, text: '界'.repeat(2000) })))).toThrow(/1 MiB/);
});
