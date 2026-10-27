import { createEngine, dispatch, engineEvents, snapshot, setEnginePhase } from '../../engine/src/engine.js';
import type { HeadlessInput, HeadlessResult } from '../../contracts/src/index.js';
export function headless(input: HeadlessInput): HeadlessResult {
  const engine = createEngine(input.setup);
  setEnginePhase(engine, input.actor.phase);
  const results = input.actions.map(request => dispatch(engine, request, input.actor));
  return {plant:snapshot(engine),events:engineEvents(engine),results};
}
export const runHeadless = headless;
