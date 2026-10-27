import { expect, it } from 'vitest';
import { candidate } from './candidate.js';
import { createSession, compactAttemptExport } from '../../packages/engine/src/session.js';
import { buildCorpus } from '../../packages/runner/src/continuations.js';
import { evaluateCandidate } from '../../packages/runner/src/evaluate-browser.js';
import { createEvidenceReport } from '../../packages/runner/src/evidence-report.js';
const attempt=()=>{const session=createSession({scenario:'stale-queue',now:()=>100},evaluateCandidate,buildCorpus);session.start(); const result=compactAttemptExport(session);session.dispose();return result;};
it('escapes untrusted labels and retains initial state, commitments and truthful category/research limits',()=>{
 const input=attempt(), dangerous='<script src="https://evil.invalid/x">alert(1)</script>';
 const html=createEvidenceReport({...input,attempt_id:dangerous,provenance:{...input.provenance,model:dangerous},precommitments:[{window:1,response:dangerous,at_ms:100}]});
 expect(html).toContain('&lt;script'); expect(html).not.toContain('<script');
 expect(html).toContain("default-src &#39;none&#39;"); expect(html).toContain('@media print');
 expect(html).toContain('Initial state'); expect(html).toContain('Source commitments');
 expect(html).toContain('scripted'); expect(html).toContain('researchEligible: false');
 expect(html).toContain('not a study result'); expect(html).toContain(input.commands[0]!.result_sha256);
 expect(html).not.toMatch(/<(?:iframe|img|link|script)\b/i);
});
it('limits displayed edits and fields with an explicit full-JSON notice',()=>{
 const input=attempt(), command=input.commands[0]!;
 const html=createEvidenceReport({...input,commands:Array.from({length:503},(_,i)=>({...command,seq:i+1})),precommitments:[{window:1,response:'x'.repeat(20000),at_ms:1}]});
 expect(html.match(/data-command-row/g)).toHaveLength(500);
 expect(html).toContain('500 of 503'); expect(html).toContain('Full JSON');
 expect(html).not.toContain('x'.repeat(10000)); expect(html).toContain('[truncated]');
});

it('keeps retained counterexamples visible even when observations exceed display limits',async()=>{
 const input=attempt(),c=candidate('duplicate-clock'),corpus=buildCorpus(c),evaluation=await evaluateCandidate(c,corpus);
 expect(JSON.stringify(evaluation.observations).length).toBeGreaterThan(6000);
 const html=createEvidenceReport({...input,evaluation,submissions:[{candidate:c,corpus,evaluation,admitted_at_ms:100}]});
 expect(html).toContain('quiet-prefix');expect(html).toContain('&quot;missing&quot;');
});
it.each(['fixture','live_model'] as const)('retains the %s category without asserting model provenance',category=>{
 const input=attempt(),html=createEvidenceReport({...input,provenance:{...input.provenance,category}});
 expect(html).toContain('Recording category: '+category);
 expect(html).toContain(category==='fixture'?'Fixture evidence. No actual model use is established.':'Imported labels and hashes alone do not establish genuine model origin.');
});
