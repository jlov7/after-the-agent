import { parseRecordingJson } from './strict-json.js';
export const CAPTURE_FILE_NAMES = ['recording.json','manifest-pending.json','status.json','replay.json','behavioral-verification.json','exchanges.ndjson'] as const;
export const CAPTURE_MAX_BYTES = 8 * 1024 * 1024;
export interface CaptureFile { readonly name:string; readonly raw:string }
export type CaptureStop = 'missing'|'conflicting'|'provider_failed'|'tool_rejected'|'budget_stop'|'incomplete'|'replay_failed'|'behavior_failed'|'complete';
export interface CaptureInspection {
  readonly stop:CaptureStop; readonly reason:string; readonly category:string;
  readonly completion:string; readonly replay:string; readonly behavior:string;
  readonly costUsd:number|null; readonly provenance:'unverified_selected_files'; readonly claimsAuthenticated:false;
  readonly exchangeCount:number; readonly providerRequests:number|null; readonly providerResponses:number|null;
  readonly files:readonly string[]; readonly missing:readonly string[];
}
type ObjectValue = Record<string,unknown>;
const object=(value:unknown):ObjectValue=>{if(typeof value!=='object'||value===null||Array.isArray(value))throw new Error('Artifact must contain a JSON object');return value as ObjectValue;};
const text=(value:unknown,fallback='unknown'):string=>typeof value==='string'?value.slice(0,512)+(value.length>512?'…':''):fallback;
const count=(value:unknown):number|null=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;
/** Reports selected artifact claims. It does not establish authorship or rerun qualification. */
export function inspectCaptureFiles(files:readonly CaptureFile[]):CaptureInspection {
  if(files.length>CAPTURE_FILE_NAMES.length)throw new Error('File count limit exceeded');
  const parsed=new Map<string,ObjectValue>(),names=new Set<string>();let total=0,exchangeCount=0,toolRejected=false,providerRequested=0,providerResponded=0;
  for(const file of files){
    if(!(CAPTURE_FILE_NAMES as readonly string[]).includes(file.name))throw new Error('Only known nonsecret capture artifact filenames are accepted');
    if(names.has(file.name))throw new Error('Duplicate artifact filename');names.add(file.name);
    total+=new TextEncoder().encode(file.raw).length;if(total>CAPTURE_MAX_BYTES)throw new Error('Selected artifact byte limit exceeded (8 MiB total)');
    if(file.name==='exchanges.ndjson'){
      for(const line of file.raw.split('\n')){if(!line.trim())continue;if(++exchangeCount>10000)throw new Error('Exchange count limit exceeded');const row=object(parseRecordingJson(line));
        if(row.stage==='provider_requested')providerRequested++;if(row.stage==='provider_response')providerResponded++;
        if(row.stage==='native_rejected')toolRejected=true;
        if(row.stage==='returned'&&typeof row.result==='object'&&row.result!==null){const returned=object(row.result);if(returned.isError===true)toolRejected=true;const structured=returned.structuredContent;if(typeof structured==='object'&&structured!==null&&object(structured).outcome==='rejected')toolRejected=true;}
      }
    }else parsed.set(file.name,object(parseRecordingJson(file.raw)));
  }
  const pending=parsed.get('manifest-pending.json'),recording=parsed.get('recording.json'),manifest=recording?object(recording.manifest):parsed.get('manifest-pending.json')??{};
  const status=parsed.get('status.json')??{},replay=parsed.get('replay.json')??{},behavior=parsed.get('behavioral-verification.json')??{};
  const replayStatus=text(replay.status??status.replay_status??(recording?manifest.replay_status:undefined));
  const behaviorStatus=text(behavior.status??status.behavioral_verification);
  const completion=text(recording?manifest.completion:undefined);
  const providerRequests=status.attempted_provider_requests===null||manifest.model_requests===null?null:count(status.attempted_provider_requests??manifest.model_requests)??(names.has('exchanges.ndjson')?providerRequested:null);
  const providerResponses=status.observed_provider_responses===null?null:count(status.observed_provider_responses)??(names.has('exchanges.ndjson')?providerResponded:null);
  const reason=text(status.reason??behavior.reason??replay.reason,'No final status selected. Selected files have no authenticated run binding.');
  const conflicts=(recording&&pending&&pending.run_id!==undefined&&manifest.run_id!==undefined&&pending.run_id!==manifest.run_id)
    ||(status.replay_status!==undefined&&replay.status!==undefined&&status.replay_status!==replay.status)
    ||(status.behavioral_verification!==undefined&&behavior.status!==undefined&&status.behavioral_verification!==behavior.status)
    ||(recording&&status.category!==undefined&&status.category!==manifest.category)
    ||(status.status==='passed'&&(replayStatus!=='verified'||behaviorStatus!=='passed'||(recording&&completion!=='complete')))
    ||(recording&&replay.status!==undefined&&manifest.replay_status!==undefined&&manifest.replay_status!==(replay.status==='verified'?'verified':'failed'));
  let stop:CaptureStop='incomplete';
  if(files.length===0)stop='missing';else if(conflicts)stop='conflicting';
  else if(reason==='budget_stop'||completion==='budget_stop')stop='budget_stop';
  else if(toolRejected)stop='tool_rejected';
  else if(providerRequests!==null&&providerRequests>0&&providerResponses===0)stop='provider_failed';
  else if((recording&&completion!=='complete')||['capture_cancelled','capture_timeout','capture_not_completed'].includes(reason))stop='incomplete';
  else if(replayStatus!=='unknown'&&replayStatus!=='verified'&&replayStatus!=='not_run')stop='replay_failed';
  else if(behaviorStatus==='failed')stop='behavior_failed';
  else if(status.status==='passed'&&replayStatus==='verified'&&behaviorStatus==='passed')stop='complete';
  return {stop,reason,category:text(manifest.category??status.category),completion,replay:replayStatus,behavior:behaviorStatus,costUsd:typeof manifest.cost_usd==='number'&&Number.isFinite(manifest.cost_usd)&&manifest.cost_usd>=0?manifest.cost_usd:null,provenance:'unverified_selected_files',claimsAuthenticated:false,exchangeCount,providerRequests,providerResponses,files:[...names],missing:['recording.json','status.json','replay.json','behavioral-verification.json','exchanges.ndjson'].filter(name=>!names.has(name))};
}
