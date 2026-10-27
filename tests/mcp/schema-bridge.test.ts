import { it,expect } from 'vitest';
import { boardInputSchema } from '../../packages/mcp/src/server.js';
import { validateRequest } from '../../packages/contracts/src/index.js';
it('uses canonical Ajv rules through SDK Standard Schema without coercion or defaults',async()=>{
  const base={schema_version:'1.0',request_id:'bridge.1',action:{type:'inspect',target:'board'}};
  const examples=[base,{...base,actor:'human'},{...base,action:{type:'advance',ticks:1}},{...base,expected_revision:0,action:{type:'advance',ticks:64}},{...base,expected_revision:0,action:{type:'advance',ticks:true}},{...base,expected_revision:0,action:{type:'advance',ticks:65}},{...base,expected_revision:0,action:{type:'drop_jobs',job_ids:['primary.4.left','primary.4.left']}},{...base,action:{type:'fix'}}];
  for(const value of examples){let valid=true;try{validateRequest(value);}catch{valid=false;}const result=await boardInputSchema['~standard'].validate(value);expect(result.issues===undefined).toBe(valid);if(!result.issues)expect(result.value).toEqual(value);}
});
