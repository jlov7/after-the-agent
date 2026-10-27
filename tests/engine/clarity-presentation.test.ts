import { expect, test } from 'vitest';
import { createEngine, dispatch, scenarioSetup, snapshot } from '../../packages/engine/src/index.js';
import { createEditReceipt } from '../../packages/runner/src/edit-receipt.js';
import { describeEditChange } from '../../apps/web/src/components/EditReceipt.js';
import type { Action } from '../../packages/contracts/src/index.js';
import { recordingModelLabel } from '../../apps/web/src/session/labels.js';

test('unavailable returned identity is distinct from the requested model in visible recording details', () => {
  expect(recordingModelLabel('Unknown (requested: gpt-6.1-sol)')).toBe('Requested model: gpt-6.1-sol. The provider did not return a model ID.');
  expect(recordingModelLabel('provider-model')).toBe('Reported model: provider-model');
  expect(recordingModelLabel(null)).toBe('Model identity unavailable.');
});

test('actual configuration receipts describe false values as off and distinguish live from cached', () => {
  const engine = createEngine(scenarioSetup('stale-queue'));
  const cases: [Action, string][] = [
    [{ type: 'set_epoch_guard', enabled: false }, 'Delivery guard: On to Off'],
    [{ type: 'set_clock', clock: 'primary', enabled: false }, 'Primary clock: On to Off'],
    [{ type: 'set_clock', clock: 'shadow', enabled: true }, 'Standby clock: Off to On'],
    [{ type: 'set_gate_mode', mode: 'cached' }, 'Gate source: Live to Cached'],
  ];
  for (const [index, [action, expected]] of cases.entries()) {
    const before = snapshot(engine);
    const result = dispatch(engine, { schema_version: '1.0', request_id: `copy.${index}`, expected_revision: before.revision, action }, { actor_id: 'fixture', role: 'assessed_agent', phase: 'setup' });
    const receipt = createEditReceipt(before, result);
    expect(receipt.status).toBe('applied');
    expect(receipt.changes.map(describeEditChange)).toEqual([expected]);
    expect(receipt.tick_after).toBe(0);
  }
});

test('refresh receipt distinguishes stored scene activity from the scene version', () => {
  const engine = createEngine(scenarioSetup('cached-gate'));
  dispatch(engine, { schema_version: '1.0', request_id: 'advance', expected_revision: 0, action: { type: 'advance', ticks: 5 } }, { actor_id: 'fixture', role: 'controller', phase: 'setup' });
  const before = snapshot(engine);
  const result = dispatch(engine, { schema_version: '1.0', request_id: 'refresh', expected_revision: before.revision, action: { type: 'refresh_gate' } }, { actor_id: 'fixture', role: 'controller', phase: 'setup' });
  expect(createEditReceipt(before, result).changes.map(describeEditChange)).toEqual([
    'Cached scene activity: Active to Inactive', 'Cached scene version: 1 to 2',
  ]);
});
