import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { mkdir,writeFile,appendFile,readdir } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { boardSchema,compileSchema,sha256Json,sha256Text,validateRequest,type Action,type FrozenCandidate,type BoardRequest,type BoardResult,type CommandRecord,type DomainEvent,type Recording,type RecordingManifest,type ScenarioFamily } from '../../contracts/src/index.js';
import { createEngine,scenarioSetup,snapshot,immutable } from '../../engine/src/index.js';
import { parseStrictJson } from './strict-json.js';
import { replay } from './replay.js';
import { recordingCommitment } from './recording-schema.js';
import { buildCorpus } from './continuations.js';
import { evaluateCandidate,referenceDirectory } from './node.js';
import { verifyReferenceFiles } from './reference-files.js';
export interface CaptureConfig {
  readonly mode:'fixture'|'live';readonly model:string|null;readonly scenario:ScenarioFamily;readonly prompt:string;
  readonly limits:{readonly max_turns:number;readonly max_tool_calls:number;readonly max_output_tokens:number;readonly max_elapsed_ms:number;readonly max_input_bytes:number};
  readonly budget:null|{readonly account:string;readonly authorization:string;readonly approved_micro_usd:number;readonly model:string;readonly input_micro_usd_per_million:number;readonly output_micro_usd_per_million:number;readonly request_overhead_tokens:number;readonly verified_at:string;readonly source:string;readonly receipt_sha256:string};
}
const obj=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
const bounded=(minimum:number,maximum:number)=>({type:'integer',minimum,maximum});
const configSchema=obj({mode:{enum:['fixture','live']},model:{anyOf:[{type:'string',minLength:1,maxLength:128,pattern:'^[A-Za-z0-9_.-]+$'},{type:'null'}]},scenario:{enum:['valid-pending','stale-queue','duplicate-clock','cached-gate']},prompt:{type:'string',minLength:1,maxLength:8192},limits:obj({max_turns:bounded(1,64),max_tool_calls:bounded(1,128),max_output_tokens:bounded(1,8192),max_elapsed_ms:bounded(1000,300000),max_input_bytes:bounded(16384,262144)}),budget:{anyOf:[{type:'null'},obj({account:{type:'string',minLength:1,maxLength:128},authorization:{type:'string',minLength:1,maxLength:1024},approved_micro_usd:bounded(1,100000000),model:{type:'string',minLength:1,maxLength:128},input_micro_usd_per_million:bounded(1,1000000000),output_micro_usd_per_million:bounded(1,1000000000),request_overhead_tokens:bounded(1024,16384),verified_at:{type:'string',maxLength:64},source:{type:'string',pattern:'^https://(developers[.]openai[.]com|platform[.]openai[.]com)/',maxLength:512},receipt_sha256:{type:'string',pattern:'^[a-f0-9]{64}$',minLength:64,maxLength:64}})]}});
const checkConfig=compileSchema<CaptureConfig>(configSchema);
export const fixtureCaptureConfig:CaptureConfig={mode:'fixture',model:null,scenario:'stale-queue',prompt:'Configure the restricted alternating lights board using only board_action. Odd beats left, even beats right, every fourth beat also center. Period4, delivery delay2. Finish at settled tick5. Each mutation needs the current revision. Assistance ends at tick5.',limits:{max_turns:8,max_tool_calls:16,max_output_tokens:1024,max_elapsed_ms:15000,max_input_bytes:131072},budget:null};
export function validateCaptureConfig(value:unknown):CaptureConfig {
  const result=checkConfig(value);if(!result.valid)throw new Error('Invalid bounded capture configuration');const config=result.data;
  if(config.mode==='fixture'&&(config.model!==null||config.budget!==null))throw new Error('Fixture capture cannot claim a provider/model/budget');
  if(config.mode==='live'){
    const b=config.budget;if(!config.model||!b||b.model!==config.model)throw new Error('Live capture requires exact model and approved account/budget');
    const age=Date.now()-Date.parse(b.verified_at);if(!Number.isFinite(age)||age<0||age>24*3600000)throw new Error('Verified pricing receipt must be current within24hours');
  }
  return config;
}
export function buildResponsesRequest(config:CaptureConfig,input:readonly unknown[]):Record<string,unknown> {
  return {model:config.model,store:false,parallel_tool_calls:false,max_output_tokens:config.limits.max_output_tokens,input,tools:[{type:'function',name:'board_action',description:'The only available capability. Use canonical request envelope. Identity and scene schedules are trusted host state.',parameters:boardSchema,strict:false}],include:['reasoning.encrypted_content']};
}
export class CaptureBudget {
  private reserved=0;
  constructor(private readonly config:CaptureConfig){}
  reserve(requestBytes:number):number {
    const budget=this.config.budget;if(!budget)throw new Error('No approved paid capture budget');
    const bound=requestBytes+budget.request_overhead_tokens;
    const cost=Math.ceil((bound*budget.input_micro_usd_per_million+this.config.limits.max_output_tokens*budget.output_micro_usd_per_million)/1000000);
    if(!Number.isSafeInteger(cost)||this.reserved+cost>budget.approved_micro_usd)throw new Error('budget_stop');
    this.reserved+=cost;return this.reserved;
  }
}
interface NativeCall { readonly type:'function_call';readonly name:string;readonly call_id:string;readonly arguments:string }
interface NativeResponse { readonly id:string;readonly model?:string|null;readonly output:readonly Record<string,unknown>[];readonly usage?:{readonly input_tokens:number;readonly output_tokens:number} }
const responseValidator=compileSchema<NativeResponse>({type:'object',required:['id','output'],properties:{id:{type:'string',maxLength:256},model:{anyOf:[{type:'string',minLength:1,maxLength:128},{type:'null'}]},output:{type:'array',maxItems:128,items:{type:'object'}},usage:{type:'object',required:['input_tokens','output_tokens'],properties:{input_tokens:bounded(0,10000000),output_tokens:bounded(0,10000000)}}}});
const callValidator=compileSchema<NativeCall>({type:'object',required:['type','name','call_id','arguments'],properties:{type:{const:'function_call'},name:{type:'string',maxLength:128},call_id:{type:'string',maxLength:256},arguments:{type:'string',maxLength:65536}}});
const bytes=(value:string)=>new TextEncoder().encode(value).length;
async function boundedResponse(response:Response):Promise<unknown>{
  if(!response.body)throw new Error('Provider response missing');let raw='';let length=0;const reader=response.body.getReader();const decoder=new TextDecoder();
  try{for(;;){const chunk=await reader.read();if(chunk.done)break;length+=chunk.value.byteLength;if(length>8*1024*1024)throw new Error('Provider output exceeds8MiB');raw+=decoder.decode(chunk.value,{stream:true});}raw+=decoder.decode();return JSON.parse(raw);}finally{await reader.cancel();}
}
async function requestProvider(config:CaptureConfig,input:readonly unknown[],key:string,ledger:CaptureBudget,signal:AbortSignal,onRequest:(attempt:number)=>Promise<void>):Promise<{response:NativeResponse}>{
  const body=JSON.stringify(buildResponsesRequest(config,input));if(bytes(body)>config.limits.max_input_bytes)throw new Error('budget_stop');
  for(let attempt=0;attempt<3;attempt++){
    signal.throwIfAborted();ledger.reserve(bytes(body));await onRequest(attempt+1);
    try{
      const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},body,signal});
      if(!response.ok){if((response.status===429||response.status>=500)&&attempt<2){await response.body?.cancel();await new Promise<void>(resolve=>setTimeout(resolve,Math.min(2000,250*2**attempt)+Math.floor(Math.random()*100)));continue;}throw new Error('Provider HTTP '+response.status);}
      const validated=responseValidator(await boundedResponse(response));if(!validated.valid)throw new Error('Invalid provider response boundary');return {response:validated.data};
    }catch(error){if(signal.aborted||attempt===2||!(error instanceof TypeError))throw error;await new Promise<void>(resolve=>setTimeout(resolve,250*2**attempt+Math.floor(Math.random()*100)));}
  }
  throw new Error('Provider retry limit');
}
export interface CapturePreflight {readonly root:string;readonly application_commit:string;readonly dirty:boolean}
async function requireEmptyOutput(output:string):Promise<void>{
  try{if((await readdir(resolve(output))).length>0)throw new Error('Output directory must be fresh or empty');}
  catch(error){if(typeof error!=='object'||error===null||!('code' in error)||error.code!=='ENOENT')throw error;}
}
export async function capturePreflight(mode:CaptureConfig['mode'],outputDir:string):Promise<CapturePreflight>{
  await requireEmptyOutput(outputDir);
  const source=fileURLToPath(new URL('.',import.meta.url));
  const git=(args:string[])=>execFileSync('git',['-c','core.fsmonitor=false','-C',source,...args],{encoding:'utf8',timeout:3000}).trim();
  const state=immutable({root:git(['rev-parse','--show-toplevel']),application_commit:git(['rev-parse','HEAD']),dirty:git(['status','--porcelain','--untracked-files=normal']).length>0});
  if(mode==='live'&&state.dirty)throw new Error('Live capture blocked: dirty implementation');
  return state;
}
export interface CaptureOptions {readonly outputDir:string;readonly preflight?:CapturePreflight;readonly serverPath?:string;readonly signal?:AbortSignal;readonly apiKey?:string;readonly fixtureActions?:readonly Action[]}
export interface CaptureRunResult {readonly status:'passed'|'failed'|'blocked';readonly reason:string;readonly recording:Recording}
export async function runCapture(value:unknown,options:CaptureOptions):Promise<CaptureRunResult>{
  const config=validateCaptureConfig(value);
  if(options.fixtureActions&&config.mode!=='fixture')throw new Error('Fixture driver is forbidden in live capture');
  const fixtureActions=immutable(options.fixtureActions??[{type:'inspect',target:'board'},{type:'set_clock',clock:'primary',enabled:true},{type:'advance',ticks:4},{type:'advance',ticks:1}]);
  if(!Array.isArray(fixtureActions)||fixtureActions.length>64)throw new Error('Fixture action driver exceeds64actions');
  fixtureActions.forEach((action,index)=>validateRequest({schema_version:'1.0',request_id:'fixture.'+index,expected_revision:0,action}));
  const preflight=await capturePreflight(config.mode,options.outputDir);
  if(options.preflight&&sha256Json(options.preflight)!==sha256Json(preflight))throw new Error('Capture implementation changed after preflight');
  const {application_commit:commit,dirty,root}=preflight;
  if(config.mode==='live'&&!options.apiKey)throw new Error('Live capture blocked: explicit provider key required');
  const started=Date.now(),started_at=new Date(started).toISOString();const setup=scenarioSetup(config.scenario);const initial=snapshot(createEngine(setup));let final=initial;const commands:CommandRecord[]=[];const events:DomainEvent[]=[];let calls=0,modelRequests=0,modelResponses=0,usageKnown=true,returnedModel:string|null=null,usage:{input:number;output:number}|null=null,completion:RecordingManifest['completion']='failed',reason='capture_not_completed',invalidExchange=false;
  const baseManifest:RecordingManifest={schema_version:'1.0',run_id:randomUUID(),category:config.mode==='fixture'?'fixture':'live_model',provider:config.mode==='fixture'?null:'openai',harness_version:'ata-responses-bridge-v1',requested_model:config.model,returned_model:null,unavailable_reason:config.mode==='fixture'?'Authored fixture, no provider request.':null,started_at,ended_at:null,elapsed_ms:0,completion:'failed',application_commit:commit,dirty,node_version:process.version,sdk_version:'2.3.1',protocol_version:'2026-07-28',prompt_sha256:sha256Text(config.prompt),tool_schema_sha256:sha256Json(boardSchema),reference_manifest_sha256:'2a1e32b4cf42b1c94c802f9a1822d4878959f652a5afedb4b3cd52123184597f',initial_plant_sha256:sha256Json(initial),world_sha256:sha256Json(setup.world),final_plant_sha256:sha256Json(initial),pulses_sha256:sha256Json([]),model_requests:0,tool_calls:0,token_usage:null,cost_usd:null,replay_status:'not_run',verification_commit:null};
  const output=resolve(options.outputDir);await mkdir(output,{recursive:true});await requireEmptyOutput(output);
  await writeFile(join(output,'manifest-pending.json'),JSON.stringify(baseManifest,null,2)+'\n',{flag:'wx'});
  await writeFile(join(output,'prompt.txt'),config.prompt);await writeFile(join(output,'tool-schema.json'),JSON.stringify(boardSchema,null,2)+'\n');
  if(config.mode==='fixture')await writeFile(join(output,'fixture-actions.json'),JSON.stringify(fixtureActions,null,2)+'\n');
  await writeFile(join(output,'exchanges.ndjson'),'');
  const control=new AbortController();const timer=setTimeout(()=>control.abort(new Error('capture_timeout')),config.limits.max_elapsed_ms);const cancel=()=>control.abort(new Error('capture_cancelled'));options.signal?.addEventListener('abort',cancel,{once:true});if(options.signal?.aborted)cancel();
  const transport=new StdioClientTransport({command:process.execPath,args:[options.serverPath??join(root,'dist/packages/mcp/src/stdio.js'),'--scenario',config.scenario,'--setup'],stderr:'pipe',maxBufferSize:1024*1024});
  const client=new Client({name:'ata-recorder',version:'0.2.0'},{versionNegotiation:{mode:{pin:'2026-07-28'},probe:{timeoutMs:3000,maxRetries:0}}});let stderrBytes=0;transport.stderr?.on('data',(chunk:Buffer)=>{stderrBytes+=chunk.length;if(stderrBytes>65536)control.abort(new Error('capture_stderr_limit'));});
  const input:unknown[]=[{role:'user',content:config.prompt}];const ledger=new CaptureBudget(config);let journalSeq=0;
  try{
    control.signal.throwIfAborted();await client.connect(transport,{timeout:3000,signal:control.signal});
    if(client.getNegotiatedProtocolVersion()!=='2026-07-28')throw new Error('Wrong protocol');
    const tools=await client.listTools(undefined,{timeout:3000,signal:control.signal});if(tools.tools.length!==1||tools.tools[0]?.name!=='board_action'||sha256Json(tools.tools[0].inputSchema)!==sha256Json(boardSchema))throw new Error('Unexpected assessed capability surface');
    for(let turn=0;turn<config.limits.max_turns;turn++){
      control.signal.throwIfAborted();let outputItems:readonly Record<string,unknown>[];
      if(config.mode==='fixture'){
        const action=fixtureActions[turn];outputItems=action?[{type:'function_call',name:'board_action',call_id:'fixture.'+turn,arguments:JSON.stringify({schema_version:'1.0',request_id:'fixture.'+turn,...(action.type==='inspect'?{}:{expected_revision:final.revision}),action})}]:[];
      }else{
        const received=await requestProvider(config,input,options.apiKey as string,ledger,control.signal,async attempt=>{modelRequests++;await appendFile(join(output,'exchanges.ndjson'),JSON.stringify({seq:++journalSeq,stage:'provider_requested',attempt,model:config.model,elapsed_ms:Date.now()-started,request_sha256:sha256Json(buildResponsesRequest(config,input))})+'\n');});modelResponses++;returnedModel=received.response.model??null;outputItems=received.response.output;
        await appendFile(join(output,'exchanges.ndjson'),JSON.stringify({seq:++journalSeq,stage:'provider_response',elapsed_ms:Date.now()-started,response_id:received.response.id,model:received.response.model??null,usage:received.response.usage??null})+'\n');
        if(received.response.usage){usage??={input:0,output:0};usage.input+=received.response.usage.input_tokens;usage.output+=received.response.usage.output_tokens;}else usageKnown=false;
      }
      input.push(...outputItems);const nativeCalls=outputItems.filter(item=>item.type==='function_call');
      const receivedCalls:{item:Record<string,unknown>;seq:number}[]=[];
      for(const item of nativeCalls){const seq=++journalSeq;await appendFile(join(output,'exchanges.ndjson'),JSON.stringify({seq,stage:'native_received',elapsed_ms:Date.now()-started,raw_call:item})+'\n');receivedCalls.push({item,seq});}

      if(nativeCalls.length===0){if(final.tick===5&&calls>0&&!invalidExchange){completion='complete';reason='observed_capture_replayed';}else reason='Missing canonical tick5 construction or invalid exchange';break;}
      for(const received of receivedCalls){
        const item=received.item;
        const rejectNative=async(reason:string)=>{await appendFile(join(output,'exchanges.ndjson'),JSON.stringify({seq:++journalSeq,stage:'native_rejected',elapsed_ms:Date.now()-started,native_seq:received.seq,raw_call:item,reason})+'\n');};
        control.signal.throwIfAborted();if(++calls>config.limits.max_tool_calls){await rejectNative('tool_call_budget_exhausted');throw new Error('budget_stop');}
        const validated=callValidator(item);
        if(!validated.valid){await rejectNative(typeof item.arguments==='string'&&item.arguments.length>65536?'argument_limit_exceeded':'invalid_native_call_envelope');throw new Error('Invalid provider tool envelope');}
        if(validated.data.name!=='board_action'){await rejectNative('unadvertised_tool_name');throw new Error('Unrecognized provider tool capability');}
        const call=validated.data;
        await appendFile(join(output,'exchanges.ndjson'),JSON.stringify({seq:++journalSeq,stage:'requested',elapsed_ms:Date.now()-started,call_id:call.call_id,name:call.name,arguments:call.arguments})+'\n');
        let returned:unknown;let request:BoardRequest|null=null;
        try{const raw=parseStrictJson(call.arguments);
          try{request=validateRequest(raw);}catch{invalidExchange=true;}
          if(typeof raw!=='object'||raw===null||Array.isArray(raw))throw new Error('Invalid tool argument object');
          const result=await client.callTool({name:'board_action',arguments:raw as Record<string,unknown>},{timeout:Math.min(5000,config.limits.max_elapsed_ms),signal:control.signal});returned=result;if(!request)throw new Error('Malformed canonical request');
          const actual=result.structuredContent as unknown as BoardResult;if(!actual||actual.request_id!==request.request_id||!['accepted','rejected'].includes(actual.outcome))throw new Error('Missing dispatcher result');
          commands.push({seq:commands.length+1,request,actor:{actor_id:'assessed-model',role:'assessed_agent',phase:final.tick>=5?'recovery':'setup'},tick:actual.observation.plant.tick,elapsed_ms:Date.now()-started,result:actual});
          if(actual.revision>=final.revision)final=actual.observation.plant;
          for(const event of actual.events){const prior=events.find(old=>old.seq===event.seq);if(prior&&sha256Json(prior)!==sha256Json(event))throw new Error('Inconsistent event identity');if(!prior)events.push(event);}
        }catch(error){if(control.signal.aborted)throw error;invalidExchange=true;returned??={isError:true,error:'Invalid or incomplete tool exchange',code:typeof error==='object'&&error!==null&&'code' in error?String(error.code):'LOCAL_BOUNDARY_REJECTION'};}
        await appendFile(join(output,'exchanges.ndjson'),JSON.stringify({seq:++journalSeq,stage:'returned',elapsed_ms:Date.now()-started,call_id:call.call_id,result:returned})+'\n');input.push({type:'function_call_output',call_id:call.call_id,output:JSON.stringify(returned)});
      }
      if(turn===config.limits.max_turns-1)throw new Error('budget_stop');
    }
  }catch(error){const message=error instanceof Error?error.message:'capture_failed';completion=control.signal.aborted?(options.signal?.aborted?'cancelled':'timeout'):message==='budget_stop'?'budget_stop':'failed';reason=completion==='failed'?'Capture failed at an explicit boundary':message;}
  finally{clearTimeout(timer);options.signal?.removeEventListener('abort',cancel);await client.close();await transport.close();}
  const unavailableReason=config.mode==='fixture'?baseManifest.unavailable_reason:modelResponses===0?'No validated provider response observed; returned-model metadata unknown.':returnedModel===null?'Validated provider response did not expose returned-model metadata.':null;
  let recording:Recording={schema_version:'1.0',manifest:{...baseManifest,returned_model:returnedModel,unavailable_reason:unavailableReason,ended_at:new Date().toISOString(),elapsed_ms:Date.now()-started,completion,final_plant_sha256:sha256Json(final),pulses_sha256:sha256Json(events.filter(event=>event.type==='pulse')),model_requests:modelRequests,tool_calls:calls,token_usage:usageKnown&&modelResponses===modelRequests?usage:null,cost_usd:null},setup,initial_plant:initial,commands,events,final_plant:final};
  const checked=replay(recording,config.mode==='live'?{trusted_live_sha256:recordingCommitment(recording)}:{});recording={...recording,manifest:{...recording.manifest,replay_status:checked.status==='verified'?'verified':'failed',verification_commit:commit}};
  let behavior:Record<string,unknown>={schema_version:'1.0',status:'not_run',reason:'Recording is incomplete or replay is unverified',reference_manifest_sha256:baseManifest.reference_manifest_sha256,candidate:null,corpus:null,result:null};
  let eligible=false;
  if(completion==='complete'&&checked.status==='verified'){
    const candidate:FrozenCandidate=immutable({schema_version:'1.0',plant:final,world_prefix:{initial_world:setup.world.initial_world,transitions:setup.world.transitions.filter(change=>change.tick<=5)},task:setup.task,candidate_sha256:sha256Json(final),attempt_id:baseManifest.run_id,capture_tick:5,original_handover_tick:5,terminal_reason:'submitted',reset_during_attempt:false});
    const verificationStarted=Date.now();
    try{
      const reference=referenceDirectory(),corpus=immutable(buildCorpus(candidate)),result=await evaluateCandidate(candidate,corpus);
      eligible=result.status==='pass'&&result.candidate_sha256===candidate.candidate_sha256&&result.cases.length===12&&result.cases.every(item=>item.status==='pass');
      await writeFile(join(output,'reference-verification.json'),JSON.stringify(verifyReferenceFiles(reference),null,2)+'\n');
      behavior={schema_version:'1.0',status:eligible?'passed':'failed',reason:eligible?'Independent target behavior passed all12continuations':'Independent target behavior did not pass',reference_manifest_sha256:baseManifest.reference_manifest_sha256,reference_directory:'pinned-reference',elapsed_ms:Date.now()-verificationStarted,candidate,corpus,result};
      reason=eligible?'target_behavior_verified':result.status==='mismatch'?'target_behavior_failed':'target_behavior_not_verified';
    }catch{
      behavior={...behavior,status:'failed',reason:'Anchored independent target verification unavailable',candidate,elapsed_ms:Date.now()-verificationStarted};reason='target_behavior_not_verified';
    }
  }
  await writeFile(join(output,'behavioral-verification.json'),JSON.stringify(behavior,null,2)+'\n');
  await writeFile(join(output,'recording.json'),JSON.stringify(recording,null,2)+'\n');await writeFile(join(output,'replay.json'),JSON.stringify(checked,null,2)+'\n');await writeFile(join(output,'status.json'),JSON.stringify({status:eligible?'passed':'failed',eligible,reason,replay_status:checked.status,behavioral_verification:behavior.status,category:recording.manifest.category,genuine_model_observed:config.mode==='live'&&modelResponses>0,attempted_provider_requests:modelRequests,observed_provider_responses:modelResponses,hash_limits:'Consistency commitments do not authenticate provider authorship.'},null,2)+'\n');
  return {status:eligible?'passed':'failed',reason,recording};
}
