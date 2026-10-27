import { it,expect } from 'vitest';
import { authoredRecording } from './fixture.js';
import { replay } from '../../packages/runner/src/replay.js';
import { importRecording } from '../../packages/runner/src/recording-schema.js';
import { sha256Json,type Recording } from '../../packages/contracts/src/index.js';
it('reconstructs all authored fault families from ordered commands, preserving pending state',()=>{
  for(const family of ['stale-queue','duplicate-clock','cached-gate','valid-pending'] as const){const recording=authoredRecording(family);const result=replay(importRecording(JSON.stringify(recording)));expect(result.status,result.mismatches.join(',')).toBe('verified');expect(result.plant).toEqual(recording.final_plant);}
});
it('rejects deleted, duplicated, reordered events/actions and substituted task/world/schema/final commitments',()=>{
  const base=authoredRecording('duplicate-clock');
  const mutations:Array<(record:Record<string,unknown>)=>void>=[
    r=>{(r.events as unknown[]).pop();},r=>{(r.events as unknown[]).push((r.events as unknown[])[0]);},r=>{(r.events as unknown[]).reverse();},
    r=>{(r.commands as unknown[]).pop();},r=>{(r.commands as unknown[]).push((r.commands as unknown[])[0]);},r=>{(r.commands as unknown[]).reverse();},
    r=>{(r.final_plant as Record<string,unknown>).queue=[];},r=>{r.score='pass';},r=>{(r.manifest as Record<string,unknown>).tool_schema_sha256='0'.repeat(64);},
    r=>{((r.setup as Record<string,unknown>).task as Record<string,unknown>).period=3;},r=>{(((r.setup as Record<string,unknown>).world as Record<string,unknown>).initial_world as Record<string,unknown>).scene_id='substituted';},
    r=>{(r.manifest as Record<string,unknown>).category='live_model';},r=>{(r.manifest as Record<string,unknown>).completion='timeout';}
  ];
  for(const mutate of mutations){const changed=structuredClone(base) as unknown as Record<string,unknown>;mutate(changed);expect(replay(changed).status).not.toBe('verified');}
  const rebound=structuredClone(base) as unknown as {final_plant:Recording['final_plant'];manifest:{final_plant_sha256:string}};rebound.final_plant.queue=[];rebound.manifest.final_plant_sha256=sha256Json(rebound.final_plant);expect(replay(rebound).status).toBe('mismatch');
});
