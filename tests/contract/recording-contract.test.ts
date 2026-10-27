import { authoredRecording } from '../replay/fixture.js';
import { it,expect } from 'vitest';
import { importRecording,recordingCommitment } from '../../packages/runner/src/recording-schema.js';
it('rejects executable/prototype/version/oversized and incomplete recording imports',()=>{
  for(const raw of ['{"schema_version":"9.0"}','{"schema_version":"1.0","score":true}','{"__proto__":{"polluted":true}}','{"schema_version":"1.0","schema_version":"1.0"}',' '.repeat(8*1024*1024+1)])expect(()=>importRecording(raw)).toThrow();
});

it('allows fractional manifest cost in a synthetic trust-boundary test while other numbers stay strict',()=>{
  const fixture=authoredRecording();const synthetic={...fixture,manifest:{...fixture.manifest,category:'live_model' as const,provider:'openai',requested_model:'test-model-id',returned_model:'test-model-id',unavailable_reason:null,model_requests:1,dirty:false,cost_usd:0.01}};
  const trust={trusted_live_sha256:recordingCommitment(synthetic)};
  expect(importRecording(JSON.stringify(synthetic),trust).manifest.cost_usd).toBe(0.01);
  expect(()=>importRecording(JSON.stringify(synthetic))).toThrow();
  const fractional=structuredClone(synthetic);fractional.commands=[{...fractional.commands[0]!,elapsed_ms:0.01}];
  expect(()=>importRecording(JSON.stringify(fractional),{trusted_live_sha256:recordingCommitment(fractional)})).toThrow();
});
