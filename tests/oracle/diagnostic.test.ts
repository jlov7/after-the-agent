import { expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync,writeFileSync } from 'node:fs';
import { candidate } from './candidate.js';
import { buildCorpus } from '../../packages/runner/src/continuations.js';
import { evaluateCandidate } from '../../packages/runner/src/evaluate.js';
import { createReproducer, validateReproducer } from '../../packages/runner/src/diagnostic.js';
const record=async()=>{const c=candidate('duplicate-clock',[{type:'set_clock',clock:'shadow',enabled:false}]);const corpus=buildCorpus(c);return {candidate:c,corpus,admitted_at_ms:10,evaluation:await evaluateCandidate(c,corpus)};};
it('retains duplicate inherited pulses and final drain in one canonical diagnostic, never repair qualification',async()=>{
 const source=await record(), value=createReproducer(source,'quiet-prefix');
 expect(value.observation.pulses.filter(p=>p.tick===6&&p.lamp==='left')).toHaveLength(2);
 expect(value.observation.observed_through_tick).toBe(71);
 expect(value.observation.pulses).toContainEqual({tick:70,lamp:'left'});
 expect(value.scope).toBe('one-case-diagnostic'); expect(value.expected_verdict).toBe('mismatch');
 expect(validateReproducer(value)).toEqual(value);
 expect(()=>createReproducer({...source,evaluation:null},'quiet-prefix')).toThrow(/observ/i);
});
it('rejects substituted case, altered observation, unknown fields and duplicate JSON keys',async()=>{
 const value=createReproducer(await record(),'quiet-prefix');
 expect(()=>validateReproducer({...value,case:{...value.case,enqueue_until_tick:70}})).toThrow();
 expect(()=>validateReproducer({...value,observation:{...value.observation,pulses:value.observation.pulses.slice(1)}})).toThrow(/observ/i);
 expect(()=>validateReproducer({...value,trusted:true})).toThrow();
 expect(()=>validateReproducer({...value,candidate:{...value.candidate,candidate_sha256:'b'.repeat(64)}})).toThrow();
});
it('executes the compiled CLI and independent oracle, classifies known mismatch reproduction as success',async()=>{
 mkdirSync('work/full-evidence',{recursive:true});const value=createReproducer(await record(),'quiet-prefix');
 const path='work/full-evidence/reproducer.json';writeFileSync(path,JSON.stringify(value));
 const output=JSON.parse(execFileSync(process.execPath,['dist/packages/runner/src/reproduce-cli.js',path],{encoding:'utf8',timeout:20000}));
 expect(output).toMatchObject({status:'reproduced',scope:'one-case-diagnostic',repair_qualified:false,oracle_exit_code:1});
 writeFileSync(path,JSON.stringify({...value,observation:{...value.observation,pulses:[]}}));
 expect(spawnSync(process.execPath,['dist/packages/runner/src/reproduce-cli.js',path],{encoding:'utf8'}).status).toBe(2);
 writeFileSync(path,'{"schema_version":"1.0","schema_version":"1.0"}');
 expect(spawnSync(process.execPath,['dist/packages/runner/src/reproduce-cli.js',path],{encoding:'utf8'}).status).toBe(2);
});
it('keeps zero-demand cases selectable and explicitly reports the preserved oracle liveness limit',async()=>{
 const c=candidate('cached-gate'),corpus=buildCorpus(c),evaluation=await evaluateCandidate(c,corpus);
 const value=createReproducer({candidate:c,corpus,admitted_at_ms:10,evaluation},'quiet-prefix');
 mkdirSync('work/full-evidence',{recursive:true});const path='work/full-evidence/no-liveness.json';writeFileSync(path,JSON.stringify(value));
 const result=spawnSync(process.execPath,['dist/packages/runner/src/reproduce-cli.js',path],{encoding:'utf8',timeout:20000});
 expect(result.status).toBe(0);expect(JSON.parse(result.stdout)).toMatchObject({status:'reproduced_engine_only',repair_qualified:false,oracle_exit_code:2,oracle_status:'unavailable_no_liveness',scope:'one-case-diagnostic'});
});
