import { readFile, mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, it, vi } from 'vitest';
import * as referenceFiles from '../../packages/runner/src/reference-files.js';
import { CODEX_CAPTURE_MODEL, CODEX_CAPTURE_LIMITS, codexCaptureArgs, restrictCodexCatalog, runCodexCapture } from '../../packages/runner/src/codex-capture.js';
import { inspectCaptureFiles } from '../../packages/runner/src/capture-inspection.js';
import { sha256Text } from '../../packages/contracts/src/index.js';
import { loadOwnerPlayback } from '../../apps/web/src/recordings/curated.js';

async function fixture(kind = 'success', signal?: AbortSignal) {
  await mkdir('work/recordings', { recursive: true }); const outputDir = await mkdtemp('work/recordings/codex-fixture-');
  const result = await runCodexCapture({ mode: 'fixture', construction: kind === 'construction', outputDir, fixtureHarnessPath: resolve('tests/mcp/codex-fixture.mjs'), configOverrides: { 'fixture.kind': kind }, ...(signal ? { signal } : {}) });
  return { ...result, outputDir, journal: await readFile(`${outputDir}/exchanges.ndjson`, 'utf8') };
}
it('a synthetic native harness records actual stdio requests and replays without claiming a model call', async () => {
  const result = await fixture();
  expect(result.status.status).toBe('passed'); expect(result.checked.status).toBe('verified');
  expect(result.recording.manifest).toMatchObject({ category: 'fixture', provider: null, model_requests: 0, token_usage: null });
  expect(result.recording.final_plant.tick).toBe(5); expect(result.recording.final_plant.queue).toHaveLength(1);
  expect(result.journal).toContain('native_received'); expect(result.journal).toContain('structuredContent');
  expect(result.journal).not.toContain('synthetic-hidden-reasoning');
  expect(sha256Text(await readFile(`${result.outputDir}/prompt.txt`, 'utf8'))).toBe(result.recording.manifest.prompt_sha256);
});
it('construction captures consequential configuration through stdio and qualifies the unchanged recording for public playback', async () => {
  const result = await fixture('construction');
  expect(result.status.status).toBe('passed');
  expect(result.recording.initial_plant.config).toEqual({ clocks: { primary: false, shadow: false }, gate_mode: 'cached', epoch_guard: false });
  expect(result.recording.commands.slice(1, 4).map(item => item.result.no_op)).toEqual([false, false, false]);
  const recording = await readFile(`${result.outputDir}/recording.json`, 'utf8');
  const qualification = await readFile(`${result.outputDir}/behavioral-verification.json`, 'utf8');
  const source = await loadOwnerPlayback({ id: 'construction-fixture', category: 'fixture', recording: { path: 'recordings/fixtures/construction.json', sha256: sha256Text(recording) }, qualification: { path: 'recordings/fixtures/qualification.json', sha256: sha256Text(qualification) } }, '/', async url => url.endsWith('/construction.json') ? recording : qualification);
  expect(source.setup).toEqual(result.recording.setup);
  expect(source.commands).toEqual(result.recording.commands);
  expect(source.commands.at(-1)?.result.observation.plant.queue[0]?.id).toBe('primary.4.left');
});
it('an unadvertised native tool is retained and rejected before any MCP mutation', async () => {
  const result = await fixture('unknown'); expect(result.status.status).toBe('failed');
  expect(result.recording.commands).toHaveLength(0); expect(result.recording.final_plant.tick).toBe(0);
  expect(result.journal).toContain('apply_patch'); expect(result.journal).not.toContain('structuredContent');
});
it('an inspection loop hits the finite native-call budget without an extra dispatcher call', async () => {
  const result = await fixture('quota'); expect(result.status.status).toBe('failed');
  expect(result.recording.manifest.completion).toBe('budget_stop');
  expect(result.recording.commands).toHaveLength(CODEX_CAPTURE_LIMITS.max_tool_calls);
  expect(result.recording.final_plant.tick).toBe(0);
});
it('cancellation stops a silent harness and leaves an incomplete recording', async () => {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 150);
  try { const result = await fixture('silent', controller.signal); expect(result.status.status).toBe('failed'); expect(result.recording.manifest.completion).toBe('cancelled'); }
  finally { clearTimeout(timer); }
});
it('live capture refuses injected harnesses, servers and provider overrides before output writes', async () => {
  for (const extra of [{ fixtureHarnessPath: 'fixture' }, { serverPath: 'fixture' }, { configOverrides: { model_provider: 'fixture' } }]) await expect(runCodexCapture({ mode: 'live', outputDir: 'work/recordings/forbidden', ...extra })).rejects.toThrow('refuses fixture overrides');
});
it('catalog restriction preserves model identity while removing injected capabilities', () => {
  const original = { models: [{ slug: CODEX_CAPTURE_MODEL, tool_mode: 'code_mode_only', multi_agent_version: 'v2', apply_patch_tool_type: 'freeform', shell_type: 'unified_exec', experimental_supported_tools: ['clock'] }] };
  const result = restrictCodexCatalog(original); expect(result.models[0]).toEqual({ slug: CODEX_CAPTURE_MODEL, shell_type: 'disabled', supports_search_tool: false, experimental_supported_tools: [] });
  expect(original.models[0]!.tool_mode).toBe('code_mode_only'); expect(() => restrictCodexCatalog({ models: [] })).toThrow('absent');
  expect(codexCaptureArgs('/capture')).toContain('features.shell_tool=false');
});

it('post-run reference failure preserves the completed native recording with failed qualification', async () => {
  const check = vi.spyOn(referenceFiles, 'verifyReferenceFiles').mockImplementation(() => { throw new Error('Synthetic post-run reference failure'); });
  try {
    const result = await fixture(); expect(result.status.status).toBe('failed');
    expect(result.recording.manifest.completion).toBe('complete'); expect(result.checked.status).toBe('verified');
    expect(JSON.parse(await readFile(`${result.outputDir}/behavioral-verification.json`, 'utf8')).status).toBe('failed');
    expect(JSON.parse(await readFile(`${result.outputDir}/recording.json`, 'utf8')).commands).toHaveLength(4);
  } finally { check.mockRestore(); }
});
it('the artifact inspector preserves explicit unknown provider counts', () => {
  const result = inspectCaptureFiles([{ name: 'status.json', raw: JSON.stringify({ attempted_provider_requests: null, observed_provider_responses: null }) }, { name: 'exchanges.ndjson', raw: '{"stage":"native_received"}\n' }]);
  expect(result.providerRequests).toBeNull(); expect(result.providerResponses).toBeNull();
});
