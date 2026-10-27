import { expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Action, FrozenCandidate, ScenarioFamily } from '../../packages/contracts/src/index.js';
import { sha256Text } from '../../packages/contracts/src/index.js';
import { evaluateCandidate } from '../../packages/runner/src/evaluate-browser.js';
import { buildCorpus } from '../../packages/runner/src/continuations.js';
import { candidate } from '../oracle/candidate.js';
interface Receipt { id: string; category: 'behavioral'|'source'; detector: string; status: 'killed'|'accepted'|'survived'|'error'; observed_status?: string; detail?: unknown; source?: {path:string;original_sha256:string;mutated_sha256:string} }
it('kills named behavioral and real source mutants and accepts the standby alternative',async()=>{
  const receipts: Receipt[]=[];
  const persist=()=>writeFileSync('evidence/mutants.json',JSON.stringify({schema_version:'1.0',status:receipts.length===12&&receipts.every(r=>r.status==='killed'||r.status==='accepted')?'pass':'partial',kind:'behavioral_challenges_and_source_mutations',mutants:receipts},null,2)+'\n');
  const behaviors:{id:string;family:ScenarioFamily;actions:Action[];detector:string;positive?:boolean}[]=[
    {id:'clear-all',family:'valid-pending',actions:[{type:'drop_jobs',job_ids:['primary.4.left']}],detector:'quiet-prefix retains the owed tick6 job'},
    {id:'no-clock',family:'valid-pending',actions:[{type:'set_clock',clock:'primary',enabled:false}],detector:'future nominal demand is independent of enabled clocks'},
    {id:'both-clocks',family:'duplicate-clock',actions:[],detector:'exact pulse multiplicity rejects inherited and future duplicates'},
    {id:'ignore-epoch',family:'stale-queue',actions:[],detector:'delivery guard suppresses inherited and future stale work'},
    {id:'one-time-cache',family:'cached-gate',actions:[{type:'refresh_gate'}],detector:'later active transitions require live gate behavior'},
    {id:'valid-standby',family:'valid-pending',actions:[{type:'set_clock',clock:'primary',enabled:false},{type:'set_clock',clock:'shadow',enabled:true}],detector:'behaviorally equivalent standby source and preserved pending work',positive:true},
  ];
  for(const behavior of behaviors){const value=candidate(behavior.family,behavior.actions),result=await evaluateCandidate(value,buildCorpus(value));receipts.push({id:behavior.id,category:'behavioral',detector:behavior.detector,status:result.status===(behavior.positive?'pass':'mismatch')?(behavior.positive?'accepted':'killed'):'survived',observed_status:result.status,detail:{candidate:value,result}});persist();expect(result.status,behavior.id).toBe(behavior.positive?'pass':'mismatch');}
  const forged={...candidate(),score:'pass'} as FrozenCandidate,forgedCorpus=buildCorpus(candidate()),forgedResult=await evaluateCandidate(forged,forgedCorpus);
  receipts.push({id:'forged-score',category:'behavioral',detector:'candidate exact envelope rejects caller-supplied score',status:forgedResult.status==='invalid'?'killed':'survived',observed_status:forgedResult.status,detail:forgedResult});persist();expect(forgedResult.status).toBe('invalid');
  const sourceMutants=[
    {id:'missing-center',path:'packages/engine/src/engine.ts',from:"if (ordinal % 4 === 0) lamps.push('center');",to:'',detector:'valid candidate must emit every fourth center pulse',expected:'pass',value:candidate()},
    {id:'wrong-delay',path:'packages/engine/src/engine.ts',from:'due_tick: plant.tick + 2',to:'due_tick: plant.tick + 1',detector:'valid candidate must deliver at nominal enqueue plus two',expected:'pass',value:candidate()},
    {id:'final-picture',path:'packages/runner/src/reference-port.ts',from:'[[expected, 1], [o.pulses, -1]]',to:'[[expected.filter(p => p.tick === expected.at(-1)?.tick), 1], [o.pulses.filter(p => p.tick === o.pulses.at(-1)?.tick), -1]]',detector:'early missing pending pulse fails despite correct final output',expected:'mismatch',value:candidate('valid-pending',[{type:'drop_jobs',job_ids:['primary.4.left']}])},
    {id:'skip-final-case',path:'packages/runner/src/evaluation-core.ts',from:'return corpus.cases.map(c => {',to:'return corpus.cases.slice(0,-1).map(c => {',detector:'all twelve cases must finish before a valid candidate passes',expected:'pass',value:candidate()},
    {id:'clean-reset',path:'packages/runner/src/evaluation-core.ts',from:'cloneEngine(candidate.plant,',to:'cloneEngine({ ...candidate.plant, queue: [] },',detector:'evaluation clone must preserve valid pending dynamic state',expected:'pass',value:candidate()},
  ];
  mkdirSync('work/mutants',{recursive:true});
  for(const mutation of sourceMutants){
    const scratch=mkdtempSync(resolve('work/mutants',`${mutation.id}-`));let receipt:Receipt;
    try{
      for(const folder of ['packages','contracts','fixtures'])cpSync(resolve(folder),join(scratch,folder),{recursive:true});
      symlinkSync(resolve('node_modules'),join(scratch,'node_modules'),'dir');
      const path=join(scratch,mutation.path),original=readFileSync(path,'utf8');
      if(original.split(mutation.from).length!==2)throw new Error('Mutation site must occur exactly once');
      const changed=original.replace(mutation.from,mutation.to);writeFileSync(path,changed);
      writeFileSync(join(scratch,'input.json'),JSON.stringify({candidate:mutation.value,corpus:buildCorpus(mutation.value)}));
      writeFileSync(join(scratch,'package.json'),'{"type":"module"}');
      writeFileSync(join(scratch,'probe.ts'),`import assert from 'node:assert/strict';\nimport {readFileSync} from 'node:fs';\nimport {evaluateCandidate} from './packages/runner/src/evaluate-browser.ts';\nconst input=JSON.parse(readFileSync(new URL('./input.json',import.meta.url),'utf8'));\nconst result=await evaluateCandidate(input.candidate,input.corpus);\ntry { assert.equal(result.status,${JSON.stringify(mutation.expected)},${JSON.stringify(mutation.detector)}); process.stdout.write(JSON.stringify({status:'survived',observed_status:result.status})); }\ncatch(error) { if(error.code!=='ERR_ASSERTION') throw error; process.stdout.write(JSON.stringify({status:'killed',observed_status:result.status,assertion:error.message,result})); }\n`);
      const output=execFileSync(process.execPath,['--import','tsx',join(scratch,'probe.ts')],{cwd:scratch,encoding:'utf8',timeout:15000,maxBuffer:8*1024*1024});
      const probe=JSON.parse(output) as {status:'killed'|'survived';observed_status:string};
      receipt={id:mutation.id,category:'source',detector:mutation.detector,status:probe.status,observed_status:probe.observed_status,detail:JSON.parse(output),source:{path:mutation.path,original_sha256:sha256Text(original),mutated_sha256:sha256Text(changed)}};
    }catch(error){receipt={id:mutation.id,category:'source',detector:mutation.detector,status:'error',detail:error instanceof Error?error.message:String(error)};}
    receipts.push(receipt);persist();rmSync(scratch,{recursive:true,force:true});expect(receipt.status,`${mutation.id}: ${JSON.stringify(receipt.detail)}`).toBe('killed');
  }
  expect(receipts).toHaveLength(12);persist();
},30000);
