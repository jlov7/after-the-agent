import { it,expect } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createScenario,dispatch,snapshot } from '../../packages/engine/src/index.js';
import type { BoardRequest } from '../../packages/contracts/src/index.js';
import { spawn } from 'node:child_process';
const connect=async(args:string[])=>{const transport=new StdioClientTransport({command:process.execPath,args:['dist/packages/mcp/src/stdio.js',...args],stderr:'pipe',maxBufferSize:1024*1024});const client=new Client({name:'parity',version:'0.1.0'},{versionNegotiation:{mode:{pin:'2026-07-28'},probe:{timeoutMs:3000,maxRetries:0}}});await client.connect(transport,{timeout:3000});return {client,transport};};
it('matches headless mutation/rejection/retry/conflict snapshots and exposes only fixed task info',async()=>{
  const {engine}=createScenario('duplicate-clock');const {client,transport}=await connect(['--scenario','duplicate-clock']);
  try {
    expect((await client.listTools()).tools.map(tool=>tool.name)).toEqual(['board_action']);
    expect((await client.listResources()).resources.map(resource=>resource.uri)).toEqual(['ata://board/info']);
    const info=await client.readResource({uri:'ata://board/info'});expect(JSON.stringify(info)).not.toContain('continuations');
    const revision=snapshot(engine).revision;
    const requests:BoardRequest[]=[
      {schema_version:'1.0',request_id:'initial',action:{type:'inspect',target:'queue'}},
      {schema_version:'1.0',request_id:'disable',expected_revision:revision,action:{type:'set_clock',clock:'primary',enabled:false}},
      {schema_version:'1.0',request_id:'drop',expected_revision:revision+1,action:{type:'drop_jobs',job_ids:['primary.4.left']}},
      {schema_version:'1.0',request_id:'advance',expected_revision:revision+2,action:{type:'advance',ticks:1}},
      {schema_version:'1.0',request_id:'stale',expected_revision:revision,action:{type:'refresh_gate'}},
      {schema_version:'1.0',request_id:'advance',expected_revision:revision+2,action:{type:'advance',ticks:1}},
      {schema_version:'1.0',request_id:'advance',expected_revision:revision+2,action:{type:'advance',ticks:2}},
      {schema_version:'1.0',request_id:'unknown-job',expected_revision:revision+3,action:{type:'drop_jobs',job_ids:['primary.4.center']}},
      {schema_version:'1.0',request_id:'final',action:{type:'inspect',target:'events'}}
    ];
    for(const request of requests){const expected=dispatch(engine,request,{actor_id:'local-human',role:'human',phase:'recovery'});const actual=await client.callTool({name:'board_action',arguments:{...request}});expect(actual.structuredContent).toEqual(expected);expect(actual.isError).toBe(expected.outcome==='rejected');}
    const malformed=[{schema_version:'1.0',request_id:'forge',actor:'controller',action:{type:'inspect',target:'board'}},{schema_version:'1.0',request_id:'unknown-action',action:{type:'set_score',score:1}},{schema_version:'1.0',request_id:'oversize'.repeat(8192),action:{type:'inspect',target:'board'}}];
    for(const arguments_ of malformed){let rejected=false;try{rejected=(await client.callTool({name:'board_action',arguments:arguments_})).isError===true;}catch{rejected=true;}expect(rejected).toBe(true);}
    const final=await client.callTool({name:'board_action',arguments:{schema_version:'1.0',request_id:'after-malformed',action:{type:'inspect',target:'board'}}});expect((final.structuredContent as {observation:{plant:unknown}}).observation.plant).toEqual(snapshot(engine));
  }finally{await client.close();await transport.close();}
});
it('rejects queued assessed requests and old accepted-ID retries after internal handover, plus atomic overshoot',async()=>{
  const {client,transport}=await connect(['--setup']);
  try {
    const overshoot=await client.callTool({name:'board_action',arguments:{schema_version:'1.0',request_id:'overshoot',expected_revision:0,action:{type:'advance',ticks:6}}});expect(overshoot.structuredContent).toMatchObject({outcome:'rejected',error:{code:'PHASE_FORBIDDEN'},observation:{plant:{tick:0,revision:0}}});
    const advance={schema_version:'1.0',request_id:'to-handover',expected_revision:0,action:{type:'advance',ticks:5}};
    expect((await client.callTool({name:'board_action',arguments:advance})).structuredContent).toMatchObject({outcome:'accepted',observation:{plant:{tick:5}}});
    for(const request of [advance,{schema_version:'1.0',request_id:'queued',expected_revision:1,action:{type:'set_clock',clock:'shadow',enabled:true}}])expect((await client.callTool({name:'board_action',arguments:request})).structuredContent).toMatchObject({outcome:'rejected',error:{code:'ACTOR_FORBIDDEN'},observation:{plant:{tick:5,revision:1}}});
  }finally{await client.close();await transport.close();}
});
it('closes bounded oversized protocol input without a false successful response',async()=>{
  const child=spawn(process.execPath,['dist/packages/mcp/src/stdio.js'],{stdio:['pipe','pipe','pipe']});let stdout='';let stderr='';child.stdout.on('data',chunk=>{stdout+=String(chunk);});child.stderr.on('data',chunk=>{stderr+=String(chunk);});child.stdin.on('error',()=>{});
  const ended=new Promise<void>(resolve=>child.once('exit',()=>resolve()));const timer=setTimeout(()=>child.kill('SIGKILL'),3000);
  try{child.stdin.end('x'.repeat(1024*1024+1));await ended;expect(stdout).not.toContain('accepted');expect(stderr).toContain('MCP_TRANSPORT_ERROR');}finally{clearTimeout(timer);if(child.exitCode===null)child.kill('SIGKILL');}
});
