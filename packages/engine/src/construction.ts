import { canonicalJson, type SetupSpec } from '../../contracts/src/index.js';
import { immutable } from './engine.js';
import { scenarioSetup } from './scenarios.js';

/** Host-authored initial settings for a substantive setup demonstration. */
export function constructionSetup(): SetupSpec {
  return immutable({ ...scenarioSetup('stale-queue'), config: { clocks: { primary: false, shadow: false }, gate_mode: 'cached', epoch_guard: false } });
}

export function isSupportedRecordingSetup(setup: SetupSpec): boolean {
  const value = canonicalJson(setup);
  return value === canonicalJson(scenarioSetup('stale-queue')) || value === canonicalJson(constructionSetup());
}
