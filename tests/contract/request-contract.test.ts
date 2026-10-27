import { describe,it,expect } from 'vitest';
import { ContractError,validateRequest } from '../../packages/contracts/src/index.js';
const inspect={schema_version:'1.0',request_id:'inspect.1',action:{type:'inspect',target:'board'}};
describe('canonical BoardRequest boundary',()=>{
  it('allows read-only inspection without revision',()=>expect(validateRequest(inspect)).toEqual(inspect));
  it('requires mutation revision and rejects forged authority and malformed action values',()=>{
    const invalid=[
      {...inspect,action:{type:'set_clock',clock:'primary',enabled:true}},
      {...inspect,actor:'controller'},
      {...inspect,phase:'recovery'},
      {...inspect,expected_revision:0,action:{type:'advance',ticks:true}},
      {...inspect,expected_revision:0,action:{type:'advance',ticks:65}},
      {...inspect,expected_revision:0,action:{type:'drop_jobs',job_ids:['primary.4.left','primary.4.left']}},
      {...inspect,action:{type:'fix'}},
      {...inspect,action:{type:'inspect',target:'board',score:1}}
    ];
    for(const request of invalid) expect(()=>validateRequest(request)).toThrow(ContractError);
  });
  it('validates all seven action shapes without adding defaults or coercing inputs',()=>{
    const actions=[{type:'inspect',target:'queue'},{type:'set_clock',clock:'shadow',enabled:false},{type:'set_epoch_guard',enabled:true},{type:'set_gate_mode',mode:'cached'},{type:'refresh_gate'},{type:'drop_jobs',job_ids:['primary.4.left']},{type:'advance',ticks:64}];
    for(const action of actions){const request={...inspect,expected_revision:0,action};expect(validateRequest(request)).toEqual(request);}
    expect(()=>validateRequest({...inspect,expected_revision:'0',action:{type:'advance',ticks:'1'}})).toThrow(ContractError);
  });
});
