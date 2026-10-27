import { expect,it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { spawnSync } from 'node:child_process';
import { openMcpPlayground } from '../../packages/runner/src/mcp-playground.js';
const inspect={schema_version:'1.0',request_id:'inspect',action:{type:'inspect',target:'board'}};
it('serializes requests through actual stdio and matches direct acceptance, retry, conflict and rejection',async()=>{
  const transport=new StdioClientTransport({command:process.execPath,args:['dist/packages/mcp/src/stdio.js'],stderr:'pipe'}),client=new Client({name:'direct-playground-test',version:'1.0'},{versionNegotiation:{mode:{pin:'2026-07-28'},probe:{timeoutMs:5000,maxRetries:0}}});
  const playground=await openMcpPlayground();
  const action={schema_version:'1.0',request_id:'edit',expected_revision:3,action:{type:'set_epoch_guard',enabled:true}};
  try{
    await client.connect(transport,{timeout:5000});
    const initial=await client.callTool({name:'board_action',arguments:inspect});
    const revision=(initial.structuredContent as {revision:number}).revision; action.expected_revision=revision;
    const requests=[inspect,action,action,{...action,request_id:'stale'},{...action,action:{type:'set_epoch_guard',enabled:false}}];
    const pending=requests.map(request=>playground.request(request));
    for(const [index,request] of requests.entries())expect((await pending[index]!).response).toEqual(await client.callTool({name:'board_action',arguments:request}));
    const results=await Promise.all(pending);expect(results[1]!.response).toMatchObject({structuredContent:{outcome:'accepted'}});expect(results[3]!.response).toMatchObject({structuredContent:{error:{code:'REVISION_CONFLICT'}}});expect(results[4]!.response).toMatchObject({structuredContent:{error:{code:'REQUEST_ID_CONFLICT'}}});
    for(const extra of [{actor:'controller'},{phase:'setup'},{world:{active:false}}])expect((await playground.request({...inspect,...extra})).status).toBe('tool_error');
    expect((await playground.request({...inspect,request_id:'still-alive'})).status).toBe('returned');
  }finally{await playground.close();await client.close();await transport.close();}
  await expect(playground.request(inspect)).rejects.toThrow(/closed/i);
});
it('CLI consumes canonical NDJSON, rejects malformed input, bounds session, and exits with its child',()=>{
  const result=spawnSync(process.execPath,['dist/packages/runner/src/mcp-playground.js'],{input:[JSON.stringify(inspect),'{bad',JSON.stringify({...inspect,actor:'controller'})].join('\n')+'\n',encoding:'utf8',timeout:15000});
  expect(result.status,result.stderr).toBe(0);const rows=result.stdout.trim().split('\n').map(line=>JSON.parse(line));expect(rows.map(row=>row.status)).toEqual(['returned','input_rejected','tool_error']);
  expect(spawnSync(process.execPath,['dist/packages/runner/src/mcp-playground.js','--help'],{encoding:'utf8'}).stdout).toContain('64');
});
it('rejects oversized requests and excess requests before forwarding',async()=>{
  const playground=await openMcpPlayground();try{
    await expect(playground.request({value:'x'.repeat(65537)})).rejects.toThrow(/limit/i);
    for(let index=0;index<64;index++)await playground.request({...inspect,request_id:`read.${index}`});
    await expect(playground.request(inspect)).rejects.toThrow(/limit/i);
  }finally{await playground.close();}
});
