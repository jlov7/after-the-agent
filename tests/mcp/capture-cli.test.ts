import { expect,it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdir,mkdtemp,writeFile,readFile,readdir,cp,rm } from 'node:fs/promises';
import { join,resolve,dirname } from 'node:path';
import { fixtureCaptureConfig,type CaptureConfig } from '../../packages/runner/src/capture.js';
import { referenceDirectory } from '../../packages/runner/src/node.js';
const cli=resolve('dist/packages/runner/src/capture-cli.js');
const env={PATH:[dirname(process.execPath),process.env.PATH].filter(Boolean).join(':'),ATA_REFERENCE_DIR:referenceDirectory()};
async function scratch():Promise<string>{await mkdir('work/recordings',{recursive:true});return mkdtemp('work/recordings/cli-test-');}
function invoke(args:string[],cwd=process.cwd(),entry=cli){const result=spawnSync(process.execPath,[entry,...args],{cwd,env,encoding:'utf8',timeout:20000});return {...result,data:result.stdout.trim()?JSON.parse(result.stdout) as {status:string;reason:string}:null};}
const liveConfig=():CaptureConfig=>({...fixtureCaptureConfig,mode:'live',model:'synthetic-pinned-model',budget:{account:'synthetic-test',authorization:'Synthetic credential-free boundary test. No spending authorized.',approved_micro_usd:10,model:'synthetic-pinned-model',input_micro_usd_per_million:1000000,output_micro_usd_per_million:1000000,request_overhead_tokens:1024,verified_at:new Date().toISOString(),source:'https://developers.openai.com/api/docs/pricing',receipt_sha256:'0'.repeat(64)}});
it('actual dry-run CLI succeeds in fresh output and retains source preflight manifest',async()=>{
  const directory=await scratch(),output=join(directory,'capture');const result=invoke(['--dry-run','--output',output]);
  expect(result.status).toBe(0);expect(result.data?.status).toBe('passed');
  const recording=JSON.parse(await readFile(join(output,'recording.json'),'utf8')) as {manifest:{model_requests:number;category:string;application_commit:string;dirty:boolean}};
  expect(recording.manifest.model_requests).toBe(0);expect(recording.manifest.category).toBe('fixture');expect(recording.manifest.application_commit).toMatch(/^[a-f0-9]{40}$/);
  await cp(output,'evidence/recording-cli-fresh',{recursive:true});
});
it('actual CLI refuses nonempty output and preserves existing failed recording bytes',async()=>{
  const output=await scratch(),saved='retained failure receipt\n';await writeFile(join(output,'recording.json'),saved);
  const result=invoke(['--dry-run','--output',output]);expect(result.status).toBe(1);expect(result.data?.reason).toContain('Output directory must be fresh or empty');
  expect(await readFile(join(output,'recording.json'),'utf8')).toBe(saved);expect(await readdir(output)).toEqual(['recording.json']);
  await writeFile('evidence/recording-cli-custody.json',JSON.stringify({status:'passed',exit_code:result.status,receipt:result.data,existing_bytes_preserved:true,added_files:0},null,2)+'\n');
});
it('clean live CLI blocks without a key before creating output or dirtying source',async()=>{
  const directory=await scratch(),implementation=join(directory,'implementation');await mkdir(implementation);await cp('dist',join(implementation,'dist'),{recursive:true});
  for(const args of [['init','--quiet'],['add','-f','dist'],['-c','user.name=Capture test','-c','user.email=synthetic@example.invalid','-c','core.hooksPath=/dev/null','commit','--quiet','--no-gpg-sign','-m','test fixture']]){const git=spawnSync('git',args,{cwd:implementation,env,encoding:'utf8'});expect(git.status).toBe(0);}
  const config=join(directory,'live.json');await writeFile(config,JSON.stringify(liveConfig()));const output=join(implementation,'fresh-output');
  const result=invoke(['--live','--config',resolve(config),'--output',resolve(output)],resolve(implementation),resolve(implementation,'dist/packages/runner/src/capture-cli.js'));
  expect(result.status).toBe(1);expect(result.data?.reason).toContain('explicit provider key required');
  await writeFile('evidence/recording-cli-no-key.json',JSON.stringify({status:'passed',provider_requests:0,credentials_supplied:false,source:'synthetic isolated clean implementation fixture',exit_code:result.status,receipt:result.data},null,2)+'\n');
  expect(await readdir(implementation)).toEqual(expect.arrayContaining(['.git','dist']));expect(await readdir(implementation)).not.toContain('fresh-output');
  expect(spawnSync('git',['status','--porcelain'],{cwd:implementation,env,encoding:'utf8'}).stdout).toBe('');
  await rm(implementation,{recursive:true});
});
it('dirty source live CLI blocks before any capture writes, without credentials',async()=>{
  const directory=await scratch(),implementation=join(directory,'implementation'),config=join(directory,'live.json'),output=join(directory,'capture');await writeFile(config,JSON.stringify(liveConfig()));await mkdir(implementation);await cp('dist',join(implementation,'dist'),{recursive:true});
  for(const args of [['init','--quiet'],['add','-f','dist'],['-c','user.name=Capture test','-c','user.email=synthetic@example.invalid','-c','core.hooksPath=/dev/null','commit','--quiet','--no-gpg-sign','-m','test fixture']]){expect(spawnSync('git',args,{cwd:implementation,env,encoding:'utf8'}).status).toBe(0);}
  expect(spawnSync('git',['status','--porcelain'],{cwd:implementation,env,encoding:'utf8'}).stdout).toBe('');
  await writeFile(join(implementation,'dirty-source.txt'),'Synthetic dirty-source test marker.');
  try{const result=invoke(['--live','--config',resolve(config),'--output',resolve(output)],implementation,resolve(implementation,'dist/packages/runner/src/capture-cli.js'));expect(result.status).toBe(1);expect(result.data?.reason).toContain('dirty implementation');expect((await readdir(directory)).sort()).toEqual(['implementation','live.json']);await writeFile('evidence/recording-cli-dirty.json',JSON.stringify({status:'passed',exit_code:result.status,receipt:result.data,provider_requests:0,credentials_supplied:false,capture_writes:0,source:'synthetic isolated dirty implementation fixture'},null,2)+'\n');}
  finally{await rm(implementation,{recursive:true});}
});
