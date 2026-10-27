import { expect,it } from 'vitest';
import fc from 'fast-check';
import { mkdir,writeFile } from 'node:fs/promises';
import type { Action,BoardRequest,BoardResult,Configuration,Job,Phase,World,FrozenCandidate,ContinuationCorpus,EvaluationResult } from '../../packages/contracts/src/index.js';
import { cloneEngine,createEngine,dispatch,scenarioSetup,setEnginePhase,snapshot } from '../../packages/engine/src/index.js';
import { createSession,restoreSession,saveSession,type ExtendedBoardSession } from '../../packages/engine/src/session.js';
const specification=scenarioSetup('stale-queue');
interface Model {tick:number;revision:number;config:Configuration;world:World;cache:{active:boolean;epoch:number};queue:Job[];phase:Phase;next:number;last:{request:BoardRequest;result:BoardResult}|null}
interface Real {engine:ReturnType<typeof createEngine>;negative:boolean}
function initial():{model:Model;real:Real}{return {model:{tick:0,revision:0,config:structuredClone(specification.config),world:{scene_id:'blue',active:true,epoch:1},cache:{active:true,epoch:1},queue:[],phase:'recovery',next:0,last:null},real:{engine:createEngine(specification),negative:false}};}
function compare(model:Model,real:Real){const plant=snapshot(real.engine);expect({tick:plant.tick,revision:plant.revision,config:plant.config,world:plant.world,cache:plant.gate_cache,queue:plant.queue}).toEqual({tick:model.tick,revision:model.revision,config:model.config,world:model.world,cache:model.cache,queue:model.queue});}
function apply(model:Model,action:Action):string[]{
  const pulses:string[]=[];
  if(action.type==='advance')for(let step=0;step<action.ticks;step++){
    model.tick++;if(model.tick===5)model.world={scene_id:'amber',active:true,epoch:2};
    if(model.tick%4===0){const ordinal=model.tick/4;for(const clock of ['primary','shadow'] as const)if(model.config.clocks[clock]&&(model.config.gate_mode==='live'?model.world.active:model.cache.active))for(const lamp of [...(ordinal%2?['left' as const]:['right' as const]),...(ordinal%4===0?['center' as const]:[])])model.queue.push({id:`${clock}.${model.tick}.${lamp}`,clock,enqueue_tick:model.tick,due_tick:model.tick+2,lamp,enqueue_epoch:model.world.epoch});}
    const due=model.queue.filter(job=>job.due_tick===model.tick);for(const job of due)if(!model.config.epoch_guard||job.enqueue_epoch===model.world.epoch)pulses.push(job.id);
    model.queue=model.queue.filter(job=>job.due_tick>model.tick);
  }
  else if(action.type==='set_clock')model.config.clocks[action.clock]=action.enabled;
  else if(action.type==='set_epoch_guard')model.config.epoch_guard=action.enabled;
  else if(action.type==='set_gate_mode')model.config.gate_mode=action.mode;
  else if(action.type==='refresh_gate')model.cache={active:model.world.active,epoch:model.world.epoch};
  else if(action.type==='drop_jobs')model.queue=model.queue.filter(job=>!action.job_ids.includes(job.id));
  model.queue.sort((a,b)=>a.due_tick-b.due_tick||a.id.localeCompare(b.id));model.revision++;return pulses.sort();
}
type Operation={kind:'action';action:Action}|{kind:'drop'}|{kind:'retry'}|{kind:'conflict'}|{kind:'stale'}|{kind:'phase';phase:Phase}|{kind:'restore'}|{kind:'reset'};
class EngineCommand implements fc.Command<Model,Real>{
  constructor(readonly op:Operation){}
  check(model:Readonly<Model>){return !['retry','conflict'].includes(this.op.kind)||model.last!==null;}
  run(model:Model,real:Real){
    const op=this.op;
    if(op.kind==='phase'){model.phase=op.phase;setEnginePhase(real.engine,op.phase);compare(model,real);return;}
    if(op.kind==='reset'){const fresh=initial();Object.assign(model,fresh.model);real.engine=fresh.real.engine;return;}
    if(op.kind==='restore'){const saved=snapshot(real.engine);real.engine=cloneEngine(real.negative?{...saved,queue:[]}:saved,specification.world);setEnginePhase(real.engine,model.phase);model.last=null;compare(model,real);return;}
    const actor={actor_id:'stateful-human',role:'human' as const,phase:model.phase};
    if(op.kind==='retry'||op.kind==='conflict'){
      const before=snapshot(real.engine),last=model.last!;const request=op.kind==='retry'?last.request:{...last.request,action:{type:'inspect' as const,target:'gate' as const}};
      if(op.kind==='conflict'&&JSON.stringify(request)===JSON.stringify(last.request))return;
      const result=dispatch(real.engine,request,actor);if(op.kind==='retry')expect(result).toEqual(last.result);else expect(result.error?.code).toBe('REQUEST_ID_CONFLICT');expect(snapshot(real.engine)).toEqual(before);compare(model,real);return;
    }
    const action:Action=op.kind==='drop'?{type:'drop_jobs',job_ids:[model.queue[0]?.id??'primary.4092.left']}:op.kind==='stale'?{type:'advance',ticks:1}:op.action;
    const request:BoardRequest={schema_version:'1.0',request_id:`sequence.${++model.next}`,expected_revision:op.kind==='stale'?model.revision+1:model.revision,action};
    const result=dispatch(real.engine,request,actor);let rejection:string|undefined;
    if(['submitted','timed_out','abandoned_reset'].includes(model.phase))rejection='PHASE_FORBIDDEN';
    else if(op.kind==='stale')rejection='REVISION_CONFLICT';
    else if(action.type==='drop_jobs'&&action.job_ids.some(id=>!model.queue.some(job=>job.id===id)))rejection='UNKNOWN_JOB';
    if(rejection)expect(result.error?.code).toBe(rejection);
    else{expect(result.outcome).toBe('accepted');expect(result.events.filter(event=>event.type==='pulse').map(event=>event.type==='pulse'?event.job_id:'').sort()).toEqual(apply(model,action));}
    model.last={request,result};compare(model,real);
  }
  toString(){return JSON.stringify(this.op);}
}
const edits=fc.oneof(fc.record({type:fc.constant('set_clock' as const),clock:fc.constantFrom('primary' as const,'shadow' as const),enabled:fc.boolean()}),fc.record({type:fc.constant('set_epoch_guard' as const),enabled:fc.boolean()}),fc.record({type:fc.constant('set_gate_mode' as const),mode:fc.constantFrom('live' as const,'cached' as const)}),fc.constant({type:'refresh_gate' as const}),fc.record({type:fc.constant('advance' as const),ticks:fc.integer({min:1,max:8})}));
const engineCommands=fc.commands([edits.map(action=>new EngineCommand({kind:'action',action})),fc.constantFrom('drop' as const,'retry' as const,'conflict' as const,'stale' as const,'restore' as const,'reset' as const).map(kind=>new EngineCommand({kind})),fc.constantFrom('recovery' as const,'submitted' as const,'timed_out' as const,'abandoned_reset' as const).map(phase=>new EngineCommand({kind:'phase',phase}))],{maxCommands:60,size:'large'});
it('seed 761903: generated clock edits, queue drops, retries, phase and clone sequences agree with independent state model',()=>{
  fc.assert(fc.property(engineCommands,commands=>fc.modelRun(initial,commands)),{seed:761903,numRuns:100});
});
const corpus=(candidate:FrozenCandidate):ContinuationCorpus=>({schema_version:'1.0',policy_version:'1.0.0',candidate_sha256:candidate.candidate_sha256,cases:[]});
const evaluator=async(candidate:FrozenCandidate):Promise<EvaluationResult>=>({status:'pass',candidate_sha256:candidate.candidate_sha256,cases:[],observations:[]});
interface SessionModel {phase:'setup'|'recovery'|'timed_out'|'submitted';now:number;deadline:number|null;identity:string}
interface SessionReal {session:ExtendedBoardSession}
class SessionCommand implements fc.AsyncCommand<SessionModel,SessionReal>{
  constructor(readonly kind:'start'|'step'|'edit'|'drop'|'restore'|'reset'|'expire'|'submit'|'pause',readonly amount=1){}
  check(){return true;}
  async run(model:SessionModel,real:SessionReal){
    const before=real.session.getView();
    if(this.kind==='start'){real.session.start();if(model.phase==='setup'){model.phase='recovery';model.deadline=model.now+300000;}}
    else if(this.kind==='restore'){const saved=saveSession(real.session);real.session.dispose();real.session=restoreSession(JSON.parse(JSON.stringify(saved)),evaluator,corpus,{now:()=>model.now});expect(saveSession(real.session).deadline_at_ms).toBe(model.deadline);expect(real.session.getView().plant).toEqual(before.plant);}
    else if(this.kind==='reset'){real.session.restart();expect(real.session.exportAttempt().previous_attempts).toContainEqual({attempt_id:model.identity,disposition:model.phase==='submitted'||model.phase==='timed_out'?model.phase:'abandoned_reset'});model.phase='setup';model.deadline=null;expect(real.session.getView().attempt_id).not.toBe(model.identity);model.identity=real.session.getView().attempt_id;}
    else if(this.kind==='expire'){model.now+=this.amount;if(model.phase==='recovery'&&model.deadline!==null&&model.now>model.deadline)model.phase='timed_out';real.session.getView();}
    else if(this.kind==='submit'){const result=await real.session.submit();if(model.phase==='recovery'){expect(result.status).toBe('pass');model.phase='submitted';}else expect(result.status).toBe('invalid');}
    else if(this.kind==='pause')real.session.pause();
    else{const result=this.kind==='step'?real.session.step():real.session.act(this.kind==='edit'?{type:'set_clock',clock:'primary',enabled:false}:{type:'drop_jobs',job_ids:[before.plant.queue[0]?.id??'primary.4092.left']});
      if(model.phase!=='recovery'){expect(result.outcome).toBe('rejected');expect(real.session.getView().plant).toEqual(before.plant);}
      else if(this.kind==='edit'){expect(result.outcome).toBe('accepted');expect(real.session.getView().plant.tick).toBe(before.plant.tick);expect(real.session.getView().plant.queue).toEqual(before.plant.queue);}
    }
    expect(real.session.getView().phase).toBe(model.phase);expect(real.session.getView().attempt_id).toBe(model.identity);expect(saveSession(real.session).deadline_at_ms).toBe(model.deadline);
  }
  toString(){return `${this.kind}(${this.amount})`;}
}
it('seed 761911: save/restore, phase transitions, reset dispositions and wall expiry preserve original attempt authority',async()=>{
  const commands=fc.commands([fc.constantFrom('start' as const,'step' as const,'edit' as const,'drop' as const,'restore' as const,'reset' as const,'submit' as const,'pause' as const).map(kind=>new SessionCommand(kind)),fc.integer({min:1,max:300001}).map(amount=>new SessionCommand('expire',amount))],{maxCommands:35,size:'large'});
  await fc.assert(fc.asyncProperty(commands,async sequence=>{const model:SessionModel={phase:'setup',now:1000,deadline:null,identity:''};const real={session:createSession({scenario:'stale-queue',mode:'local_rehearsal',now:()=>model.now},evaluator,corpus)};model.identity=real.session.getView().attempt_id;try{await fc.asyncModelRun(()=>({model,real}),sequence);}finally{real.session.dispose();}}),{seed:761911,numRuns:70});
});
it('named negative control clean-reset-on-clone is detected and shrunk to a reproducible pending-work sequence',async()=>{
  const commands=fc.commands([fc.integer({min:1,max:8}).map(ticks=>new EngineCommand({kind:'action',action:{type:'advance',ticks}})),fc.constant(new EngineCommand({kind:'restore'})),fc.boolean().map(enabled=>new EngineCommand({kind:'action',action:{type:'set_clock',clock:'shadow',enabled}}))],{maxCommands:25});
  const property=fc.property(commands,sequence=>fc.modelRun(()=>{const state=initial();state.real.negative=true;return state;},sequence));
  const result=fc.check(property,{seed:761921,numRuns:100});expect(result.failed).toBe(true);expect(result.numShrinks).toBeGreaterThan(0);expect(result.counterexamplePath).toEqual(expect.any(String));
  const minimized=result.counterexample?.[0];expect(minimized).toBeDefined();
  expect(()=>fc.modelRun(()=>{const state=initial();state.real.negative=true;return state;},minimized!)).toThrow();
  const receipt=JSON.stringify({negative_control:'clean-reset-on-clone',actual_product_defect:false,seed:result.seed,path:result.counterexamplePath,shrinks:result.numShrinks,minimized:String(result.counterexample?.[0]),reproduced:true,engine_sequences:{seed:761903,runs:100},session_sequences:{seed:761911,runs:70}},null,2)+'\n';
  for(const directory of ['work/full-tools','evidence/full-roadmap']){await mkdir(directory,{recursive:true});await writeFile(`${directory}/stateful-negative-control.json`,receipt);}
});
