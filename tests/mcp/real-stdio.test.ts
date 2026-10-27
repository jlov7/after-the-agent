import { it,expect } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { boardSchema } from '../../packages/contracts/src/index.js';
import { mkdir,writeFile } from 'node:fs/promises';
import release from '../../package.json' with { type: 'json' };
it('initializes real compiled stdio, advertises canonical board_action, validates inspect and rejects forged actor',async()=>{
  const transport=new StdioClientTransport({command:process.execPath,args:['dist/packages/mcp/src/stdio.js','--setup'],cwd:process.cwd(),stderr:'pipe',maxBufferSize:1024*1024});
  const client=new Client({name:'ata-m0-smoke',version:'0.1.0'},{versionNegotiation:{mode:{pin:'2026-07-28'},probe:{timeoutMs:5000,maxRetries:0}}});
  let stderr=''; transport.stderr?.on('data',(chunk:Buffer)=>{stderr+=chunk.toString();if(stderr.length>65536)void transport.close();});
  try {
    await client.connect(transport,{timeout:5000});
    expect(client.getServerVersion()).toMatchObject({ name: 'after-the-agent', version: release.version });
    expect(client.getNegotiatedProtocolVersion()).toBe('2026-07-28');
    const tools=await client.listTools();expect(tools.tools.map(tool=>tool.name)).toEqual(['board_action']);
    expect(tools.tools[0]?.inputSchema).toEqual(boardSchema);
    const request={schema_version:'1.0',request_id:'stdio.inspect',action:{type:'inspect',target:'board'}};
    const result=await client.callTool({name:'board_action',arguments:request});
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({request_id:'stdio.inspect',outcome:'accepted',revision:0,observation:{plant:{tick:0,queue:[]}}});
    let rejected=false;try{const invalid=await client.callTool({name:'board_action',arguments:{...request,actor:'controller'}});rejected=invalid.isError===true;}catch{rejected=true;}expect(rejected).toBe(true);
    const mutation=await client.callTool({name:'board_action',arguments:{schema_version:'1.0',request_id:'pending.engine',expected_revision:0,action:{type:'advance',ticks:1}}});
    expect(mutation.structuredContent).toMatchObject({outcome:'accepted',revision:1});
    await mkdir('evidence',{recursive:true});await writeFile('evidence/recording-protocol.json',JSON.stringify({protocol:client.getNegotiatedProtocolVersion(),server:client.getServerVersion(),tool_schema_equal:true,inspect:result.structuredContent,malformed_rejected:rejected,engine:'actual deterministic dispatcher'},null,2)+'\n');
  } finally { await client.close();await transport.close(); }
  expect(stderr).toBe('');
});

it('supports SDK legacy initialization explicitly, without relabeling it as modern',async()=>{
  const transport=new StdioClientTransport({command:process.execPath,args:['dist/packages/mcp/src/stdio.js'],stderr:'pipe'});
  const client=new Client({name:'ata-legacy-smoke',version:'0.1.0'});
  try {await client.connect(transport,{timeout:5000});expect(client.getNegotiatedProtocolVersion()).toBe('2025-11-25');expect(client.getProtocolEra()).toBe('legacy');expect((await client.listTools()).tools.map(tool=>tool.name)).toEqual(['board_action']);}
  finally {await client.close();await transport.close();}
});
