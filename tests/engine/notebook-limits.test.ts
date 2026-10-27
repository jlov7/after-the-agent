import { expect, it } from 'vitest';
import { bookmarkByteLimit, notebookByteLimit, notebookEntryLimit, prepareBookmark } from '../../apps/web/src/notebook/store.js';
const raw = JSON.stringify({ format: 'after-the-agent.resume', version: '1.0', session: {}, rehearsal_evidence: null });
it('immutable bookmark commits exact resumable bytes without changing the original deadline', () => {
  const saved = prepareBookmark('  Earlier attempt  ', raw);
  expect(saved.name).toBe('Earlier attempt'); expect(saved.raw).toBe(raw); expect(saved.bytes).toBe(new TextEncoder().encode(raw).length);
  expect(saved.sha256).toMatch(/^[a-f0-9]{64}$/); expect(Object.isFrozen(saved)).toBe(true);
});
it('bookmark limits reject blank/long names, evidence downloads and excessive UTF-8 bytes', () => {
  expect(notebookEntryLimit).toBe(20); expect(notebookByteLimit).toBe(32 * 1024 * 1024); expect(bookmarkByteLimit).toBe(8 * 1024 * 1024);
  for (const name of ['', ' '.repeat(2), 'a'.repeat(81)]) expect(() => prepareBookmark(name, raw)).toThrow('name');
  expect(() => prepareBookmark('wrong file', '{}')).toThrow('Save progress to a file');
  expect(() => prepareBookmark('large', 'é'.repeat(bookmarkByteLimit / 2 + 1))).toThrow('8 MiB');
});
