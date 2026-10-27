import { expect,it } from 'vitest';
import { cp,mkdir,mkdtemp,writeFile,readFile,rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve,join,dirname } from 'node:path';
import { fixtureCaptureConfig,type CaptureConfig } from '../../packages/runner/src/capture.js';
import { referenceDirectory } from '../../packages/runner/src/node.js';
const env={PATH:[dirname(process.execPath),process.env.PATH].filter(Boolean).join(':'),ATA_REFERENCE_DIR:referenceDirectory()};
const config:CaptureConfig={...fixtureCaptureConfig,mode:'live',model:'synthetic-requested-model',budget:{account:'synthetic-test',authorization:'Mocked provider unit test only. No actual spending authorization.',approved_micro_usd:10000,model:'synthetic-requested-model',input_micro_usd_per_million:1,output_micro_usd_per_million:1,request_overhead_tokens:1024,verified_at:new Date().toISOString(),source:'https://developers.openai.com/api/docs/pricing',receipt_sha256:'0'.repeat(64)}};
interface Receipt{status:string;genuine_model_observed:boolean;attempted_provider_requests:number;observed_provider_responses:number}
async function mockCapture(kind:string,output:unknown[],omitModel=false){
  await mkdir('work/recordings',{recursive:true});const directory=await mkdtemp('work/recordings/mock-provider-'),implementation=join(directory,'implementation'),capture=resolve(directory,'capture');
  await mkdir(implementation);await cp('dist',join(implementation,'dist'),{recursive:true});
  await writeFile(join(implementation,'input.json'),JSON.stringify({kind,output,omitModel,config}));
  await writeFile(join(implementation,'harness.mjs'),`import { readFile } from 'node:fs/promises';
import { runCapture } from './dist/packages/runner/src/capture.js';
const fixture=JSON.parse(await readFile(new URL('./input.json',import.meta.url),'utf8'));let attempts=0;
globalThis.fetch=async url=>{if(url!=='https://api.openai.com/v1/responses')throw new Error('Unexpected request');attempts++;if(fixture.kind==='network')throw new TypeError('Synthetic network failure');if(fixture.kind==='http401')return new Response('{}',{status:401});return new Response(JSON.stringify({id:'synthetic.response',...(fixture.omitModel?{}:{model:'synthetic-returned-model'}),output:fixture.output}),{status:200});};
const result=await runCapture(fixture.config,{outputDir:process.argv[2],apiKey:'synthetic-test-credential'});
process.stdout.write(JSON.stringify({status:result.status,attempts}));`);
  for(const args of [['init','--quiet'],['add','-f','dist','harness.mjs','input.json'],['-c','user.name=Capture test','-c','user.email=synthetic@example.invalid','-c','core.hooksPath=/dev/null','commit','--quiet','--no-gpg-sign','-m','mocked provider fixture']])expect(spawnSync('git',args,{cwd:implementation,env,encoding:'utf8'}).status).toBe(0);
  const processResult=spawnSync(process.execPath,['harness.mjs',capture],{cwd:implementation,env,encoding:'utf8',timeout:20000});expect(processResult.status,processResult.stderr).toBe(0);
  const receipt=JSON.parse(await readFile(join(capture,'status.json'),'utf8')) as Receipt;
  const recording=JSON.parse(await readFile(join(capture,'recording.json'),'utf8')) as {manifest:{returned_model:string|null;unavailable_reason:string|null;model_requests:number;token_usage:unknown;cost_usd:unknown;completion:string}};
  const raw=await readFile(join(capture,'exchanges.ndjson'),'utf8');const journal=raw.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line) as Record<string,unknown>);
  await writeFile('evidence/recording-provider-'+kind+'.json',JSON.stringify({category:'fixture',provider_mode:'mocked',actual_model_observed:false,actual_paid_requests:0,actual_mcp_transport:true,software_receipt:receipt,manifest_metadata:recording.manifest},null,2)+'\n');
  await writeFile('evidence/recording-provider-'+kind+'.ndjson',raw);await rm(implementation,{recursive:true});return {receipt,recording,journal,raw};
}
const nonCalls=[{type:'reasoning',encrypted_content:'opaque-fixture-state',summary:[]},{type:'message',content:[{type:'output_text',text:'noncall-fixture-text'}]}];
it.each(['unknown-name','missing-arguments','oversized-arguments'] as const)('preserves bounded raw %s native calls before rejecting them, with no hidden reasoning logged',async kind=>{
  const item:Record<string,unknown>={type:'function_call',name:kind==='unknown-name'?'unexpected':'board_action',call_id:'synthetic.call',...(kind==='missing-arguments'?{}:{arguments:kind==='oversized-arguments'?'x'.repeat(70000):'{}'}),status:'completed'};
  const later={type:'function_call',name:'board_action',call_id:'later.call',arguments:'{}'};
  const result=await mockCapture(kind,[...nonCalls,item,later]);expect(result.receipt.status).toBe('failed');expect(result.recording.manifest.completion).toBe('failed');
  const received=result.journal.filter(entry=>entry.stage==='native_received');expect(received.map(entry=>entry.raw_call)).toEqual([item,later]);
  const rejected=result.journal.find(entry=>entry.stage==='native_rejected');expect(rejected?.raw_call).toEqual(item);expect(rejected?.reason).toEqual(expect.any(String));expect(rejected).not.toHaveProperty('result');
  expect(result.raw).not.toContain('opaque-fixture-state');expect(result.raw).not.toContain('noncall-fixture-text');
});
it.each(['http401','network'] as const)('does not claim model observation when %s attempts produce no validated response',async kind=>{
  const result=await mockCapture(kind,[]);expect(result.receipt.status).toBe('failed');expect(result.receipt.genuine_model_observed).toBe(false);expect(result.receipt.observed_provider_responses).toBe(0);expect(result.receipt.attempted_provider_requests).toBe(kind==='network'?3:1);
  expect(result.recording.manifest.returned_model).toBeNull();expect(result.recording.manifest.unavailable_reason).toContain('No validated provider response');expect(result.recording.manifest.token_usage).toBeNull();expect(result.recording.manifest.cost_usd).toBeNull();
});
it('records a validated response without returned-model metadata as unknown with an explicit reason',async()=>{
  const result=await mockCapture('missing-model',[...nonCalls],true);expect(result.receipt.observed_provider_responses).toBe(1);expect(result.receipt.attempted_provider_requests).toBe(1);expect(result.recording.manifest.returned_model).toBeNull();expect(result.recording.manifest.unavailable_reason).toContain('did not expose');expect(result.receipt.status).toBe('failed');
});
