import { describe, expect, it } from 'vitest';
import { parseRecordingJson, parseStrictJson } from '../../packages/runner/src/strict-json.js';

describe('recording cost numbers preserve canonical action lexemes', () => {
  it('accepts an actual fractional USD cost without enabling fractional action values', () => {
    expect(parseRecordingJson('{"manifest":{"cost_usd":0.01},"commands":[]}')).toEqual({ manifest: { cost_usd: 0.01 }, commands: [] });
    expect(() => parseStrictJson('{"manifest":{"cost_usd":0.01}}')).toThrow();
  });
  it('allows finite cost spelling but rejects fractional or exponential integer fields', () => {
    expect(parseRecordingJson('{"manifest":{"cost_usd":1e-2}}')).toEqual({ manifest: { cost_usd: 0.01 } });
    for (const raw of ['{"manifest":{"elapsed_ms":1.0}}', '{"commands":[{"request":{"action":{"ticks":1e0}}}]}', '{"commands":[{"manifest":{"cost_usd":0.01}}]}']) expect(() => parseRecordingJson(raw)).toThrow();
  });
  it('rejects nonfinite cost, duplicate keys and dangerous prototype names', () => {
    for (const raw of ['{"manifest":{"cost_usd":1e999}}', '{"manifest":{"cost_usd":0.01,"cost_usd":0.02}}', '{"manifest":{"__proto__":{}}}', '{"manifest":{"cost_usd":Infinity}}']) expect(() => parseRecordingJson(raw)).toThrow();
  });
});
