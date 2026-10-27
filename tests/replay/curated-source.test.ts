import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { loadCuratedPlayback, type AssetReader } from '../../apps/web/src/recordings/curated.js';
import { createEngine, dispatch, engineAudit, engineEvents, snapshot } from '../../packages/engine/src/index.js';
import { sha256Json, sha256Text, type Recording, type FrozenCandidate } from '../../packages/contracts/src/index.js';
import { buildCorpus } from '../../packages/runner/src/continuations.js';
import { evaluateCandidate } from '../../packages/runner/src/evaluate-browser.js';

const directory = 'apps/web/public/';
const manifestPath = 'recordings/fixtures/manifest-fixture.json';
function assets() {
  const manifest = JSON.parse(readFileSync(directory + manifestPath, 'utf8'));
  const values = new Map([
    ['recordings/manifest.json', JSON.stringify(manifest)],
    [manifest.selected.recording.path as string, readFileSync(directory + manifest.selected.recording.path, 'utf8')],
    [manifest.selected.qualification.path as string, readFileSync(directory + manifest.selected.qualification.path, 'utf8')],
  ]);
  const requested: string[] = [];
  const reader: AssetReader = async (url, maximumBytes) => {
    requested.push(url); const raw = values.get(url.replace('/after-the-agent/', ''));
    if (raw === undefined) throw new Error('Missing local fixture');
    expect(new TextEncoder().encode(raw).length).toBeLessThanOrEqual(maximumBytes);
    return raw;
  };
  const replace = (kind: 'recording' | 'qualification', value: unknown) => {
    const raw = JSON.stringify(value), asset = manifest.selected[kind];
    values.set(asset.path, raw); asset.sha256 = sha256Text(raw);
    values.set('recordings/manifest.json', JSON.stringify(manifest));
  };
  return { manifest, values, requested, reader, replace };
}

it('an absent curated source retains scripted mode without fetching recording assets', async () => {
  const requested: string[] = [];
  const source = await loadCuratedPlayback('/after-the-agent/', async url => {
    requested.push(url); return '{"schema_version":"1.0","selected":null}';
  });
  expect(source).toBeNull(); expect(requested).toEqual(['/after-the-agent/recordings/manifest.json']);
});

it('the actual stdio fixture loads with exact source pins and remains Scripted preview', async () => {
  const fixture = assets(), source = await loadCuratedPlayback('/after-the-agent/', fixture.reader);
  expect(source?.commands).toHaveLength(4);
  expect(source?.commands.at(-1)?.result.observation.plant.queue[0]?.id).toBe('primary.4.left');
  expect(source?.provenance).toEqual({ category: 'fixture', label: 'Scripted preview', model: null, date: null, replay_verified: true });
  expect(source?.recording_sha256).toBe(fixture.manifest.selected.recording.sha256);
  expect(fixture.requested.every(url => url.startsWith('/after-the-agent/recordings/'))).toBe(true);
});

it('changed recording bytes reject before replay even if the file still declares verified', async () => {
  const fixture = assets(), path = fixture.manifest.selected.recording.path;
  fixture.values.set(path, fixture.values.get(path)! + ' ');
  await expect(loadCuratedPlayback('/after-the-agent/', fixture.reader)).rejects.toThrow('commitment differs');
});

it('a new pin cannot make a false final snapshot reproduce actual commands', async () => {
  const fixture = assets(), recording = JSON.parse(fixture.values.get(fixture.manifest.selected.recording.path)!) as Recording;
  const changed = { ...recording, final_plant: { ...recording.final_plant, queue: [] } };
  fixture.replace('recording', { ...changed, manifest: { ...changed.manifest, final_plant_sha256: sha256Json(changed.final_plant) } });
  await expect(loadCuratedPlayback('/after-the-agent/', fixture.reader)).rejects.toThrow('does not reconstruct');
});

it('a pinned success string cannot replace complete independently reconstructed qualification', async () => {
  const fixture = assets(), qualification = JSON.parse(fixture.values.get(fixture.manifest.selected.qualification.path)!);
  qualification.result.cases = []; fixture.replace('qualification', qualification);
  await expect(loadCuratedPlayback('/after-the-agent/', fixture.reader)).rejects.toThrow('target behavior did not verify');
});

it('fixture provenance cannot be promoted by changing the trusted selection category', async () => {
  const fixture = assets(); fixture.manifest.selected.category = 'live_model';
  fixture.values.set('recordings/manifest.json', JSON.stringify(fixture.manifest));
  await expect(loadCuratedPlayback('/after-the-agent/', fixture.reader)).rejects.toThrow('lacks verified source evidence');
});

it('manifest paths reject remote URLs and traversal instead of fetching them', async () => {
  for (const path of ['https://example.com/recording.json', '../recording.json', 'recordings/curated/%2e%2e.json']) {
    const fixture = assets(); fixture.manifest.selected.recording.path = path;
    fixture.values.set('recordings/manifest.json', JSON.stringify(fixture.manifest));
    await expect(loadCuratedPlayback('/after-the-agent/', fixture.reader)).rejects.toThrow();
    expect(fixture.requested).toEqual(['/after-the-agent/recordings/manifest.json']);
  }
});

it('a behaviorally valid empty queue is rejected for the inherited stale-work demonstration', async () => {
  const fixture = assets(), recording = JSON.parse(fixture.values.get(fixture.manifest.selected.recording.path)!) as Recording;
  const engine = createEngine(recording.setup);
  for (const record of recording.commands.slice(0, 3)) {
    if ('request_encoding' in record) throw new Error('Canonical fixture required');
    dispatch(engine, record.request, record.actor);
  }
  const actor = { actor_id: 'assessed-model', role: 'assessed_agent', phase: 'setup' } as const;
  dispatch(engine, { schema_version: '1.0', request_id: 'fixture.drop', expected_revision: snapshot(engine).revision, action: { type: 'drop_jobs', job_ids: ['primary.4.left'] } }, actor);
  dispatch(engine, { schema_version: '1.0', request_id: 'fixture.finish', expected_revision: snapshot(engine).revision, action: { type: 'advance', ticks: 1 } }, actor);
  const plant = snapshot(engine), events = engineEvents(engine);
  expect(plant.tick).toBe(5); expect(plant.queue).toEqual([]);
  const candidate: FrozenCandidate = { schema_version: '1.0', plant, task: recording.setup.task, world_prefix: recording.setup.world, candidate_sha256: sha256Json(plant), attempt_id: recording.manifest.run_id, capture_tick: 5, original_handover_tick: 5, terminal_reason: 'submitted', reset_during_attempt: false };
  const corpus = buildCorpus(candidate), evaluated = await evaluateCandidate(candidate, corpus);
  expect(evaluated.status).toBe('pass'); expect(evaluated.cases).toHaveLength(12);
  fixture.replace('recording', { ...recording, commands: engineAudit(engine), events, final_plant: plant, manifest: { ...recording.manifest, tool_calls: engineAudit(engine).length, final_plant_sha256: sha256Json(plant), pulses_sha256: sha256Json(events.filter(event => event.type === 'pulse')) } });
  const qualification = JSON.parse(fixture.values.get(fixture.manifest.selected.qualification.path)!);
  fixture.replace('qualification', { ...qualification, candidate, corpus, result: evaluated });
  await expect(loadCuratedPlayback('/after-the-agent/', fixture.reader)).rejects.toThrow('preserve its actual inherited stale job');
});
