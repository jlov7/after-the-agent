import { expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import goldens from '../../fixtures/golden.json' with { type: 'json' };
import type { Case, Observation } from '../../packages/contracts/src/index.js';
import { sha256Json } from '../../packages/contracts/src/index.js';
import { createEngine, defaultTask, dispatch, snapshot, setEnginePhase, setInputHorizon, engineEvents } from '../../packages/engine/src/engine.js';
import { evaluateCandidate as browser } from '../../packages/runner/src/evaluate-browser.js';
import { evaluateCandidate as node, runReference } from '../../packages/runner/src/evaluate.js';
import { observeCandidate } from '../../packages/runner/src/evaluation-core.js';
import { buildCorpus } from '../../packages/runner/src/continuations.js';
import { caseDigest } from '../../packages/runner/src/reference-port.js';
import { candidate } from './candidate.js';
import { pythonBatch, manifestSha } from './python.js';
it('executes real engine output for every independent hand-worked golden through its final drain', () => {
  const records=goldens.vectors.map(v=>{
    const c=v.case as Case, engine=createEngine({task:defaultTask('valid-pending'),world:{initial_world:c.initial_world,transitions:c.transitions},config:{clocks:{primary:true,shadow:false},gate_mode:'live',epoch_guard:true}});
    setEnginePhase(engine,'recovery');setInputHorizon(engine,c.enqueue_until_tick);
    while(snapshot(engine).tick<c.enqueue_until_tick+2){const plant=snapshot(engine);expect(dispatch(engine,{schema_version:'1.0',request_id:`step.${plant.tick}`,expected_revision:plant.revision,action:{type:'advance',ticks:Math.min(64,c.enqueue_until_tick+2-plant.tick)}},{actor_id:'test',role:'controller',phase:'recovery'}).outcome).toBe('accepted');}
    const pulses=engineEvents(engine).filter(e=>e.type==='pulse'&&e.tick>c.handover_tick).map(e=>({tick:e.tick,lamp:(e as {lamp:'left'|'right'|'center'}).lamp}));
    const observation:Observation={schema_version:'1.0',case_id:c.case_id,case_sha256:caseDigest(c),candidate_sha256:'a'.repeat(64),status:'complete',terminal_reason:'submitted',handover_tick:c.handover_tick,observed_through_tick:snapshot(engine).tick,budget_exhausted:false,reset_during_attempt:false,pulses};
    expect(pulses.slice().sort((a,b)=>a.tick-b.tick||a.lamp.localeCompare(b.lamp))).toEqual(v.expected_pulses.slice().sort((a,b)=>a.tick-b.tick||a.lamp.localeCompare(b.lamp)));
    return {case:c,observation};
  });
  const verdicts=pythonBatch(records.map(r=>({op:'case',...r})));
  verdicts.forEach(v=>expect(v.status==='ok'&&v.result.passed).toBe(true));
  writeFileSync('evidence/oracle-engine-goldens.json',JSON.stringify({status:'pass',reference_manifest_sha256:manifestSha,records,verdicts},null,2)+'\n');
});
it('forks one candidate with its inherited queue for all twelve policy cases and preserves Python classifications',async()=>{
  const valid=candidate(),corpus=buildCorpus(valid),before=sha256Json(valid);
  const passing=await browser(valid,corpus),independent=await node(valid,corpus);
  expect(passing.status).toBe('pass');expect(passing.cases).toHaveLength(12);expect(passing.observations[0]!.pulses[0]).toEqual({tick:6,lamp:'left'});expect(independent).toEqual(passing);expect(sha256Json(valid)).toBe(before);
  const broken=candidate('valid-pending',[{type:'drop_jobs',job_ids:['primary.4.left']}]),bad=await node(broken,buildCorpus(broken));
  expect(bad.status).toBe('mismatch');expect(bad.cases[0]!.missing).toContainEqual({tick:6,lamp:'left'});
  expect(runReference(corpus.cases,passing.observations.slice(0,-1)).exit_code).toBe(2);
  writeFileSync('evidence/oracle-candidates.json',JSON.stringify({status:'pass',reference_manifest_sha256:manifestSha,candidate:valid,corpus,result:passing,python:independent,clear_all:{candidate:broken,result:bad}},null,2)+'\n');
});
it('rejects changed history, task, hash, reset and any substituted or omitted continuation',async()=>{
  const valid=candidate(),corpus=buildCorpus(valid);
  const invalids=[{...valid,attempt_id:'bad\n'},{...valid,candidate_sha256:'0'.repeat(64)},{...valid,world_prefix:{...valid.world_prefix,initial_world:{scene_id:'other',active:true}}},{...valid,task:{...valid.task,delay:1}},{...valid,reset_during_attempt:true},{...valid,capture_tick:6}];
  for(const invalid of invalids)expect((await browser(invalid as typeof valid,corpus)).status).toBe('invalid');
  for(const broken of [{...corpus,cases:corpus.cases.slice(0,-1)},{...corpus,cases:[...corpus.cases.slice(0,-1),corpus.cases[0]!]},{...corpus,candidate_sha256:'b'.repeat(64)}])expect((await browser(valid,broken)).status).toBe('invalid');
});
it('uses the submitted settled cut after stepping, and includes a complete drain at the global boundary',async()=>{
  const stepped=candidate('valid-pending',[{type:'advance',ticks:4}]);expect(stepped.capture_tick).toBe(9);expect((await browser(stepped,buildCorpus(stepped))).status).toBe('pass');
  const actions=Array.from({length:62},()=>({type:'advance' as const,ticks:64}));actions.push({type:'advance',ticks:57});
  const edge=candidate('valid-pending',actions);expect(edge.capture_tick).toBe(4030);const corpus=buildCorpus(edge),observations=observeCandidate(edge,corpus);expect(observations.every(o=>o.observed_through_tick===4096)).toBe(true);expect(runReference(corpus.cases,observations).exit_code).toBe(0);
  const exhausted=candidate('valid-pending',[...actions,{type:'advance',ticks:1}]);expect((await browser(exhausted,corpus)).status).toBe('budget_limit');
});
