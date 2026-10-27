import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { referenceDirectory } from '../../packages/runner/src/reference-files.js';
export const reference = referenceDirectory();
export const manifestSha = '2a1e32b4cf42b1c94c802f9a1822d4878959f652a5afedb4b3cd52123184597f';
export function pythonBatch(input: unknown): ({status:'ok';result:Record<string,unknown>}|{status:'invalid';result?:never})[] {
  referenceDirectory();
  const cache = resolve('work/uv-cache'); mkdirSync(cache,{recursive:true});
  const program = `import sys,json\nsys.path.insert(0,sys.argv[1])\nfrom oracle.reference import expected_pulses,case_digest,evaluate_suite,evaluate_case,InvalidEvidence,_unique_object,_reject_json_number\nresults=[]\nfor item in json.load(sys.stdin):\n try:\n  op=item['op']\n  if op=='expected': result={'pulses':expected_pulses(item['case']),'digest':case_digest(item['case'])}\n  elif op=='case': result=evaluate_case(item['case'],item['observation'])\n  elif op=='raw': result=json.loads(item['raw'],object_pairs_hook=_unique_object,parse_float=_reject_json_number,parse_constant=_reject_json_number)\n  else: result=evaluate_suite(item['cases'],item['observations'])\n  results.append({'status':'ok','result':result})\n except (InvalidEvidence,ValueError,RecursionError) as error: results.append({'status':'invalid'})\nprint(json.dumps(results,separators=(',',':')))\n`;
  return JSON.parse(execFileSync('uv',['run','--no-project','python','-c',program,reference],{input:JSON.stringify(input),encoding:'utf8',timeout:15000,maxBuffer:8*1024*1024,env:{...process.env,UV_CACHE_DIR:cache}}));
}
