import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { loadRecordingGallery } from '../../apps/web/src/recordings/gallery.js';
import { sha256Text } from '../../packages/contracts/src/index.js';
const directory = 'apps/web/public/';
function assets() {
  const manifest = JSON.parse(readFileSync(directory + 'recordings/gallery.json', 'utf8'));
  const values = new Map<string, string>([['recordings/gallery.json', JSON.stringify(manifest)]]);
  for (const item of manifest.entries) for (const asset of [item.recording, item.qualification]) if (asset) values.set(asset.path, readFileSync(directory + asset.path, 'utf8'));
  const requested: string[] = [];
  const reader = async (url: string, maximumBytes: number) => { requested.push(url); const raw = values.get(url.replace('/nested/', '')); if (raw === undefined) throw new Error('Missing asset'); expect(new TextEncoder().encode(raw).length).toBeLessThanOrEqual(maximumBytes); return raw; };
  return { manifest, values, requested, reader };
}
it('bundled fixture and genuine recording retain distinct qualified categories', async () => {
  const input = assets(), entries = await loadRecordingGallery('/nested/', input.reader);
  expect(entries).toHaveLength(3); expect(entries[0]?.category).toBe('fixture'); expect(entries[0]?.status).toBe('qualified');
  expect(entries[0]?.playback?.recording_sha256).toBe(entries[0]?.recordingSha256); expect(entries[0]?.rawRecording).toContain('fixture');
  expect(entries[1]?.category).toBe('live_model'); expect(entries[1]?.status).toBe('qualified');
  expect(entries[1]?.playback?.provenance.label).toBe('Recorded agent run');
  expect(entries[2]?.category).toBe('live_model'); expect(entries[2]?.status).toBe('qualified');
  expect(entries[1]?.playback?.setup.config.clocks.primary).toBe(true);
  expect(entries[2]?.playback?.setup.config.clocks).toEqual({ primary: false, shadow: false });
});
it('gallery validates the complete owner manifest before fetching asset paths', async () => {
  for (const path of ['https://example.com/a.json', '../a.json', 'recordings/fixtures/%2e.json']) {
    const input = assets(); input.manifest.entries[0].recording.path = path; input.values.set('recordings/gallery.json', JSON.stringify(input.manifest));
    await expect(loadRecordingGallery('/nested/', input.reader)).rejects.toThrow(); expect(input.requested).toEqual(['/nested/recordings/gallery.json']);
  }
  const input = assets(); input.manifest.entries = Array(21).fill(input.manifest.entries[0]); input.values.set('recordings/gallery.json', JSON.stringify(input.manifest));
  await expect(loadRecordingGallery('/nested/', input.reader)).rejects.toThrow(); expect(input.requested).toHaveLength(1);
});
it('a mismatched pin disables that entry without suppressing the gallery', async () => {
  const input = assets(), item = input.manifest.entries[0]; input.values.set(item.recording.path, input.values.get(item.recording.path)! + ' ');
  const entries = await loadRecordingGallery('/nested/', input.reader); expect(entries[0]?.status).toBe('unavailable'); expect(entries[0]?.playback).toBeNull(); expect(entries[0]?.rawRecording).toBeNull();
});
it('pinning changed qualification or category cannot grant playback authority', async () => {
  const input = assets(), item = input.manifest.entries[0]; const qualification = JSON.parse(input.values.get(item.qualification.path)!); qualification.result.cases = [];
  const raw = JSON.stringify(qualification); input.values.set(item.qualification.path, raw); item.qualification.sha256 = sha256Text(raw); input.values.set('recordings/gallery.json', JSON.stringify(input.manifest));
  expect((await loadRecordingGallery('/nested/', input.reader))[0]?.playback).toBeNull();
  const category = assets(); category.manifest.entries[0].category = 'live_model'; category.values.set('recordings/gallery.json', JSON.stringify(category.manifest));
  expect((await loadRecordingGallery('/nested/', category.reader))[0]?.playback).toBeNull();
});
it('an entry without qualification remains replay inspection only and duplicate identities reject', async () => {
  const input = assets(); input.manifest.entries[0].qualification = null; input.values.set('recordings/gallery.json', JSON.stringify(input.manifest));
  const entries = await loadRecordingGallery('/nested/', input.reader); expect(entries[0]?.status).toBe('inspection_only'); expect(entries[0]?.rawRecording).not.toBeNull(); expect(entries[0]?.playback).toBeNull();
  const duplicate = assets(); duplicate.manifest.entries.push(duplicate.manifest.entries[0]); duplicate.values.set('recordings/gallery.json', JSON.stringify(duplicate.manifest));
  await expect(loadRecordingGallery('/nested/', duplicate.reader)).rejects.toThrow('Duplicate gallery entry'); expect(duplicate.requested).toHaveLength(1);
});
it('gallery enforces byte bounds even when a custom asset reader omits its own check', async () => {
  await expect(loadRecordingGallery('/nested/', async () => ' '.repeat(32769))).rejects.toThrow('size limit');
});
