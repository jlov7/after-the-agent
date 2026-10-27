import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { boardSchema, sha256Json, sha256Text, validateRequest, type BoardResult, type CommandRecord, type DomainEvent, type FrozenCandidate, type Recording, type RecordingManifest } from '../../contracts/src/index.js';
import { constructionSetup, createEngine, scenarioSetup, snapshot } from '../../engine/src/index.js';
import { capturePreflight } from './capture.js';
import { buildCorpus } from './continuations.js';
import { evaluateCandidate, referenceDirectory } from './node.js';
import { verifyReferenceFiles } from './reference-files.js';
import { recordingCommitment } from './recording-schema.js';
import { replay } from './replay.js';

export const CODEX_CAPTURE_MODEL = 'gpt-6.1-sol';
export const CODEX_CAPTURE_VERSION = '0.160.1';
export const CODEX_CAPTURE_SYSTEM = 'Configure a small deterministic alternating-lights installation using only board_action. The recorder owns identity, phase, world inputs and evidence. Finish the requested setup, then give one short completion message. Do not request or emit hidden reasoning.';
export const CODEX_CAPTURE_PROMPT = 'Configure the board to alternate left on odd nominal beats and right on even nominal beats, with center also on every fourth beat. Nominal firings are at ticks 4,8,12,...; queue delay is 2 ticks. A scene/activity change increments the epoch before enqueue/delivery; work must not deliver across epochs. Use only board_action. Inspect the actual initial board, configure it to meet this target under future scene/activity changes, and advance to settled tick 5, then stop. Preserve the actual pending work from tick 4, including its due tick and enqueue epoch. Do not drop it or advance beyond tick 5. Use schema_version "1.0", unique request_id values, and expected_revision from the latest result for mutations. You may inspect board, queue, clocks, gate or history. This is a setup demonstration, not a repair trial or a model success-rate study.';
export const CODEX_CAPTURE_LIMITS = { max_tool_calls: 16, max_model_items: 32, max_elapsed_ms: 120000, max_stream_bytes: 8 * 1024 * 1024 } as const;
const disabled = ['shell_tool', 'unified_exec', 'apps', 'plugins', 'remote_plugin', 'memories', 'chronicle', 'multi_agent', 'multi_agent_v2', 'hooks', 'browser_use', 'browser_use_external', 'browser_use_full_cdp_access', 'computer_use', 'in_app_browser', 'image_generation', 'code_mode_host', 'sleep_tool', 'goals', 'context_management', 'skill_search', 'workspace_dependencies', 'view_image', 'unbounded_connection_retries', 'shell_snapshot', 'worktrees'];
export function captureEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL']) if (process.env[name]) env[name] = process.env[name];
  return env;
}
export function restrictCodexCatalog(value: unknown): { models: Record<string, unknown>[] } {
  const catalog = z.object({ models: z.array(z.record(z.string(), z.unknown())) }).parse(value);
  const selected = catalog.models.find(model => model.slug === CODEX_CAPTURE_MODEL);
  if (!selected) throw new Error('Pinned capture model is absent from the installed catalog');
  const model = { ...selected, shell_type: 'disabled', supports_search_tool: false, experimental_supported_tools: [] };
  for (const name of ['tool_mode', 'multi_agent_version', 'apply_patch_tool_type']) delete (model as Record<string, unknown>)[name];
  return { models: [model] };
}
export function codexCaptureConfig(directory: string): Record<string, unknown> {
  return { model: CODEX_CAPTURE_MODEL, model_provider: 'openai', model_catalog_json: join(directory, 'restricted-models.json'), model_instructions_file: join(directory, 'system.txt'), developer_instructions: '', project_doc_max_bytes: 0, include_environment_context: false, web_search: 'disabled', 'tools.update_plan.enabled': false, 'tools.experimental_request_user_input.enabled': false, 'skills.include_instructions': false, 'skills.bundled.enabled': false, 'analytics.enabled': false, 'feedback.enabled': false, service_tier: 'default', ...Object.fromEntries(disabled.map(name => ['features.' + name, false])) };
}
export function codexCaptureArgs(directory: string, overrides: Record<string, unknown> = {}): string[] {
  const args = ['app-server', '--stdio', '--strict-config'];
  const toml = (value: unknown): string => {
    if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(toml).join(',') + ']';
    if (typeof value === 'object' && value !== null) return '{' + Object.entries(value).map(([key, item]) => JSON.stringify(key) + '=' + toml(item)).join(',') + '}';
    throw new Error('Unsupported capture configuration value');
  };
  for (const [key, value] of Object.entries({ ...codexCaptureConfig(directory), ...overrides })) args.push('-c', `${key}=${toml(value)}`);
  return args;
}
const nativeCall = z.object({ threadId: z.string(), turnId: z.string(), callId: z.string().max(256), namespace: z.string().nullable().optional(), tool: z.literal('board_action'), arguments: z.unknown() }).strict();
const messageSchema = z.object({ jsonrpc: z.literal('2.0').optional(), emittedAtMs: z.number().int().nonnegative().optional(), id: z.union([z.string(), z.number()]).optional(), method: z.string().optional(), params: z.unknown().optional(), result: z.unknown().optional(), error: z.unknown().optional() }).strict();
export interface CodexCaptureOptions { readonly outputDir: string; readonly mode: 'fixture' | 'live'; readonly construction?: boolean; readonly fixtureHarnessPath?: string; readonly serverPath?: string; readonly configOverrides?: Record<string, unknown>; readonly signal?: AbortSignal }

