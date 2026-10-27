import { readFileSync, statSync } from 'node:fs';
import { validateReproducer } from './diagnostic.js';
import { runReference } from './evaluate.js';
import { expectedPulses } from './reference-port.js';
import { parseStrictJson } from './strict-json.js';

try {
 if(process.argv.length!==3)throw new TypeError('Usage: node dist/packages/runner/src/reproduce-cli.js file.json');
 const path=process.argv[2]!;
 if(!statSync(path).isFile()||statSync(path).size>8*1024*1024)throw new TypeError('Diagnostic input must be a file at most 8 MiB');
 const input=validateReproducer(parseStrictJson(readFileSync(path,'utf8')));
 const result=runReference([input.case],[input.observation]);
 if(result.exit_code===2&&'error' in result.verdict&&result.verdict.detail==='cases: suite must include at least one required pulse'&&expectedPulses(input.case).length===0){
  process.stdout.write(JSON.stringify({status:'reproduced_engine_only',scope:'one-case-diagnostic',repair_qualified:false,case_id:input.case.case_id,candidate_sha256:input.candidate.candidate_sha256,engine_verdict:input.expected_verdict,oracle_exit_code:2,oracle_status:'unavailable_no_liveness',oracle_error:result.verdict,note:'Exact engine observation reproduced. The preserved suite oracle requires a case with at least one required pulse. No independent oracle verdict or twelve-case repair qualification is claimed.'})+'\n');
 }else{
 if(result.exit_code===2||'error' in result.verdict)throw new TypeError('Independent oracle rejected diagnostic evidence');
 if(result.verdict.passed!==(input.expected_verdict==='pass'))throw new TypeError('Independent oracle did not reproduce the retained verdict');
 process.stdout.write(JSON.stringify({status:'reproduced',scope:'one-case-diagnostic',repair_qualified:false,case_id:input.case.case_id,candidate_sha256:input.candidate.candidate_sha256,oracle_exit_code:result.exit_code,verdict:result.verdict,note:'Diagnostic excerpt only. One case does not qualify a repair against all twelve continuations.'})+'\n');
 }
} catch(error) {
 process.stderr.write(JSON.stringify({status:'invalid',scope:'one-case-diagnostic',repair_qualified:false,error:(error instanceof Error?error.message:'Diagnostic failed').slice(0,500)})+'\n');
 process.exitCode=2;
}
