import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createBoardServer } from './server.js';
import { constructionSetup, createEngine, createScenario, dispatch, snapshot, setEnginePhase } from '../../engine/src/index.js';
import type { ActorContext, ScenarioFamily } from '../../contracts/src/index.js';
const args=process.argv.slice(2);
const families:readonly string[]=['valid-pending','stale-queue','duplicate-clock','cached-gate'];
let scenario:ScenarioFamily='stale-queue';let setup=false;let construction=false;let role:ActorContext['role']='human';
for(let index=0;index<args.length;index++){
  const arg=args[index];
  if(arg==='--scenario'){const value=args[++index];if(!value||!families.includes(value))throw new Error('Invalid host scenario');scenario=value as ScenarioFamily;}
  else if(arg==='--setup'){setup=true;role='assessed_agent';}
  else if(arg==='--construction')construction=true;
  else if(arg==='--assessed-agent')role='assessed_agent';
  else throw new Error('Unknown host option');
}
if(construction&&(!setup||scenario!=='stale-queue'))throw new Error('Construction requires the host stale-queue setup');
await serveStdio(()=>{
  const authored=createScenario(scenario);const engine=setup?createEngine(construction?constructionSetup():authored.setup):authored.engine;
  setEnginePhase(engine,setup?'setup':'recovery');
  const actor:ActorContext={actor_id:role==='human'?'local-human':'assessed-model',role,phase:setup?'setup':'recovery'};
  return createBoardServer(request=>{
    const result=dispatch(engine,request,actor);
    if(setup&&snapshot(engine).tick>=5)setEnginePhase(engine,'recovery');
    return result;
  });
},{transport:new StdioServerTransport(process.stdin,process.stdout,{maxBufferSize:1024*1024}),onerror:()=>{process.stderr.write(JSON.stringify({level:'error',code:'MCP_TRANSPORT_ERROR'})+'\n');}});
