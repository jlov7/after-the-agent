import { expect, it } from 'vitest';
import fc from 'fast-check';
import { writeFileSync } from 'node:fs';
import goldens from '../../fixtures/golden.json' with { type: 'json' };
import patterns from '../../fixtures/continuations.json' with { type: 'json' };
import type { Case, Observation } from '../../packages/contracts/src/index.js';
import { expectedPulses, caseDigest, evaluateCase, evaluateSuite } from '../../packages/runner/src/reference-port.js';
import { parseStrictJson } from '../../packages/runner/src/strict-json.js';
import { pythonBatch, manifestSha } from './python.js';
const seed = 731921;
const observation = (c: Case): Observation => ({schema_version:'1.0',case_id:c.case_id,case_sha256:caseDigest(c),candidate_sha256:'a'.repeat(64),status:'complete',terminal_reason:'submitted',handover_tick:c.handover_tick,observed_through_tick:c.enqueue_until_tick+2,budget_exhausted:false,reset_during_attempt:false,pulses:expectedPulses(c)});
it('matches the external Python oracle on every independent golden, pattern and seeded history', () => {
  const generated = fc.sample(fc.record({cut:fc.integer({min:0,max:50}),active:fc.boolean(),changes:fc.uniqueArray(fc.record({tick:fc.integer({min:1,max:114}),active:fc.boolean(),scene:fc.integer({min:0,max:3})}),{selector:x=>x.tick,maxLength:14})}),{seed,numRuns:40}).map((value,index):Case=>({schema_version:'1.0',case_id:`seed-${index}`,handover_tick:value.cut,enqueue_until_tick:114,initial_world:{scene_id:'blue',active:value.active},transitions:value.changes.sort((a,b)=>a.tick-b.tick).map(t=>({tick:t.tick,active:t.active,scene_id:`scene${t.scene}`}))}));
  const cases = [...goldens.vectors.map(v=>v.case),...patterns,...generated] as Case[];
  const requests = cases.flatMap(c=>[{op:'expected',case:c},{op:'case',case:c,observation:observation(c)},{op:'case',case:c,observation:{...observation(c),pulses:[...observation(c).pulses,{tick:c.handover_tick+1,lamp:'left'},{tick:c.handover_tick+1,lamp:'left'}]}}]);
  const results = pythonBatch(requests);
  cases.forEach((c,index)=>{
    expect(results[index*3]).toEqual({status:'ok',result:{pulses:expectedPulses(c),digest:caseDigest(c)}});
    expect(results[index*3+1]).toEqual({status:'ok',result:evaluateCase(c,observation(c))});
    expect(results[index*3+2]).toEqual({status:'ok',result:evaluateCase(c,requests[index*3+2]!.observation)});
  });
  goldens.vectors.forEach(v=>expect(expectedPulses(v.case)).toEqual(v.expected_pulses));
  writeFileSync('evidence/oracle-conformance.json',JSON.stringify({status:'pass',reference_manifest_sha256:manifestSha,seed,golden_count:goldens.vectors.length,pattern_count:patterns.length,generated_count:generated.length,cases,comparisons:results},null,2)+'\n');
});
it('matches suite classifications for complete, mismatching and invalid evidence', () => {
  const cases = patterns as Case[], observations = cases.map(observation);
  const vectors: {id:string;cases:unknown[];observations:unknown[]}[] = [
    {id:'complete',cases,observations},
    {id:'missing-pulse',cases,observations:observations.map((o,i)=>i?o:{...o,pulses:o.pulses.slice(1)})},
    {id:'missing-last-case',cases,observations:observations.slice(0,-1)},
    {id:'duplicate-case',cases:[...cases.slice(0,-1),cases[0]],observations},
    {id:'duplicate-observation',cases,observations:[...observations.slice(0,-1),observations[0]]},
    {id:'wrong-prefix',cases:cases.map((c,i)=>i?c:{...c,initial_world:{scene_id:'amber',active:true}}),observations},
    {id:'mixed-candidate',cases,observations:observations.map((o,i)=>i?o:{...o,candidate_sha256:'b'.repeat(64)})},
    ...['case_sha256','handover_tick','observed_through_tick','status','terminal_reason','reset_during_attempt','budget_exhausted'].map(key=>({id:key,cases,observations:observations.map((o,i)=>i?o:{...o,[key]:({case_sha256:'b'.repeat(64),handover_tick:4,observed_through_tick:69,status:'error',terminal_reason:'abandoned_reset',reset_during_attempt:true,budget_exhausted:true} as Record<string,unknown>)[key]})})),
    {id:'pulse-outside-cut',cases,observations:observations.map((o,i)=>i?o:{...o,pulses:[{tick:5,lamp:'left'}]})},
    {id:'no-liveness',cases:[{...cases[0],initial_world:{scene_id:'blue',active:false}}],observations:[]},
    {id:'unknown-score',cases,observations:observations.map((o,i)=>i?o:{...o,score:100})},
  ];
  const last = vectors.find(v=>v.id==='no-liveness')!; last.observations=[observation(last.cases[0] as Case)];
  const answers=pythonBatch(vectors.map(v=>({op:'suite',...v})));
  vectors.forEach((v,i)=>{
    let result:unknown; try {result={status:'ok',result:evaluateSuite(v.cases,v.observations)};} catch {result={status:'invalid'};}
    expect(result,v.id).toEqual(answers[i]);
  });
  writeFileSync('evidence/oracle-invalid.json',JSON.stringify({status:'pass',reference_manifest_sha256:manifestSha,vectors,answers},null,2)+'\n');
});
it('matches lexical float, nonfinite and duplicate-key rejection before parsing loses evidence', () => {
  const raws = ['{"a":1.0}','{"a":1e0}','{"a":NaN}','{"a":Infinity}','{"a":1,"a":2}','{"a":1,"\\u0061":2}','{"a":[1,-2,true]}'];
  const results=pythonBatch(raws.map(raw=>({op:'raw',raw})));
  raws.forEach((raw,i)=>{let result:unknown;try{result={status:'ok',result:parseStrictJson(raw)};}catch{result={status:'invalid'};}expect(result).toEqual(results[i]);});
});
