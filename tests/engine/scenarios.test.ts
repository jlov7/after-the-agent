import { expect, test } from 'vitest';
import { createEngine, dispatch, engineEvents, snapshot } from '../../packages/engine/src/engine.js';
import { createScenario } from '../../packages/engine/src/scenarios.js';
test.each(['valid-pending', 'stale-queue', 'duplicate-clock', 'cached-gate'] as const)('%s setup replays to actual paused settled-five inherited state', family => {
  const scenario = createScenario(family), replayed = createEngine(scenario.setup);
  for (const record of scenario.commands) expect(dispatch(replayed, record.request, record.actor)).toEqual(record.result);
  expect(snapshot(replayed)).toEqual(snapshot(scenario.engine));
  expect(snapshot(scenario.engine).tick).toBe(5);
  expect(snapshot(scenario.engine).queue).toHaveLength(family === 'duplicate-clock' ? 2 : 1);
  expect(engineEvents(replayed)).toEqual(engineEvents(scenario.engine));
  expect(snapshot(scenario.engine).world.epoch).toBe(family === 'stale-queue' || family === 'cached-gate' ? 2 : 1);
});
