import { boardSchema, evaluationSchema, compileSchema, sha256Text, validateRequest, type CommandRecord, type JsonValue, type RecordingCommandRecord, type Recording } from '../../contracts/src/index.js';
import { parseStrictJson,parseRecordingJson } from './strict-json.js';
const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, properties, required });
const integer = (maximum = Number.MAX_SAFE_INTEGER) => ({ type: 'integer', minimum: 0, maximum });
const text = (maxLength = 256) => ({ type: 'string', maxLength });
const nullableText = { anyOf: [text(), { type: 'null' }] };
const hash = { type:'string',pattern:'^[a-f0-9]{64}$',minLength:64,maxLength:64 };
const ref = (name:string) => ({ $ref:'#/$defs/'+name });
const array = (items:unknown,maxItems:number) => ({ type:'array',items,maxItems });
const phase = { enum:['setup','playback','recovery','submitted','timed_out','abandoned_reset'] };
const scenario = { enum:['valid-pending','stale-queue','duplicate-clock','cached-gate'] };
const actor = object({ actor_id: {type:'string',minLength:1,maxLength:64},role:{enum:['human','assessed_agent','controller']},phase });
const eventBase = { seq:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER},tick:integer(4096) };
const event = (type:string,properties:Record<string,unknown>={}) => object({...eventBase,type:{const:type},...properties});
const domainEvent = {oneOf:[event('world_changed',{world:ref('World')}),event('clock_fired',{clock:ref('Clock')}),event('job_enqueued',{job:ref('Job')}),event('pulse',{job_id:ref('JobId'),lamp:ref('Lamp')}),event('job_discarded',{job_id:ref('JobId'),reason:{const:'epoch_mismatch'}}),event('settled_tick'),event('config_changed',{config:ref('Configuration')}),event('gate_refreshed',{gate_cache:ref('GateCache')}),event('jobs_dropped',{job_ids:array(ref('JobId'),64)})]};
const events = array(domainEvent,100000);
const boardError = object({code:{enum:['INVALID_REQUEST','REQUEST_ID_CONFLICT','REVISION_CONFLICT','ACTOR_FORBIDDEN','PHASE_FORBIDDEN','UNKNOWN_JOB','BUDGET_LIMIT','HISTORY_CAPACITY','NOT_IMPLEMENTED']},message:text(512)});
const boardResult = object({request_id:ref('RequestId'),outcome:{enum:['accepted','rejected']},revision:ref('Revision'),observation:object({plant:ref('CanonicalPlant'),events}),events,error:boardError,no_op:{type:'boolean'}},['request_id','outcome','revision','observation','events']);
const task = object({schema_version:{const:'1.0'},task_id:{const:'alternating-lights-v1'},scenario,period:{const:4},delay:{const:2},max_tick:{const:4096},enqueue_until_tick:integer(4094),max_queue:{const:128},max_pulses:{const:16384},max_audit_records:{const:10000},recovery_seconds:{const:300}});
const world = object({initial_world:ref('InitialWorld'),transitions:array(ref('Transition'),4096)});
const setup = object({task,world,config:ref('Configuration'),gate_cache:ref('GateCache')},['task','world','config']);
const manifest = object({schema_version:{const:'1.0'},run_id:{type:'string',minLength:1,maxLength:64},category:{enum:['live_model','scripted','fixture']},provider:nullableText,harness_version:nullableText,requested_model:nullableText,returned_model:nullableText,unavailable_reason:nullableText,started_at:text(64),ended_at:{anyOf:[text(64),{type:'null'}]},elapsed_ms:integer(3600000),completion:{enum:['complete','timeout','cancelled','budget_stop','failed']},application_commit:{type:'string',pattern:'^[a-f0-9]{40}$'},dirty:{type:'boolean'},node_version:text(64),sdk_version:text(32),protocol_version:{enum:['2026-07-28','2025-11-25']},prompt_sha256:hash,tool_schema_sha256:hash,reference_manifest_sha256:hash,initial_plant_sha256:hash,world_sha256:hash,final_plant_sha256:hash,pulses_sha256:hash,model_requests:{anyOf:[integer(1000),{type:'null'}]},tool_calls:integer(10000),token_usage:{anyOf:[object({input:integer(),output:integer()}),{type:'null'}]},cost_usd:{anyOf:[{type:'number',minimum:0,maximum:100000},{type:'null'}]},replay_status:{enum:['verified','failed','not_run']},verification_commit:{anyOf:[{type:'string',pattern:'^[a-f0-9]{40}$'},{type:'null'}]}});
const canonicalCommand=object({seq:{type:'integer',minimum:1,maximum:10000},request:ref('BoardRequest'),actor,tick:integer(4096),elapsed_ms:integer(3600000),result:boardResult});
const rejectedCommand=object({seq:{type:'integer',minimum:1,maximum:10000},request_encoding:{const:'rejected-json-v1'},raw_request:{},actor,tick:integer(4096),elapsed_ms:integer(3600000),result:{...boardResult,properties:{...boardResult.properties,request_id:text(65536),outcome:{const:'rejected'},error:object({code:{const:'INVALID_REQUEST'},message:text(512)})},required:[...boardResult.required,'error']}});
const requestRoot = Object.fromEntries(Object.entries(boardSchema).filter(([key])=>!['$schema','$id','$defs','title','description','$comment'].includes(key)));
export const recordingSchema = { $schema:'https://json-schema.org/draft/2020-12/schema',...object({schema_version:{const:'1.0'},manifest,setup,initial_plant:ref('CanonicalPlant'),commands:array({oneOf:[canonicalCommand,rejectedCommand]},10000),events,final_plant:ref('CanonicalPlant')}),$defs:{...boardSchema.$defs,...evaluationSchema.$defs,BoardRequest:requestRoot} };
const validate = compileSchema<Recording>(recordingSchema);
export interface RecordingTrust { readonly trusted_live_sha256?: string }
export function recordingCommitment(value:Recording):string { return sha256Text(JSON.stringify(value)); }
export function validateRecording(value:unknown,trust:RecordingTrust={}):Recording {
  if (new TextEncoder().encode(JSON.stringify(value)).length > 8*1024*1024) throw new Error('Recording exceeds 8 MiB');
  const safe = parseRecordingJson(JSON.stringify(value));
  const result=validate(safe);if(!result.valid)throw new Error('Invalid recording schema');
  const recording=result.data;
  if(recording.manifest.category==='live_model'){
    if(!trust.trusted_live_sha256 || recordingCommitment(recording)!==trust.trusted_live_sha256)throw new Error('Live-model provenance requires a separately trusted recording commitment');
    const m=recording.manifest;
    const observed=m.model_requests===null ? /^ata-codex-cli-v1\/0[.]160[.]1$/.test(m.harness_version??'')&&!!m.unavailable_reason : m.model_requests>=1;
    if(m.provider!=='openai' || !m.harness_version || !m.requested_model || !observed || m.tool_calls<1 || m.dirty || (m.returned_model===null ? !m.unavailable_reason : m.unavailable_reason!==null))throw new Error('Missing observed live-model provenance');
  } else if(recording.manifest.model_requests!==0 || recording.manifest.provider!==null || recording.manifest.requested_model!==null || recording.manifest.returned_model!==null || recording.manifest.token_usage!==null || recording.manifest.cost_usd!==null)throw new Error('Authored recording must not invent provider evidence');
  return recording;
}
export function importRecording(raw:string,trust:RecordingTrust={}):Recording {
  if(new TextEncoder().encode(raw).length>8*1024*1024)throw new Error('Recording exceeds 8 MiB');
  return validateRecording(parseRecordingJson(raw),trust);
}

export function recordingCommand(command:CommandRecord):RecordingCommandRecord {
  try{validateRequest(command.request);return command;}catch{
    if(command.result.outcome!=='rejected'||command.result.error?.code!=='INVALID_REQUEST')throw new Error('Malformed request has no dispatcher rejection');
    const raw=parseStrictJson(JSON.stringify(command.request)) as JsonValue;
    return {seq:command.seq,request_encoding:'rejected-json-v1',raw_request:raw,actor:command.actor,tick:command.tick,elapsed_ms:command.elapsed_ms,result:{...command.result,outcome:'rejected'}};
  }
}
