import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { sha256Json, type Action, type FrozenCandidate } from '../../packages/contracts/src/index.js';
import { constructionSetup, createEngine, dispatch, scenarioSetup, snapshot } from '../../packages/engine/src/index.js';
import { buildCorpus } from '../../packages/runner/src/continuations.js';
import { evaluateCandidate } from '../../packages/runner/src/evaluate.js';

test('independent reference requires every construction setting and accepts either single clock without changing task truth', async () => {
  const setup = constructionSetup();
  expect(setup.task).toEqual(scenarioSetup('stale-queue').task);
  expect(setup.world).toEqual(scenarioSetup('stale-queue').world);
  const receipts = [];
  for (const variant of ['complete-primary', 'complete-shadow', 'unchanged', 'no-clock', 'cached-gate', 'no-guard']) {
    const engine = createEngine(setup), actions: Action[] = [];
    if (!['unchanged', 'no-clock'].includes(variant)) actions.push({ type: 'set_clock', clock: variant === 'complete-shadow' ? 'shadow' : 'primary', enabled: true });
    if (!['unchanged', 'cached-gate'].includes(variant)) actions.push({ type: 'set_gate_mode', mode: 'live' });
    if (!['unchanged', 'no-guard'].includes(variant)) actions.push({ type: 'set_epoch_guard', enabled: true });
    actions.push({ type: 'advance', ticks: 5 });
    for (const [index, action] of actions.entries()) {
      const result = dispatch(engine, { schema_version: '1.0', request_id: `construction.${index}`, expected_revision: snapshot(engine).revision, action }, { actor_id: 'fixture', role: 'assessed_agent', phase: 'setup' });
      expect(result.outcome).toBe('accepted'); expect(result.no_op).toBe(false);
    }
    const plant = snapshot(engine);
    const candidate: FrozenCandidate = { schema_version: '1.0', plant, world_prefix: setup.world, task: setup.task, candidate_sha256: sha256Json(plant), attempt_id: variant, capture_tick: 5, original_handover_tick: 5, terminal_reason: 'submitted', reset_during_attempt: false };
    const corpus = buildCorpus(candidate), result = await evaluateCandidate(candidate, corpus);
    expect(result.status).toBe(variant.startsWith('complete') ? 'pass' : 'mismatch');
    expect(result.cases).toHaveLength(12);
    if (variant.startsWith('complete')) expect(plant.queue).toEqual([{ id: `${variant.endsWith('shadow') ? 'shadow' : 'primary'}.4.left`, clock: variant.endsWith('shadow') ? 'shadow' : 'primary', enqueue_tick: 4, due_tick: 6, lamp: 'left', enqueue_epoch: 1 }]);
    receipts.push({ variant, initial_config: setup.config, actions, candidate, result });
  }
  mkdirSync('evidence/clarity', { recursive: true });
  writeFileSync('evidence/clarity/construction-oracle.json', JSON.stringify({ category: 'fixture', actual_model_calls: 0, receipts }, null, 2) + '\n');
});
