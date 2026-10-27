import { createInterface } from 'node:readline';
const send = value => process.stdout.write(JSON.stringify({ ...value, emittedAtMs: Date.now() }) + '\n');
let step = 0, request = 100, revision = 0, kind = 'success';
function next() {
  const actions = [{ type: 'inspect', target: 'board' }, { type: 'set_clock', clock: 'primary', enabled: true }, ...(kind === 'construction' ? [{ type: 'set_gate_mode', mode: 'live' }, { type: 'set_epoch_guard', enabled: true }] : []), { type: 'advance', ticks: 4 }, { type: 'advance', ticks: 1 }];
  if (kind === 'quota' || step < actions.length) {
    const action = kind === 'quota' ? { type: 'inspect', target: 'board' } : actions[step];
    send({ id: ++request, method: 'item/tool/call', params: { threadId: 'fixture-thread', turnId: 'fixture-turn', callId: 'fixture.' + step, tool: kind === 'unknown' ? 'apply_patch' : 'board_action', arguments: { schema_version: '1.0', request_id: 'fixture.' + step, ...(action.type === 'inspect' ? {} : { expected_revision: revision }), action } } }); step++;
  } else {
    send({ method: 'item/completed', params: { item: { type: 'reasoning', text: 'synthetic-hidden-reasoning-must-not-be-retained' } } });
    send({ method: 'item/completed', params: { item: { type: 'agentMessage', text: 'Synthetic fixture complete.' } } });
    send({ method: 'turn/completed', params: { turn: { id: 'fixture-turn', status: 'completed' } } });
  }
}
for await (const line of createInterface({ input: process.stdin })) {
  const m = JSON.parse(line);
  if (m.method === 'initialize') send({ id: m.id, result: {} });
  else if (m.method === 'thread/start') { kind = m.params.config['fixture.kind'] ?? 'success'; send({ id: m.id, result: { thread: { id: 'fixture-thread' }, model: m.params.model, modelProvider: m.params.modelProvider } }); }
  else if (m.method === 'turn/start') { send({ id: m.id, result: { turn: { id: 'fixture-turn' } } }); if (kind !== 'silent') next(); }
  else if (m.id > 100 && m.result) { revision = JSON.parse(m.result.contentItems[0].text).structuredContent.revision; next(); }
}
