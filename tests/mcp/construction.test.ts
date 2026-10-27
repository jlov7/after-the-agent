import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { expect, test } from 'vitest';
import { constructionSetup, createEngine, dispatch, setEnginePhase, snapshot } from '../../packages/engine/src/index.js';
import type { Action } from '../../packages/contracts/src/index.js';

test('host-selected construction has real stdio parity and assessed mutations lose authority at tick five', async () => {
  const transport = new StdioClientTransport({ command: process.execPath, args: ['dist/packages/mcp/src/stdio.js', '--setup', '--construction'], stderr: 'pipe' });
  const client = new Client({ name: 'construction-parity', version: '1.0.0' }, { versionNegotiation: { mode: { pin: '2026-07-28' }, probe: { timeoutMs: 3000, maxRetries: 0 } } });
  try {
    await client.connect(transport, { timeout: 3000 });
    const engine = createEngine(constructionSetup());
    const actions: Action[] = [{ type: 'inspect', target: 'board' }, { type: 'set_clock', clock: 'shadow', enabled: true }, { type: 'set_gate_mode', mode: 'live' }, { type: 'set_epoch_guard', enabled: true }, { type: 'advance', ticks: 5 }, { type: 'set_clock', clock: 'shadow', enabled: false }];
    for (const [index, action] of actions.entries()) {
      const request = { schema_version: '1.0' as const, request_id: `parity.${index}`, expected_revision: snapshot(engine).revision, action };
      const expected = dispatch(engine, request, { actor_id: 'assessed-model', role: 'assessed_agent', phase: 'setup' });
      const result = await client.callTool({ name: 'board_action', arguments: request }, { timeout: 3000 });
      expect(result.structuredContent).toEqual(expected);
      if (snapshot(engine).tick >= 5) setEnginePhase(engine, 'recovery');
      if (index === actions.length - 1) expect(expected.error?.code).toBe('ACTOR_FORBIDDEN');
    }
    expect(snapshot(engine).queue[0]?.id).toBe('shadow.4.left');
  } finally { await client.close(); await transport.close(); }
});

test('construction is a host setup option and cannot alter ordinary recovery scenarios', () => {
  for (const args of [['--construction'], ['--setup', '--scenario', 'cached-gate', '--construction']]) {
    const result = spawnSync(process.execPath, ['dist/packages/mcp/src/stdio.js', ...args], { timeout: 5000, encoding: 'utf8' });
    expect(result.status).toBe(1); expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Construction requires the host stale-queue setup');
  }
});
