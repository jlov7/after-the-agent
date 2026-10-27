import { expect, test } from 'vitest';
import { createNotebookBackup, parseNotebookBackup, planNotebookImport, prepareBookmark, notebookBackupByteLimit, notebookByteLimit } from '../../apps/web/src/notebook/store.js';
import { createNotebookClient } from '../../apps/web/src/notebook/client.js';
import type { ReplayWorkerPort } from '../../apps/web/src/replay/client.js';
const raw = JSON.stringify({ format: 'after-the-agent.resume', version: '1.0', session: {}, rehearsal_evidence: null });
test('portable notebook retains exact raw bytes and bookmark identity while repeat imports add nothing', () => {
  const first = prepareBookmark('Earlier', raw + '\n'), second = prepareBookmark('Later', raw);
  const restored = parseNotebookBackup(createNotebookBackup([first, second]));
  expect(restored.find(item => item.id === first.id)).toEqual(first);
  expect(planNotebookImport([first], restored).preview).toMatchObject({ added: 1, duplicates: 1, total: 2 });
  expect(planNotebookImport(restored, restored).additions).toEqual([]);
});
test.each(['hash', 'bytes', 'name', 'date', 'duplicate', 'json', 'envelope'])('one %s corruption rejects the whole notebook backup', kind => {
  const first = prepareBookmark('Valid', raw), second = { ...prepareBookmark('Also valid', raw) };
  const data = { format: 'after-the-agent-notebook', version: '1.0', entries: [first, second] };
  if (kind === 'hash') second.sha256 = '0'.repeat(64);
  if (kind === 'bytes') second.bytes++;
  if (kind === 'name') second.name = '  ';
  if (kind === 'date') second.createdAt = 8640000000000001;
  if (kind === 'duplicate') second.id = first.id;
  if (kind === 'envelope') second.raw = '{}';
  let value = JSON.stringify(data); if (kind === 'json') value = value.replace('"version":"1.0"', '"version":"1.0","version":"1.0"');
  expect(() => parseNotebookBackup(value)).toThrow(); expect(first.raw).toBe(raw);
});
test('same ID with a renamed or replaced record conflicts instead of overwriting existing evidence', () => {
  const first = prepareBookmark('Original', raw);
  expect(() => planNotebookImport([first], [{ ...first, name: 'Renamed' }])).toThrow('conflicts');
  expect(first.name).toBe('Original');
});
test('merge rechecks the count against current storage rather than trusting the earlier preview', () => {
  const incoming = prepareBookmark('Incoming', raw), records = Array.from({ length: 20 }, () => prepareBookmark('Existing', raw));
  expect(planNotebookImport([], [incoming]).preview.added).toBe(1);
  expect(() => planNotebookImport(records, [incoming])).toThrow('20 bookmarks');
});
test('escaped JSON backup bytes can exceed the raw total while still round-tripping', () => {
  const text = JSON.stringify({ format: 'after-the-agent.resume', version: '1.0', session: { note: '"'.repeat(100000) }, rehearsal_evidence: null });
  const item = prepareBookmark('Escaped bytes', text), backup = createNotebookBackup([item]);
  expect(Buffer.byteLength(backup)).toBeGreaterThan(item.bytes * 1.8); expect(parseNotebookBackup(backup)[0]).toEqual(item);
  expect(notebookBackupByteLimit).toBe(notebookByteLimit * 2 + 64 * 1024);
});
test('notebook worker cancellation terminates pending work and late messages cannot write a preview', async () => {
  const port: ReplayWorkerPort = { onmessage: null, onerror: null, onmessageerror: null, postMessage() {}, terminate() {} };
  let terminated = 0; port.terminate = () => { terminated++; };
  const client = createNotebookClient(() => port), pending = client.preview(createNotebookBackup([]));
  client.cancel(); await expect(pending).rejects.toThrow('cancelled'); expect(terminated).toBe(1);
  await expect(client.commit()).rejects.toThrow();
});
test('unresponsive notebook worker ends at its timeout rather than leaving storage controls pending', async () => {
  const port: ReplayWorkerPort = { onmessage: null, onerror: null, onmessageerror: null, postMessage() {}, terminate() {} };
  const client = createNotebookClient(() => port, 5); await expect(client.backup()).rejects.toThrow('timed out');
});
