import { readFile,writeFile } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { runCapture,fixtureCaptureConfig,validateCaptureConfig,capturePreflight } from './capture.js';
import { randomUUID } from 'node:crypto';
import { parseStrictJson } from './strict-json.js';
const args=process.argv.slice(2);let live=false;let configPath:string|null=null;let output='work/recordings/'+randomUUID();
for(let index=0;index<args.length;index++){const arg=args[index];if(arg==='--live')live=true;else if(arg==='--dry-run')live=false;else if(arg==='--config'){configPath=args[++index]??null;if(!configPath||!configPath.endsWith('.json'))throw new Error('Config must be an explicit JSON file');}else if(arg==='--output'){output=args[++index]??'';if(!output)throw new Error('Output directory required');}else throw new Error('Unknown capture option');}
try{
const config=validateCaptureConfig(configPath?parseStrictJson(await readFile(resolve(configPath),'utf8')):fixtureCaptureConfig);
if(live!== (config.mode==='live'))throw new Error('Live mode requires explicit --live and live configuration');
const preflight=await capturePreflight(config.mode,output);
// Credential access occurs only in a future explicitly invoked --live process, never in dry-run.
const apiKey=live?process.env.OPENAI_API_KEY:undefined;
const result=await runCapture(config,{outputDir:output,preflight,...(apiKey?{apiKey}:{})});
await writeFile(join(resolve(output),'config.json'),JSON.stringify(config,null,2)+'\n',{flag:'wx'});
process.stdout.write(JSON.stringify({status:result.status,category:result.recording.manifest.category,reason:result.reason})+'\n');
process.exitCode=result.status==='passed'?0:1;
}catch(error){process.stdout.write(JSON.stringify({status:'blocked',request_id:randomUUID(),reason:error instanceof Error?error.message:'Capture preflight failed'})+'\n');process.exitCode=1;}
