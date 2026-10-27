import { it,expect } from 'vitest';
import { runCapture,fixtureCaptureConfig } from '../../packages/runner/src/capture.js';
import { importRecording } from '../../packages/runner/src/recording-schema.js';
import { replay } from '../../packages/runner/src/replay.js';
import { readFile,mkdir,mkdtemp,cp } from 'node:fs/promises';
it('dry run records actual MCP exchanges as fixture and reproduces the actual tick5 plant without provider access',async()=>{
  const result=await retainedCapture(fixtureCaptureConfig,{outputDir:'evidence/recording-dry-run'});
  expect(result.status).toBe('passed');expect(result.recording.manifest.category).toBe('fixture');expect(result.recording.manifest.model_requests).toBe(0);expect(result.recording.manifest.requested_model).toBeNull();expect(result.recording.final_plant.tick).toBe(5);expect(result.recording.final_plant.queue).toHaveLength(1);
  const behavior=JSON.parse(await readFile('evidence/recording-dry-run/behavioral-verification.json','utf8')) as {status:string;result:{cases:unknown[]}};expect(behavior.status).toBe('passed');expect(behavior.result.cases).toHaveLength(12);
  const imported=importRecording(await readFile('evidence/recording-dry-run/recording.json','utf8'));expect(replay(imported).status).toBe('verified');
});

it.each(['no-clock','duplicate-clock'] as const)('complete %s fixture transcript is retained but fails independent behavior verification',async kind=>{
  const outputDir='evidence/recording-behavior-'+kind;
  const action=kind==='no-clock'?{type:'set_clock',clock:'primary',enabled:false} as const:{type:'set_clock',clock:'shadow',enabled:true} as const;
  const result=await retainedCapture(fixtureCaptureConfig,{outputDir,fixtureActions:[action,{type:'advance',ticks:4},{type:'advance',ticks:1}]});
  expect(result.recording.manifest.completion).toBe('complete');expect(result.recording.manifest.replay_status).toBe('verified');
  expect(result.status).toBe('failed');expect(result.reason).toBe('target_behavior_failed');
  const verification=JSON.parse(await readFile(outputDir+'/behavioral-verification.json','utf8')) as {status:string;result:{status:string;cases:unknown[]};corpus:{cases:unknown[]}};
  expect(verification.status).toBe('failed');expect(verification.result.status).toBe('mismatch');expect(verification.result.cases).toHaveLength(12);expect(verification.corpus.cases).toHaveLength(12);
});

async function retainedCapture(config:unknown,options:Parameters<typeof runCapture>[1]){
  await mkdir('work/recordings',{recursive:true});const directory=await mkdtemp('work/recordings/capture-test-');
  const result=await runCapture(config,{...options,outputDir:directory});await cp(directory,options.outputDir,{recursive:true});return result;
}
