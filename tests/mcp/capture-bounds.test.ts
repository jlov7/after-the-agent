import { readFile,mkdir,mkdtemp,cp,writeFile,readdir } from 'node:fs/promises';
import { it,expect,vi } from 'vitest';
import { fixtureCaptureConfig,runCapture,validateCaptureConfig,buildResponsesRequest,CaptureBudget,type CaptureConfig,capturePreflight } from '../../packages/runner/src/capture.js';
import { boardSchema } from '../../packages/contracts/src/index.js';
it('fixture capture never invokes provider fetch and retains explicit fixture provenance',async()=>{
  const request=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('No provider access permitted'));
  try{const result=await retainedCapture(fixtureCaptureConfig,{outputDir:'evidence/recording-no-provider'});expect(result.status).toBe('passed');expect(result.recording.manifest.provider).toBeNull();expect(request).not.toHaveBeenCalled();}finally{request.mockRestore();}
});
it('cancellation and finite turn budget produce incomplete non-success recordings with clean disconnect',async()=>{
  const controller=new AbortController();controller.abort();const cancelled=await retainedCapture(fixtureCaptureConfig,{outputDir:'evidence/recording-cancelled',signal:controller.signal});expect(cancelled.status).toBe('failed');expect(cancelled.recording.manifest.completion).toBe('cancelled');expect(cancelled.recording.manifest.replay_status).toBe('failed');
  const limited=await retainedCapture({...fixtureCaptureConfig,limits:{...fixtureCaptureConfig.limits,max_turns:1}},{outputDir:'evidence/recording-budget-stop'});expect(limited.status).toBe('failed');expect(limited.recording.manifest.completion).toBe('budget_stop');expect(limited.recording.final_plant.tick).toBe(0);
  for(const output of ['recording-cancelled','recording-budget-stop']){const verification=JSON.parse(await readFile('evidence/'+output+'/behavioral-verification.json','utf8')) as {status:string;result:unknown};expect(verification.status).toBe('not_run');expect(verification.result).toBeNull();}
});
it('requires explicit model/account/current pricing and reserves every request conservatively before possible spending',async()=>{
  expect(()=>validateCaptureConfig({...fixtureCaptureConfig,mode:'live'})).toThrow();
  const config:CaptureConfig={...fixtureCaptureConfig,mode:'live',model:'synthetic-pinned-model',budget:{account:'synthetic-test',authorization:'Synthetic unit test, no spending authorization',approved_micro_usd:10,model:'synthetic-pinned-model',input_micro_usd_per_million:1000000,output_micro_usd_per_million:1000000,request_overhead_tokens:1024,verified_at:new Date().toISOString(),source:'https://developers.openai.com/api/docs/pricing',receipt_sha256:'0'.repeat(64)}};
  expect(validateCaptureConfig(config)).toEqual(config);expect(()=>new CaptureBudget(config).reserve(100)).toThrow('budget_stop');
  expect(()=>validateCaptureConfig({...config,budget:{...config.budget,verified_at:'2000-01-01T00:00:00Z'}})).toThrow();
  await expect(runCapture(config,{outputDir:'evidence/recording-forbidden-driver',fixtureActions:[]})).rejects.toThrow('Fixture driver is forbidden');
  const payload=buildResponsesRequest(config,[{role:'user',content:'Only native board tool.'}]);expect(payload).toMatchObject({model:'synthetic-pinned-model',store:false,parallel_tool_calls:false,tools:[{type:'function',name:'board_action',strict:false,parameters:boardSchema}]});
});

async function retainedCapture(config:unknown,options:Parameters<typeof runCapture>[1]){
  await mkdir('work/recordings',{recursive:true});const directory=await mkdtemp('work/recordings/capture-test-');
  const result=await runCapture(config,{...options,outputDir:directory});await cp(directory,options.outputDir,{recursive:true});return result;
}

it('API refuses nonempty output before overwriting any retained recording',async()=>{
  await mkdir('work/recordings',{recursive:true});const output=await mkdtemp('work/recordings/api-custody-');
  await writeFile(output+'/recording.json','retained failure');
  await expect(runCapture(fixtureCaptureConfig,{outputDir:output})).rejects.toThrow('Output directory must be fresh or empty');
  expect(await readFile(output+'/recording.json','utf8')).toBe('retained failure');expect(await readdir(output)).toEqual(['recording.json']);
});

it('recorder rejects a changed implementation commitment after preflight before writes',async()=>{
  await mkdir('work/recordings',{recursive:true});const output=await mkdtemp('work/recordings/preflight-test-');const preflight=await capturePreflight('fixture',output);
  await expect(runCapture(fixtureCaptureConfig,{outputDir:output,preflight:{...preflight,application_commit:'0'.repeat(40)}})).rejects.toThrow('Capture implementation changed after preflight');
  expect(await readdir(output)).toEqual([]);
});
