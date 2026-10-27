import { createEngine, dispatch, snapshot, engineEvents, setEnginePhase } from '../../engine/src/index.js';
import { boardSchema, sha256Json, validateRequest, type BoardRequest, type Recording, type ReplayResult } from '../../contracts/src/index.js';
import { validateRecording, type RecordingTrust } from './recording-schema.js';
const same = (a:unknown,b:unknown):boolean => sha256Json(a)===sha256Json(b);
export function replay(value:unknown,trust:RecordingTrust={}):ReplayResult {
  let recording:Recording;
  try {recording=validateRecording(value,trust);}catch(error){return {status:'invalid',events:[],mismatches:[error instanceof Error?error.message:'Invalid recording']};}
  const mismatches:string[]=[];
  try {
    const m=recording.manifest;
    if(m.completion!=='complete')throw new Error('Recording is incomplete');
    if(m.ended_at===null || !Number.isFinite(Date.parse(m.started_at)) || !Number.isFinite(Date.parse(m.ended_at)))throw new Error('Invalid completion times');
    if(m.tool_schema_sha256!==sha256Json(boardSchema))throw new Error('Tool schema commitment differs');
    if(m.reference_manifest_sha256!=='2a1e32b4cf42b1c94c802f9a1822d4878959f652a5afedb4b3cd52123184597f')throw new Error('Unknown reference commitment');
    if(m.world_sha256!==sha256Json(recording.setup.world))throw new Error('World history commitment differs');
    const engine=createEngine(recording.setup);
    if(!same(snapshot(engine),recording.initial_plant)||m.initial_plant_sha256!==sha256Json(recording.initial_plant))throw new Error('Initial plant differs from setup');
    let previousElapsed=0;let phase='setup';
    const phaseRank:Record<string,number>={setup:0,playback:1,recovery:2,submitted:3,timed_out:3,abandoned_reset:3};
    for(const [index,command] of recording.commands.entries()){
      if(command.seq!==index+1 || command.elapsed_ms<previousElapsed || command.elapsed_ms>m.elapsed_ms)throw new Error('Command ordering/timing differs');
      if((phaseRank[command.actor.phase]??-1)<(phaseRank[phase]??-1))throw new Error('Recorded phase rolls back');
      phase=command.actor.phase;
      setEnginePhase(engine,command.actor.role==='assessed_agent'&&snapshot(engine).tick>=5?'recovery':command.actor.phase);
      const before=snapshot(engine);
      const raw='request_encoding' in command;
      if(raw){let invalid=false;try{validateRequest(command.raw_request);}catch{invalid=true;}if(!invalid)throw new Error('Raw rejection contains a canonical successful request');}
      const actual=dispatch(engine,(raw?command.raw_request:command.request) as BoardRequest,command.actor);
      if(raw&&(actual.outcome!=='rejected'||actual.error?.code!=='INVALID_REQUEST'||!same(before,snapshot(engine))))throw new Error('Raw request did not reproduce an unchanged dispatcher rejection');
      if(snapshot(engine).tick!==command.tick)throw new Error('Command settled tick differs');
      if(!same(actual,command.result))mismatches.push('Command '+command.seq+' result differs');
      previousElapsed=command.elapsed_ms;
    }
    const plant=snapshot(engine);const events=engineEvents(engine);
    if(!same(plant,recording.final_plant)||sha256Json(plant)!==m.final_plant_sha256)mismatches.push('Final plant differs');
    if(!same(events,recording.events))mismatches.push('Domain events differ');
    if(sha256Json(events.filter(event=>event.type==='pulse'))!==m.pulses_sha256)mismatches.push('Pulse commitment differs');
    if(m.tool_calls!==recording.commands.length)mismatches.push('Tool count differs');
    return {status:mismatches.length?'mismatch':'verified',plant,events,mismatches};
  }catch(error){return {status:'invalid',events:[],mismatches:[error instanceof Error?error.message:'Invalid replay']};}
}
