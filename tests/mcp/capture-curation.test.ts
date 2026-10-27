import { readFile, mkdir, mkdtemp } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { fixtureCaptureConfig, runCapture } from '../../packages/runner/src/capture.js';
import { sha256Text, type Recording } from '../../packages/contracts/src/index.js';
import { loadCuratedPlayback } from '../../apps/web/src/recordings/curated.js';
import { recordingCommitment, validateRecording } from '../../packages/runner/src/recording-schema.js';

it('unchanged successful recorder artifacts load through the public curated source contract', async () => {
  await mkdir('work/recordings', { recursive: true });
  const outputDir = await mkdtemp('work/recordings/curation-');
  const result = await runCapture(fixtureCaptureConfig, { outputDir });
  expect(result.status).toBe('passed');
  const recording = await readFile(`${outputDir}/recording.json`, 'utf8');
  const qualification = await readFile(`${outputDir}/behavioral-verification.json`, 'utf8');
  const manifest = { schema_version: '1.0', selected: { id: 'capture-fixture', category: 'fixture', recording: { path: 'recordings/fixtures/capture.json', sha256: sha256Text(recording) }, qualification: { path: 'recordings/fixtures/qualification.json', sha256: sha256Text(qualification) } } };
  const assets = new Map([['recordings/manifest.json', JSON.stringify(manifest)], ['recordings/fixtures/capture.json', recording], ['recordings/fixtures/qualification.json', qualification]]);
  const playback = await loadCuratedPlayback('/', async url => assets.get(url.slice(1))!);
  expect(playback?.provenance.category).toBe('fixture');
  expect(playback?.commands.at(-1)?.result.observation.plant.queue).toHaveLength(1);
});

it('unavailable returned-model metadata is explicit and does not invalidate otherwise observed provenance', async () => {
  // Synthetic provenance validation only. This does not establish a provider call.
  const fixture = JSON.parse(await readFile('apps/web/public/recordings/fixtures/recording-fixture.json', 'utf8')) as Recording;
  const recording: Recording = { ...fixture, manifest: { ...fixture.manifest, category: 'live_model', provider: 'openai', harness_version: 'ata-responses-bridge-v1', requested_model: 'synthetic-pinned-model', returned_model: null, model_requests: 1, dirty: false, unavailable_reason: 'Validated provider response did not expose returned-model metadata.' } };
  expect(validateRecording(recording, { trusted_live_sha256: recordingCommitment(recording) }).manifest.returned_model).toBeNull();
});

it('subscription harness request counts remain unknown rather than being reported as zero', async () => {
  const fixture = JSON.parse(await readFile('apps/web/public/recordings/fixtures/recording-fixture.json', 'utf8')) as Recording;
  const recording: Recording = { ...fixture, manifest: { ...fixture.manifest, category: 'live_model', provider: 'openai', harness_version: 'ata-codex-cli-v1/0.160.1', requested_model: 'gpt-6.1-sol', returned_model: null, model_requests: null, dirty: false, unavailable_reason: 'The CLI does not expose provider request counts or returned-model identity.' } };
  expect(validateRecording(recording, { trusted_live_sha256: recordingCommitment(recording) }).manifest.model_requests).toBeNull();
  const unobserved = { ...recording, manifest: { ...recording.manifest, harness_version: 'ata-responses-bridge-v1' } };
  expect(() => validateRecording(unobserved, { trusted_live_sha256: recordingCommitment(unobserved) })).toThrow('observed live-model provenance');
});
