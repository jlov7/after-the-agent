import { it,expect } from 'vitest';
import { createHash } from 'node:crypto';
import { canonicalJson,sha256Json } from '../../packages/contracts/src/canonical.js';
it('sorts keys recursively, preserves array order and exact duplicate pulses, and hashes the encoded bytes',()=>{
  const value={z:[{tick:6,lamp:'left'},{tick:6,lamp:'left'}],a:{z:2,a:true}};
  const expected='{"a":{"a":true,"z":2},"z":[{"lamp":"left","tick":6},{"lamp":"left","tick":6}]}';
  expect(canonicalJson(value)).toBe(expected);
  expect(sha256Json(value)).toBe(createHash('sha256').update(expected).digest('hex'));
});
it('rejects unsupported JSON values rather than silently dropping or coercing them',()=>{
  for(const value of [{missing:undefined},{number:NaN},{number:1.5},{number:Infinity},new Date(),{big:1n}])expect(()=>canonicalJson(value)).toThrow();
  const circular:unknown[]=[];circular.push(circular);expect(()=>canonicalJson(circular)).toThrow();
});
it('matches Python ensure_ascii encoding for Unicode string data',()=>expect(canonicalJson({label:'é😀'})).toBe('{"label":"\\u00e9\\ud83d\\ude00"}'));
