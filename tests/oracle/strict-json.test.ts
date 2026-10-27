import { describe, expect, it } from 'vitest';
import { parseStrictJson } from '../../packages/runner/src/strict-json.js';
describe('strict raw evidence', () => {
  it.each(['{"a":1,"a":2}', '{"a":1.0}', '{"a":1e0}', '{"a":NaN}', '{"a":Infinity}', '{"__proto__":{}}', '{"constructor":1}', '['.repeat(66)+'0'+']'.repeat(66)])('rejects %s', raw => expect(() => parseStrictJson(raw)).toThrow());
  it('keeps escaped strings and nested integer evidence', () => {
    const value = {a:[1,-2,true,null,'"1.0']}; expect(parseStrictJson(JSON.stringify(value))).toEqual(value);
  });
  it('rejects duplicate escaped keys', () => expect(() => parseStrictJson('{"a":1,"\\u0061":2}')).toThrow());
});
