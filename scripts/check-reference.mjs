import { verifyReferenceFiles } from '../packages/runner/src/reference-files.ts';
const result = verifyReferenceFiles(process.argv[2] ?? '.');
process.stdout.write(JSON.stringify({ event: 'reference_verified', ...result }) + '\n');
