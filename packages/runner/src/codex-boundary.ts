import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { sha256Json } from '../../contracts/src/index.js';
import { CODEX_CAPTURE_MODEL, CODEX_CAPTURE_VERSION, runCodexCapture } from './codex-capture.js';

const requestSchema = z.object({ model: z.literal(CODEX_CAPTURE_MODEL), tools: z.array(z.unknown()).optional(), input: z.array(z.record(z.string(), z.unknown())) }).passthrough();
const toolSchema = z.object({ type: z.literal('namespace'), name: z.literal('functions'), tools: z.tuple([z.object({ type: z.literal('function'), name: z.literal('board_action') }).passthrough()]) }).passthrough();

/** Real installed harness, fake local provider. Never redirects real authentication to the fixture. */
export async function verifyCodexCaptureBoundary(directory: string, construction = false) {
  const output = resolve(directory); await mkdir(output, { recursive: true });
  const receipts: Record<string, unknown>[] = [];
  for (const kind of ['construction', 'forbidden-tool'] as const) {
    let requests = 0, invalid = false;
    const inventory: Record<string, unknown>[] = [];
    const server = createServer(async (request, response) => {
      try {
        let raw = '', bytes = 0;
        for await (const chunk of request) { bytes += (chunk as Buffer).length; if (bytes > 1024 * 1024) throw new Error('Fixture request byte limit'); raw += String(chunk); }
        if (++requests > 8) throw new Error('Fixture request limit');
        const body = requestSchema.parse(JSON.parse(raw));
        const tools = [...(body.tools ?? []), ...body.input.filter(item => item.type === 'additional_tools').flatMap(item => z.array(z.unknown()).parse(item.tools))];
        if (tools.length !== 1) throw new Error('Unexpected advertised capability'); toolSchema.parse(tools[0]);
        inventory.push({ request: requests, model: body.model, tools, input_sha256: sha256Json(body.input) });
        const outputs = body.input.filter(item => item.type === 'function_call_output');
        const previous = kind === 'construction' && outputs.length ? JSON.parse(z.string().parse(outputs.at(-1)?.output)) as { structuredContent?: { revision?: number } } : null;
        const revision = previous?.structuredContent?.revision ?? 0, step = requests - 1;
        const actions = [{ type: 'inspect', target: 'board' }, { type: 'set_clock', clock: 'primary', enabled: true }, ...(construction ? [{ type: 'set_gate_mode', mode: 'live' }, { type: 'set_epoch_guard', enabled: true }] : []), { type: 'advance', ticks: 4 }, { type: 'advance', ticks: 1 }];
        const action = actions[step];
        const call = kind === 'forbidden-tool' ? step === 0 : step < actions.length;
        const item = call ? { id: 'fc_fixture_' + step, type: 'function_call', call_id: 'fixture_call_' + step, name: kind === 'forbidden-tool' ? 'apply_patch' : 'board_action', arguments: JSON.stringify({ schema_version: '1.0', request_id: 'native.' + step, ...(step === 0 ? {} : { expected_revision: revision }), action }), status: 'completed' } : { id: 'msg_fixture', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Credential-free provider fixture complete.' }] };
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        const metadata = { id: 'fixture_response_' + step, object: 'response', created_at: 1, model: CODEX_CAPTURE_MODEL };
        for (const event of [{ type: 'response.created', response: { ...metadata, status: 'in_progress', output: [] } }, { type: 'response.output_item.added', output_index: 0, item }, { type: 'response.output_item.done', output_index: 0, item }, { type: 'response.completed', response: { ...metadata, status: 'completed', output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } }]) response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        response.end();
      } catch { invalid = true; response.writeHead(400); response.end('{}'); }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Local fixture unavailable');
    try {
      const configOverrides = { model_provider: 'ata_boundary_fixture', 'model_providers.ata_boundary_fixture.name': 'Credential-free local boundary fixture', 'model_providers.ata_boundary_fixture.base_url': `http://127.0.0.1:${address.port}/v1`, 'model_providers.ata_boundary_fixture.wire_api': 'responses', 'model_providers.ata_boundary_fixture.requires_openai_auth': false, 'model_providers.ata_boundary_fixture.supports_websockets': false, 'model_providers.ata_boundary_fixture.request_max_retries': 0, 'model_providers.ata_boundary_fixture.stream_max_retries': 0 };
      const result = await runCodexCapture({ mode: 'fixture', construction, outputDir: join(output, kind), configOverrides });
      const passed = !invalid && inventory.length > 0 && (kind === 'construction' ? result.status.status === 'passed' && result.recording.commands.length === (construction ? 6 : 4) : result.status.status === 'failed' && result.recording.commands.length === 0 && result.recording.final_plant.tick === 0);
      await writeFile(join(output, kind + '-inventory.json'), JSON.stringify({ category: 'fixture', actual_provider_calls: 0, inventory }, null, 2) + '\n', { flag: 'wx' });
      receipts.push({ kind, passed, local_fixture_requests: requests, actual_provider_calls: 0, actual_mcp_calls: result.recording.commands.length, replay: result.checked.status, behavior: result.status.behavioral_verification });
      await writeFile(join(output, kind + '-check.json'), JSON.stringify(receipts.at(-1), null, 2) + '\n', { flag: 'wx' });
      if (!passed) throw new Error('Installed harness failed its single-tool boundary probe');
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  }
  const receipt = { schema_version: '1.0', status: 'passed', category: 'fixture', cli_version: CODEX_CAPTURE_VERSION, requested_model: CODEX_CAPTURE_MODEL, actual_provider_calls: 0, advertised_tools: ['functions.board_action'], checks: receipts, limits: 'Observed local harness configuration, not independent provider authentication.' };
  await writeFile(join(output, 'boundary-proof.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  return receipt;
}
