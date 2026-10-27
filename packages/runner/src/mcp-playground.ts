import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardSchema,sha256Json } from '../../contracts/src/index.js';
import { parseStrictJson } from './strict-json.js';
import release from '../package.json' with { type: 'json' };
export const PLAYGROUND_LIMITS={requests:64,requestBytes:65536,totalBytes:1024*1024,elapsedMs:60000,responseBytes:1024*1024} as const;
export interface PlaygroundReply {readonly status:'returned'|'tool_error';readonly response:Record<string,unknown>}
export interface McpPlayground {request(value:unknown):Promise<PlaygroundReply>;close():Promise<void>}
/** Fixed local recovery host. Request arguments cannot select actor, phase or world. */
export async function openMcpPlayground():Promise<McpPlayground>{
  const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL(import.meta.url.endsWith('.ts')?'../../../dist/packages/mcp/src/stdio.js':'../../mcp/src/stdio.js',import.meta.url))],cwd:process.cwd(),env:{PATH:process.env.PATH??''},stderr:'pipe',maxBufferSize:PLAYGROUND_LIMITS.responseBytes});
  const client=new Client({name:'ata-local-playground',version:release.version},{versionNegotiation:{mode:{pin:'2026-07-28'},probe:{timeoutMs:5000,maxRetries:0}}});
  let closed=false,count=0,total=0,stderrBytes=0,tail:Promise<unknown>=Promise.resolve(),closing:Promise<void>|undefined;
  const close=():Promise<void>=>{if(closing)return closing;closed=true;clearTimeout(timer);closing=(async()=>{try{await client.close();}finally{await transport.close();}})();return closing;};
  const timer=setTimeout(()=>{void close();},PLAYGROUND_LIMITS.elapsedMs);timer.unref();
  transport.stderr?.on('data',(chunk:Buffer)=>{stderrBytes+=chunk.byteLength;if(stderrBytes>65536)void close();});
  try{await client.connect(transport,{timeout:5000});const listed=await client.listTools(undefined,{timeout:5000});if(listed.tools.length!==1||listed.tools[0]?.name!=='board_action'||sha256Json(listed.tools[0].inputSchema)!==sha256Json(boardSchema))throw new Error('Unexpected local MCP capability surface');}
  catch(error){await close();throw error;}
  return {close,request(value){
    if(closed)return Promise.reject(new Error('Playground session closed'));
    let raw:string;try{raw=JSON.stringify(value);}catch{return Promise.reject(new Error('Invalid request JSON'));}
    if(typeof raw!=='string')return Promise.reject(new Error('Invalid request JSON'));
    const bytes=Buffer.byteLength(raw);if(bytes>PLAYGROUND_LIMITS.requestBytes||total+bytes>PLAYGROUND_LIMITS.totalBytes||count>=PLAYGROUND_LIMITS.requests)return Promise.reject(new Error('Playground request/session limit exceeded'));
    count++;total+=bytes;
    const execute=async():Promise<PlaygroundReply>=>{
      if(closed)throw new Error('Playground session closed');
      const input=parseStrictJson(raw);if(typeof input!=='object'||input===null||Array.isArray(input))throw new Error('Request must be a JSON object');
      try{const response=await client.callTool({name:'board_action',arguments:input as Record<string,unknown>},{timeout:5000});if(Buffer.byteLength(JSON.stringify(response))>PLAYGROUND_LIMITS.responseBytes)throw new Error('MCP response limit exceeded');return {status:response.isError===true?'tool_error':'returned',response:response as Record<string,unknown>};}
      catch(error){if(typeof error==='object'&&error!==null&&'code' in error&&typeof error.code==='number')return {status:'tool_error',response:{code:error.code,message:error instanceof Error?error.message.slice(0,1024):'MCP tool error'}};throw error;}
    };
    const pending=tail.then(execute);tail=pending.catch(()=>undefined);return pending;
  }};
}
export async function playgroundMain(args:readonly string[]=process.argv.slice(2)):Promise<void>{
  if(args.length){if(args.length===1&&args[0]==='--help'){process.stdout.write('Local MCP playground: one canonical board request JSON object per stdin line.\n64 requests, 64 KiB per line, 1 MiB total, 60 seconds. Fixed human recovery host.\nResults are actual local stdio responses; rejected envelopes cannot select authority.\n');return;}throw new Error('Unknown playground option; use --help');}
  const playground=await openMcpPlayground();let pending='',total=0,lines=0;process.stdin.setEncoding('utf8');
  const timer=setTimeout(()=>{process.stdin.destroy();void playground.close();},PLAYGROUND_LIMITS.elapsedMs);timer.unref();
  const line=async(raw:string)=>{if(!raw.trim())return;if(++lines>PLAYGROUND_LIMITS.requests)throw new Error('Playground line limit exceeded');try{const reply=await playground.request(parseStrictJson(raw));process.stdout.write(JSON.stringify(reply)+'\n');}catch(error){process.stdout.write(JSON.stringify({status:'input_rejected',message:error instanceof Error?error.message.slice(0,1024):'Invalid request'})+'\n');}};
  try{for await(const chunk of process.stdin){total+=Buffer.byteLength(chunk);if(total>PLAYGROUND_LIMITS.totalBytes)throw new Error('Playground input limit exceeded');pending+=chunk.toString('utf8');let newline:number;while((newline=pending.indexOf('\n'))>=0){const raw=pending.slice(0,newline);pending=pending.slice(newline+1);if(Buffer.byteLength(raw)>PLAYGROUND_LIMITS.requestBytes)throw new Error('Playground line limit exceeded');await line(raw);}if(Buffer.byteLength(pending)>PLAYGROUND_LIMITS.requestBytes)throw new Error('Playground line limit exceeded');}if(pending.trim())await line(pending);}
  finally{clearTimeout(timer);await playground.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))void playgroundMain().catch(error=>{process.stderr.write(JSON.stringify({level:'error',code:'PLAYGROUND_FAILED',message:error instanceof Error?error.message.slice(0,1024):'Playground failed'})+'\n');process.exitCode=1;});
