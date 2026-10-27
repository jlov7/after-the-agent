import { createInterface } from 'node:readline/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardSchema, sha256Json, validateRequest, type BoardRequest } from '../../contracts/src/index.js';
import { openMcpPlayground, PLAYGROUND_LIMITS, type PlaygroundReply } from './mcp-playground.js';
import { parseStrictJson } from './strict-json.js';

type Schema = { $ref?: string; oneOf?: Schema[]; type?: string; const?: unknown; enum?: unknown[]; minimum?: number; maximum?: number; properties?: Record<string, Schema>; required?: string[]; items?: Schema };
export interface GuidedField { readonly name: string; readonly type: string; readonly choices: readonly unknown[] | null; readonly minimum: number | null; readonly maximum: number | null }
export interface GuidedAction { readonly type: string; readonly mutation: boolean; readonly fields: readonly GuidedField[] }
const definitions = boardSchema.$defs as Record<string, Schema>;
const resolveSchema = (schema: Schema): Schema => schema.$ref ? definitions[schema.$ref.split('/').at(-1)!]! : schema;
function actionArms(schema: Schema): Schema[] {
  const resolved = resolveSchema(schema);
  return resolved.oneOf ? resolved.oneOf.flatMap(actionArms) : [resolved];
}
const schemas = actionArms(definitions.Action!);
export function guidedActions(): GuidedAction[] {
  return schemas.map(schema => {
    const type = String(schema.properties!.type!.const);
    return { type, mutation: type !== 'inspect', fields: Object.entries(schema.properties!).filter(([name]) => name !== 'type').map(([name, property]) => {
      const field = resolveSchema(property);
      return { name, type: field.type!, choices: field.enum ?? null, minimum: field.minimum ?? null, maximum: field.maximum ?? null };
    }) };
  });
}
export function buildGuidedRequest(type: string, fields: unknown, requestId: string, revision?: number): BoardRequest {
  if (!guidedActions().some(action => action.type === type)) throw new Error('Unknown canonical action');
  if (!fields || typeof fields !== 'object' || Array.isArray(fields) || Object.hasOwn(fields, 'type')) throw new Error('Action fields must be a JSON object without a type override');
  return validateRequest({ schema_version: '1.0', request_id: requestId, ...(revision === undefined ? {} : { expected_revision: revision }), action: { type, ...fields } });
}
function exampleValue(schema: Schema): unknown {
  const field = resolveSchema(schema);
  if (field.enum) return field.enum[0];
  if (field.type === 'boolean') return true;
  if (field.type === 'integer') return field.minimum ?? 0;
  if (field.type === 'array') return ['primary.4.left'];
  throw new Error('A canonical field requires an explicit example');
}
export function guidedExamples(revision = 0): BoardRequest[] {
  return schemas.map((schema, index) => {
    const type = String(schema.properties!.type!.const);
    const fields = Object.fromEntries(Object.entries(schema.properties!).filter(([name]) => name !== 'type').map(([name, field]) => [name, exampleValue(field)]));
    return buildGuidedRequest(type, fields, `guide.example.${index + 1}`, type === 'inspect' ? undefined : revision);
  });
}
export function describeToolReply(reply: PlaygroundReply) {
  const value = reply.response.structuredContent;
  const result = value && typeof value === 'object' ? value as Record<string, unknown> : null;
  const error = result?.error && typeof result.error === 'object' ? result.error as Record<string, unknown> : null;
  const code = typeof error?.code === 'string' ? error.code : reply.status === 'tool_error' ? 'INVALID_REQUEST' : null;
  const explanations: Record<string, string> = {
    REVISION_CONFLICT: 'The board changed. Send a fresh inspect request, then construct a new request ID with the returned revision.',
    REQUEST_ID_CONFLICT: 'This request ID already names different arguments. Keep the original arguments for a retry, or use a new ID for a different action.',
    ACTOR_FORBIDDEN: 'The host owns identity and authority. A request cannot change them.',
    PHASE_FORBIDDEN: 'This action is unavailable in the host current phase. Arguments cannot change the phase.',
    UNKNOWN_JOB: 'Inspect the current queue and select an existing job ID.',
    INVALID_REQUEST: 'The request does not match the canonical schema. Check required fields, exact types and revision. Actor, phase and world are host-owned.',
    BUDGET_LIMIT: 'The fixed local board has reached a resource limit.',
    HISTORY_CAPACITY: 'The fixed local board has reached its command capacity.',
  };
  return { request_id: typeof result?.request_id === 'string' ? result.request_id : null, applied: result?.outcome === 'accepted' && result.no_op !== true, code, explanation: code ? explanations[code] ?? 'The host rejected the request; inspect its actual response.' : result?.no_op === true ? 'Accepted without a new state change.' : 'Accepted by the local stdio host.' };
}
const emit = (value: unknown) => process.stdout.write(JSON.stringify(value) + '\n');
export async function guideMain(args: readonly string[] = process.argv.slice(2)): Promise<void> {
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write('Guided local MCP requests. No network or model is used.\n--schema: canonical schema and field guide. --examples: valid request examples.\n--action TYPE --fields JSON [--revision INTEGER] [--request-id ID] [--send]\nWithout --send, print a validated request. With --send, inspect the actual local stdio host first and use its revision unless supplied.\nWith no options, open the terminal wizard. Commands are previewed before explicit local submission.\n'); return;
  }
  if (args.length === 1 && args[0] === '--schema') { emit({ schema_sha256: sha256Json(boardSchema), schema: boardSchema, actions: guidedActions(), authority: 'Identity, phase and world are host-owned. The builder cannot grant authority.' }); return; }
  if (args.length === 1 && args[0] === '--examples') { emit({ examples: guidedExamples(), note: 'Revision zero and example job IDs are schema examples. Inspect the actual host before mutation.' }); return; }
  const options = new Map<string, string>(); let send = false;
  for (let index = 0; index < args.length; index++) {
    const flag = args[index]!;
    if (flag === '--send' && !send) { send = true; continue; }
    if (!['--action', '--fields', '--revision', '--request-id'].includes(flag) || options.has(flag) || args[index + 1] === undefined) throw new Error('Unknown or repeated guide option; use --help');
    options.set(flag, args[++index]!);
  }
  if (args.length && (!options.has('--action') || !options.has('--fields'))) throw new Error('Supply --action and --fields together');
  if (args.length && !send) {
    const fieldsRaw = options.get('--fields')!;
    if (Buffer.byteLength(fieldsRaw) > PLAYGROUND_LIMITS.requestBytes) throw new Error('Guided fields exceed 64 KiB');
    const revision = options.has('--revision') ? Number(options.get('--revision')) : undefined;
    emit({ request: buildGuidedRequest(options.get('--action')!, parseStrictJson(fieldsRaw), options.get('--request-id') ?? 'guide.1', revision), sent: false }); return;
  }
  if (!args.length && !process.stdin.isTTY) throw new Error('The terminal wizard requires a TTY; use --action and --fields for scripted construction');
  const playground = await openMcpPlayground();
  const readline = !args.length ? createInterface({ input: process.stdin, output: process.stdout }) : null;
  const abort = new AbortController(); let bytes = 0;
  const limit = (chunk: Buffer | string) => { bytes += Buffer.byteLength(chunk); if (bytes > PLAYGROUND_LIMITS.totalBytes) { abort.abort(); readline?.close(); } };
  if (readline) process.stdin.on('data', limit);
  const timer = setTimeout(() => { abort.abort(); readline?.close(); void playground.close(); }, PLAYGROUND_LIMITS.elapsedMs); timer.unref();
  try {
    const inspected = await playground.request(buildGuidedRequest('inspect', { target: 'board' }, 'guide.observe'));
    const result = inspected.response.structuredContent as { revision?: unknown; observation?: { plant?: { queue?: { id: string }[] } } } | undefined;
    if (!result || typeof result.revision !== 'number') throw new Error('Local host did not return a board revision');
    let type = options.get('--action'), id = options.get('--request-id') ?? 'guide.1';
    const fields: Record<string, unknown> = {};
    if (readline) {
      const ask = async (prompt: string) => {
        const answer = await readline.question(prompt, { signal: abort.signal });
        if (Buffer.byteLength(answer) > PLAYGROUND_LIMITS.requestBytes) throw new Error('Guided answer exceeds 64 KiB');
        return answer;
      };
      process.stdout.write('Local human recovery host. Identity, phase and world are fixed.\n');
      for (const [index, action] of guidedActions().entries()) process.stdout.write(`${index + 1}. ${action.type}\n`);
      const selected = (await ask('Choose action name or number: ')).trim();
      const action = guidedActions().find(item => item.type === selected) ?? guidedActions()[Number(selected) - 1];
      if (!action) throw new Error('Unknown canonical action'); type = action.type;
      for (const field of action.fields) {
        const hint = field.choices ? field.choices.map(value => JSON.stringify(value)).join(', ') : field.type === 'integer' ? `${field.minimum} through ${field.maximum}` : field.name === 'job_ids' ? `JSON array; current jobs: ${(result.observation?.plant?.queue ?? []).map(job => job.id).join(', ')}` : field.type;
        const answer = await ask(`${field.name} (${hint}): `);
        fields[field.name] = field.type === 'string' ? answer : parseStrictJson(answer);
      }
      id = (await ask('Request ID [guide.1]: ')).trim() || 'guide.1';
      const request = buildGuidedRequest(type!, fields, id, action.mutation ? result.revision : undefined);
      emit({ request, sent: false });
      if ((await ask('Submit this request to the local board? [yes/no]: ')).trim() !== 'yes') { emit({ request_id: id, status: 'not_sent' }); return; }
      const reply = await playground.request(request); emit({ request, reply, guidance: describeToolReply(reply) });
    } else {
      const raw = options.get('--fields')!;
      if (Buffer.byteLength(raw) > PLAYGROUND_LIMITS.requestBytes) throw new Error('Guided fields exceed 64 KiB');
      const revision = options.has('--revision') ? Number(options.get('--revision')) : result.revision;
      const request = buildGuidedRequest(type!, parseStrictJson(raw), id, revision);
      const reply = await playground.request(request); emit({ request, reply, guidance: describeToolReply(reply) });
    }
  } finally { clearTimeout(timer); abort.abort(); process.stdin.off('data', limit); readline?.close(); await playground.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void guideMain().catch(error => { process.stderr.write(JSON.stringify({ level: 'error', request_id: 'guide.input', code: 'GUIDE_FAILED', message: error instanceof Error ? error.message.slice(0, 1024) : 'Guided request failed' }) + '\n'); process.exitCode = 1; });
