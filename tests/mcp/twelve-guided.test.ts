import { expect, it } from 'vitest';
import { boardSchema, sha256Json, validateRequest } from '../../packages/contracts/src/index.js';
import { guidedActions, guidedExamples, buildGuidedRequest, describeToolReply } from '../../packages/runner/src/mcp-guide.js';
import { openMcpPlayground } from '../../packages/runner/src/mcp-playground.js';
import { spawnSync } from 'node:child_process';

it('derives every guided action and example from the canonical schema without granting host authority', () => {
  type Arm = { oneOf?: { $ref: string }[]; properties?: { type?: { const: string } } };
  const definitions = boardSchema.$defs as Record<string, Arm>;
  const flatten = (arm: Arm): string[] => arm.oneOf ? arm.oneOf.flatMap(item => flatten(definitions[item.$ref.split('/').at(-1)!]!)) : [arm.properties!.type!.const];
  const types = flatten(definitions.Action!);
  expect(guidedActions().map(action => action.type)).toEqual(types);
  for (const request of guidedExamples(3)) expect(validateRequest(request)).toEqual(request);
  expect(() => buildGuidedRequest('set_clock', { clock: 'shadow', enabled: false, actor: 'controller' }, 'bad', 3)).toThrow();
  expect(() => buildGuidedRequest('set_epoch_guard', { enabled: 'true' }, 'bad', 3)).toThrow();
  expect(() => buildGuidedRequest('set_epoch_guard', { enabled: true }, 'bad')).toThrow();
  expect(guidedActions().every(action => !action.fields.some(field => ['actor', 'phase', 'world'].includes(field.name)))).toBe(true);
});

it('submits built requests over actual stdio and explains actual stale-revision and forbidden-field rejections', async () => {
  const playground = await openMcpPlayground();
  try {
    const inspected = await playground.request(buildGuidedRequest('inspect', { target: 'board' }, 'guide.inspect'));
    const result = inspected.response.structuredContent as { revision: number };
    const mutation = buildGuidedRequest('set_epoch_guard', { enabled: true }, 'guide.edit', result.revision);
    expect((await playground.request(mutation)).response).toMatchObject({ structuredContent: { outcome: 'accepted' } });
    const stale = await playground.request({ ...mutation, request_id: 'guide.stale' });
    expect(describeToolReply(stale)).toMatchObject({ code: 'REVISION_CONFLICT', request_id: 'guide.stale' });
    expect(describeToolReply(stale).explanation).toContain('inspect');
    const forbidden = await playground.request({ ...mutation, request_id: 'guide.authority', actor: 'controller' });
    expect(forbidden.status).toBe('tool_error');
    expect(describeToolReply(forbidden).applied).toBe(false);
    expect(sha256Json(guidedActions())).toMatch(/^[a-f0-9]{64}$/);
  } finally { await playground.close(); }
});

it('CLI emits a valid unsent preview and only invokes stdio for an explicit send', () => {
  const invoke = (args: string[]) => spawnSync(process.execPath, ['dist/packages/runner/src/mcp-guide.js', ...args], { encoding: 'utf8', timeout: 15000 });
  const preview = invoke(['--action', 'set_clock', '--fields', '{"clock":"shadow","enabled":false}', '--revision', '3']);
  expect(preview.status, preview.stderr).toBe(0);
  expect(JSON.parse(preview.stdout)).toMatchObject({ sent: false, request: { expected_revision: 3, action: { type: 'set_clock', clock: 'shadow', enabled: false } } });
  const actual = invoke(['--action', 'set_epoch_guard', '--fields', '{"enabled":true}', '--send']);
  expect(actual.status, actual.stderr).toBe(0);
  expect(JSON.parse(actual.stdout)).toMatchObject({ reply: { status: 'returned', response: { structuredContent: { outcome: 'accepted' } } } });
  const forbidden = invoke(['--action', 'set_clock', '--fields', '{"clock":"shadow","enabled":false,"phase":"setup"}', '--revision', '3']);
  expect(forbidden.status).toBe(1);
  expect(JSON.parse(forbidden.stderr)).toMatchObject({ request_id: 'guide.input', code: 'GUIDE_FAILED' });
});
