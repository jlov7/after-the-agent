import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { compile } from 'json-schema-to-typescript';
for (const [file, name] of [['board','BoardRequest'],['evaluation','EvaluationRecord']]) {
  const schema = JSON.parse(await readFile(new URL('../contracts/'+file+'.schema.json',import.meta.url),'utf8'));
  await mkdir(new URL('../packages/contracts/src/generated/',import.meta.url),{recursive:true});
  await writeFile(new URL('../packages/contracts/src/generated/'+file+'.ts',import.meta.url),await compile(schema,name,{unreachableDefinitions:true,bannerComment:'/* Generated from contracts/'+file+'.schema.json. Run npm run generate:contracts. */'}));
}