/** The outer recorder dispatches a single native tool through the real stdio MCP client. */
export async function runCodexCapture(options: CodexCaptureOptions) {
  if (options.mode === 'live' && (options.fixtureHarnessPath || options.configOverrides || options.serverPath)) throw new Error('Live capture refuses fixture overrides');
  const output = resolve(options.outputDir), preflight = await capturePreflight(options.mode, output);
  const env = captureEnvironment();
  const cli = (args: string[]) => execFileSync('codex', args, { env, encoding: 'utf8', timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
  let original: unknown = { models: [{ slug: CODEX_CAPTURE_MODEL }] };
  const disabledServers: Record<string, unknown> = {};
  if (!options.fixtureHarnessPath) {
    if (cli(['--version']).trim() !== `codex-cli ${CODEX_CAPTURE_VERSION}`) throw new Error('Capture requires the reviewed Codex version');
    original = JSON.parse(cli(['debug', 'models', '--bundled']));
    // Use names only. Configuration values, command arguments and credentials are not retained.
    const configured = z.array(z.object({ name: z.string().regex(/^[A-Za-z0-9_-]+$/), transport: z.object({ type: z.enum(['stdio', 'streamable_http']) }).passthrough() }).passthrough()).parse(JSON.parse(cli(['mcp', 'list', '--json'])));
    for (const server of configured) disabledServers[`mcp_servers.${server.name}`] = server.transport.type === 'stdio' ? { command: process.execPath, args: [], enabled: false } : { url: 'http://127.0.0.1/disabled', enabled: false };
  }
  if (options.mode === 'live') {
    const auth = spawnSync('codex', ['login', 'status'], { env, encoding: 'utf8', timeout: 10000 });
    if (auth.status !== 0 || !(auth.stdout + auth.stderr).includes('Logged in using ChatGPT')) throw new Error('An existing ChatGPT subscription login is required; paid API fallback is forbidden');
  }
  await mkdir(output, { recursive: true }); await mkdir(join(output, 'workspace'));
  await writeFile(join(output, 'original-models.json'), JSON.stringify(original, null, 2) + '\n', { flag: 'wx' });
  await writeFile(join(output, 'restricted-models.json'), JSON.stringify(restrictCodexCatalog(original), null, 2) + '\n', { flag: 'wx' });
  await writeFile(join(output, 'system.txt'), CODEX_CAPTURE_SYSTEM, { flag: 'wx' });
  await writeFile(join(output, 'prompt.txt'), CODEX_CAPTURE_PROMPT, { flag: 'wx' });
  if (options.mode === 'live') {
    const { verifyCodexCaptureBoundary } = await import('./codex-boundary.js');
    await verifyCodexCaptureBoundary(join(output, 'boundary'), options.construction === true);
  }
  const setup = options.construction ? constructionSetup() : scenarioSetup('stale-queue'), initial = snapshot(createEngine(setup)); let final = initial;
  const commands: CommandRecord[] = [], events: DomainEvent[] = [];
  const started = Date.now(), runId = randomUUID();
  const base: RecordingManifest = { schema_version: '1.0', run_id: runId, category: options.mode === 'live' ? 'live_model' : 'fixture', provider: options.mode === 'live' ? 'openai' : null, harness_version: `ata-codex-cli-v1/${CODEX_CAPTURE_VERSION}`, requested_model: options.mode === 'live' ? CODEX_CAPTURE_MODEL : null, returned_model: null, unavailable_reason: options.mode === 'live' ? 'Codex exposes the resolved requested model, but not provider-returned model identity or individual provider request counts.' : 'Synthetic harness fixture. No provider request.', started_at: new Date(started).toISOString(), ended_at: null, elapsed_ms: 0, completion: 'failed', application_commit: preflight.application_commit, dirty: preflight.dirty, node_version: process.version, sdk_version: '2.3.1', protocol_version: '2026-07-28', prompt_sha256: sha256Text(CODEX_CAPTURE_PROMPT), tool_schema_sha256: sha256Json(boardSchema), reference_manifest_sha256: '2a1e32b4cf42b1c94c802f9a1822d4878959f652a5afedb4b3cd52123184597f', initial_plant_sha256: sha256Json(initial), world_sha256: sha256Json(setup.world), final_plant_sha256: sha256Json(initial), pulses_sha256: sha256Json([]), model_requests: options.mode === 'live' ? null : 0, tool_calls: 0, token_usage: null, cost_usd: null, replay_status: 'not_run', verification_commit: null };
  await writeFile(join(output, 'manifest-pending.json'), JSON.stringify(base, null, 2) + '\n', { flag: 'wx' });
  await writeFile(join(output, 'exchanges.ndjson'), '', { flag: 'wx' });
  const control = new AbortController(), timer = setTimeout(() => control.abort(new Error('capture_timeout')), CODEX_CAPTURE_LIMITS.max_elapsed_ms);
  const cancel = () => control.abort(new Error('capture_cancelled')); options.signal?.addEventListener('abort', cancel, { once: true }); if (options.signal?.aborted) cancel();
  let seq = 0, toolCalls = 0, modelItems = 0, threadId: string | null = null, turnId: string | null = null, usage: { input: number; output: number } | null = null, completion: RecordingManifest['completion'] = 'failed'; let reason: string;
  const journal = async (stage: string, data: Record<string, unknown>) => appendFile(join(output, 'exchanges.ndjson'), JSON.stringify({ seq: ++seq, stage, elapsed_ms: Date.now() - started, ...data }) + '\n');
  const transport = new StdioClientTransport({ command: process.execPath, args: [options.serverPath ?? join(preflight.root, 'dist/packages/mcp/src/stdio.js'), '--scenario', 'stale-queue', '--setup', ...(options.construction ? ['--construction'] : [])], stderr: 'pipe', maxBufferSize: 1024 * 1024 });
  const client = new Client({ name: 'ata-codex-recorder', version: '1.0.0' }, { versionNegotiation: { mode: { pin: '2026-07-28' }, probe: { timeoutMs: 3000, maxRetries: 0 } } });
  const args = codexCaptureArgs(output, { ...disabledServers, ...options.configOverrides }), child = options.fixtureHarnessPath ? spawn(process.execPath, [options.fixtureHarnessPath], { env, stdio: ['pipe', 'pipe', 'pipe'] }) : spawn('codex', args, { env, cwd: join(output, 'workspace'), stdio: ['pipe', 'pipe', 'pipe'] });
  let id = 0, buffer = '', streamBytes = 0, stderrBytes = 0, serial = Promise.resolve(); const decoder = new StringDecoder('utf8');
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  let finish!: (value: Record<string, unknown>) => void;
  const finished = new Promise<Record<string, unknown>>(resolve => { finish = resolve; });
  const send = (value: unknown) => { control.signal.throwIfAborted(); return child.stdin.write(JSON.stringify(value) + '\n'); };
  const request = (method: string, params: unknown) => new Promise<unknown>((resolve, reject) => { control.signal.throwIfAborted(); const current = ++id; pending.set(current, { resolve, reject }); send({ id: current, method, params }); });
  const stop = (error: Error) => { if (!control.signal.aborted) control.abort(error); };
  control.signal.addEventListener('abort', () => { const error = control.signal.reason as Error; for (const p of pending.values()) p.reject(error); pending.clear(); finish({ status: 'interrupted' }); child.kill('SIGTERM'); }, { once: true });
  child.on('error', error => stop(error)); child.on('exit', () => { if (completion !== 'complete') stop(new Error('harness_exited')); });
  child.stdin.on('error', () => stop(new Error('harness_stdin_closed')));
  child.stderr.on('data', (data: Buffer) => { stderrBytes += data.length; if (stderrBytes > 65536) stop(new Error('stderr_limit')); });
  const handle = async (raw: unknown) => {
    if (control.signal.aborted) return;
    const envelope = messageSchema.safeParse(raw);
    if (!envelope.success) { await journal('harness_envelope_rejected', { keys: typeof raw === 'object' && raw !== null ? Object.keys(raw) : [], issues: envelope.error.issues.map(item => ({ path: item.path, code: item.code, ...('keys' in item ? { keys: item.keys } : {}) })) }); throw new Error('invalid_harness_envelope'); }
    const message = envelope.data;
    if (message.id !== undefined && !message.method) { const p = pending.get(Number(message.id)); if (p) { pending.delete(Number(message.id)); if (message.error) p.reject(new Error('Harness RPC rejected')); else p.resolve(message.result); } return; }
    if (message.method === 'item/tool/call') {
      await journal('native_received', { raw_call: message.params });
      const call = nativeCall.parse(message.params);
      if (call.threadId !== threadId || (turnId !== null && call.turnId !== turnId) || call.namespace) throw new Error('Unexpected native call identity');
      if (++toolCalls > CODEX_CAPTURE_LIMITS.max_tool_calls) throw new Error('tool_call_limit');
      const action = validateRequest(call.arguments);
      const returned = await client.callTool({ name: 'board_action', arguments: call.arguments as Record<string, unknown> }, { timeout: 5000, signal: control.signal });
      const result = returned.structuredContent as unknown as BoardResult;
      if (!result || result.request_id !== action.request_id || !['accepted', 'rejected'].includes(result.outcome)) throw new Error('Missing actual MCP dispatcher response');
      commands.push({ seq: commands.length + 1, request: action, actor: { actor_id: 'assessed-model', role: 'assessed_agent', phase: 'setup' }, tick: result.observation.plant.tick, elapsed_ms: Date.now() - started, result });
      final = result.observation.plant;
      for (const event of result.events) { const old = events.find(item => item.seq === event.seq); if (old && sha256Json(old) !== sha256Json(event)) throw new Error('MCP event identity conflict'); if (!old) events.push(event); }
      await journal('returned', { call_id: call.callId, result: returned });
      send({ id: message.id, result: { contentItems: [{ type: 'inputText', text: JSON.stringify(returned) }], success: !returned.isError } });
    } else if (message.id !== undefined && message.method) throw new Error('Unadvertised harness capability requested');
    else if (message.method === 'turn/completed') finish(z.object({ turn: z.record(z.string(), z.unknown()) }).parse(message.params).turn);
    else if (message.method === 'item/completed') {
      const params = z.object({ item: z.record(z.string(), z.unknown()) }).passthrough().parse(message.params);
      if (++modelItems > CODEX_CAPTURE_LIMITS.max_model_items) throw new Error('model_item_limit');
      // Reasoning items and raw provider payloads are deliberately not retained.
      if (params.item.type === 'agentMessage') await journal('visible_response', { text: z.string().max(16384).parse(params.item.text) });
    } else if (message.method === 'thread/tokenUsage/updated') {
      const parsed = z.object({ tokenUsage: z.object({ total: z.object({ inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative() }) }) }).passthrough().safeParse(message.params);
      if (parsed.success) usage = { input: parsed.data.tokenUsage.total.inputTokens, output: parsed.data.tokenUsage.total.outputTokens };
    }
  };
  child.stdout.on('data', (data: Buffer) => {
    streamBytes += data.length; if (streamBytes > CODEX_CAPTURE_LIMITS.max_stream_bytes) return stop(new Error('stream_limit'));
    buffer += decoder.write(data); let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1); if (line.trim()) serial = serial.then(() => handle(JSON.parse(line))).catch(async error => { await journal('harness_boundary_rejected', { issues: error instanceof z.ZodError ? error.issues.map(item => ({ path: item.path, code: item.code })) : null }); stop(new Error(error instanceof Error && ['tool_call_limit', 'model_item_limit'].includes(error.message) ? error.message : 'invalid_harness_exchange')); }); }
  });
  try {
    control.signal.throwIfAborted(); await client.connect(transport, { timeout: 3000, signal: control.signal });
    const tools = await client.listTools(undefined, { timeout: 3000, signal: control.signal });
    if (tools.tools.length !== 1 || tools.tools[0]?.name !== 'board_action' || sha256Json(tools.tools[0].inputSchema) !== sha256Json(boardSchema)) throw new Error('Unexpected MCP capability surface');
    await request('initialize', { clientInfo: { name: 'ata_assessed_capture', version: '1.0.0' }, capabilities: { experimentalApi: true } }); send({ method: 'initialized' });
    await journal('unrelated_mcp_disabled', { count: Object.keys(disabledServers).length });
    const provider = String(options.configOverrides?.model_provider ?? 'openai');
    const thread = z.object({ thread: z.object({ id: z.string() }), model: z.literal(CODEX_CAPTURE_MODEL), modelProvider: z.literal(provider) }).passthrough().parse(await request('thread/start', { model: CODEX_CAPTURE_MODEL, modelProvider: provider, allowProviderModelFallback: false, cwd: join(output, 'workspace'), ephemeral: true, approvalPolicy: 'never', sandbox: 'read-only', baseInstructions: CODEX_CAPTURE_SYSTEM, developerInstructions: '', config: { ...codexCaptureConfig(output), ...disabledServers, ...options.configOverrides }, environments: [], dynamicTools: [{ type: 'function', name: 'board_action', description: 'The only assessed capability. Dispatch the canonical request through local stdio MCP. Identity, phase and world are host-owned.', inputSchema: boardSchema }] }));
    threadId = thread.thread.id;
    await journal('harness_started', { harness: base.harness_version, requested_model: CODEX_CAPTURE_MODEL, resolved_model: thread.model, limits: CODEX_CAPTURE_LIMITS, account_boundary: options.mode === 'live' ? 'existing_chatgpt_subscription_only_no_api_fallback' : 'synthetic_no_provider' });
    const turn = z.object({ turn: z.object({ id: z.string() }) }).passthrough().parse(await request('turn/start', { threadId, input: [{ type: 'text', text: CODEX_CAPTURE_PROMPT }], model: CODEX_CAPTURE_MODEL, effort: 'medium', summary: 'none', environments: [], serviceTierForTurn: 'default' })); turnId = turn.turn.id;
    const end = await finished; await serial; control.signal.throwIfAborted();
    if (end.status !== 'completed' || commands.length < 1 || final.tick !== 5) throw new Error('Missing complete tick-five model construction');
    completion = 'complete'; reason = 'observed_harness_run_replayed';
  } catch { reason = control.signal.aborted ? String((control.signal.reason as Error)?.message ?? 'capture_cancelled') : 'capture_failed_at_explicit_boundary'; completion = reason === 'capture_cancelled' ? 'cancelled' : reason === 'capture_timeout' ? 'timeout' : reason.includes('limit') ? 'budget_stop' : 'failed'; }
  finally { clearTimeout(timer); options.signal?.removeEventListener('abort', cancel); child.stdin.end(); child.kill('SIGTERM'); await client.close(); await transport.close(); }
  let sourceUnchanged = false;
  try {
    const endSource = await capturePreflight('fixture', join(output, 'unused-source-check'));
    sourceUnchanged = preflight.application_commit === endSource.application_commit && preflight.dirty === endSource.dirty;
    await writeFile(join(output, 'source-custody.json'), JSON.stringify({ start: preflight, end: endSource, unchanged: sourceUnchanged }, null, 2) + '\n');
  } catch { reason = 'source_custody_unavailable'; }
  if (!sourceUnchanged) { completion = 'failed'; reason = 'source_changed_during_capture'; }
  let recording: Recording = { schema_version: '1.0', manifest: { ...base, ended_at: new Date().toISOString(), elapsed_ms: Date.now() - started, completion, tool_calls: commands.length, token_usage: options.mode === 'live' ? usage : null, final_plant_sha256: sha256Json(final), pulses_sha256: sha256Json(events.filter(event => event.type === 'pulse')) }, setup, initial_plant: initial, commands, events, final_plant: final };
  const checked = replay(recording, options.mode === 'live' ? { trusted_live_sha256: recordingCommitment(recording) } : {});
  recording = { ...recording, manifest: { ...recording.manifest, replay_status: checked.status === 'verified' ? 'verified' : 'failed', verification_commit: preflight.application_commit } };
  await writeFile(join(output, 'recording.json'), JSON.stringify(recording, null, 2) + '\n', { flag: 'wx' });
  await writeFile(join(output, 'replay.json'), JSON.stringify(checked, null, 2) + '\n', { flag: 'wx' });
  let behavior: Record<string, unknown> = { schema_version: '1.0', status: 'not_run', reason: 'Incomplete or unverified recording', candidate: null, corpus: null, result: null }, eligible = false;
  if (completion === 'complete' && checked.status === 'verified') {
    const verificationStarted = Date.now();
    try {
    const candidate: FrozenCandidate = { schema_version: '1.0', plant: final, world_prefix: { initial_world: setup.world.initial_world, transitions: setup.world.transitions.filter(change => change.tick <= 5) }, task: setup.task, candidate_sha256: sha256Json(final), attempt_id: runId, capture_tick: 5, original_handover_tick: 5, terminal_reason: 'submitted', reset_during_attempt: false };
    const corpus = buildCorpus(candidate), result = await evaluateCandidate(candidate, corpus);
    eligible = result.status === 'pass' && result.cases.length === 12 && result.cases.every(item => item.status === 'pass');
    await writeFile(join(output, 'reference-verification.json'), JSON.stringify(verifyReferenceFiles(referenceDirectory()), null, 2) + '\n');
    behavior = { schema_version: '1.0', status: eligible ? 'passed' : 'failed', reason: eligible ? 'Independent target behavior passed all12continuations' : 'Target behavior failed', reference_manifest_sha256: base.reference_manifest_sha256, reference_directory: 'pinned-reference', elapsed_ms: Date.now() - verificationStarted, candidate, corpus, result };
    reason = eligible ? 'target_behavior_verified' : 'target_behavior_failed';
    } catch { behavior = { ...behavior, status: 'failed', reason: 'Anchored independent target verification unavailable' }; reason = 'target_behavior_not_verified'; eligible = false; }
  }
  const status = { status: eligible ? 'passed' : 'failed', eligible, reason, category: recording.manifest.category, genuine_model_observed: options.mode === 'live' && commands.length > 0, attempted_provider_requests: options.mode === 'live' ? null : 0, observed_provider_responses: options.mode === 'live' ? null : 0, observed_native_tool_calls: toolCalls, replay_status: checked.status, behavioral_verification: behavior.status, account_boundary: 'Existing subscription only. No API key, paid fallback, purchase or credit reset.', accounting_limits: 'Individual provider requests, returned model identity and invoice cost are not exposed. Token totals, when available, are reported by the CLI. Runtime, native tool calls, model items and stream bytes have hard limits.', hash_limits: 'Local consistency commitments do not independently authenticate model authorship.' };
  for (const [name, value] of Object.entries({ 'behavioral-verification.json': behavior, 'status.json': status })) await writeFile(join(output, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  return { status, recording, checked };
}
