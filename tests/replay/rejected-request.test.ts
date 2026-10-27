import { expect,test } from 'vitest';
import { createEngine,dispatch,snapshot,engineEvents,engineAudit,setEnginePhase } from '../../packages/engine/src/index.js';
import { sha256Json,type BoardRequest } from '../../packages/contracts/src/index.js';
import { authoredRecording } from './fixture.js';
import { importRecording,recordingCommand } from '../../packages/runner/src/recording-schema.js';
import { replay } from '../../packages/runner/src/replay.js';
test('versioned raw malformed dispatcher rejection survives import and replay',()=>{
  const base=authoredRecording('valid-pending');const engine=createEngine(base.setup);
  const raw={schema_version:'1.0',request_id:'malformed.1',expected_revision:0,action:{type:'set_epoch_guard',enabled:'yes'}};
  const actor={actor_id:'headless-controller',role:'controller',phase:'setup'} as const;
  const before=snapshot(engine);const result=dispatch(engine,raw as unknown as BoardRequest,actor);
  expect(result.error?.code).toBe('INVALID_REQUEST');expect(snapshot(engine)).toEqual(before);
  const recording={...base,commands:engineAudit(engine).map(recordingCommand),events:engineEvents(engine),final_plant:before,manifest:{...base.manifest,tool_calls:1,final_plant_sha256:sha256Json(before),pulses_sha256:sha256Json([])}};
  expect(recording.commands[0]).toHaveProperty('request_encoding','rejected-json-v1');
  expect(replay(importRecording(JSON.stringify(recording))).status).toBe('verified');
  const tampered={...recording,commands:[{...recording.commands[0],result:{...result,outcome:'accepted'}}]};
  expect(replay(tampered).status).toBe('invalid');
});

test('recorded playback label cannot admit assessed output after reconstructed handover',()=>{
  const base=authoredRecording('valid-pending');const engine=createEngine(base.setup);
  for(const command of base.commands){if('request_encoding' in command)throw new Error('Unexpected raw fixture');dispatch(engine,command.request,command.actor);}
  setEnginePhase(engine,'playback');const actor={actor_id:'assessed-model',role:'assessed_agent',phase:'playback'} as const;
  const request={schema_version:'1.0',request_id:'forged.after',expected_revision:base.final_plant.revision,action:{type:'set_epoch_guard',enabled:true}} as const;
  const result=dispatch(engine,request,actor);expect(result.outcome).toBe('accepted');
  const forged={...base,commands:[...base.commands,{seq:base.commands.length+1,request,actor,tick:5,elapsed_ms:0,result}],events:engineEvents(engine),final_plant:snapshot(engine),manifest:{...base.manifest,tool_calls:base.commands.length+1,final_plant_sha256:sha256Json(snapshot(engine))}};
  expect(replay(forged).status).not.toBe('verified');
});
