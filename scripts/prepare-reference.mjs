import { copyFileSync, existsSync, mkdirSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { verifyReferenceFiles } from '../packages/runner/src/reference-files.ts';
const source = realpathSync('.');
const target = resolve(process.argv[2] ?? '../after-the-agent-reference');
if (target === source || target.startsWith(source + sep) || existsSync(target)) throw new Error('Choose a new reference directory outside the source checkout. Existing reference bytes are never overwritten.');
const verified = verifyReferenceFiles(source);
mkdirSync(target, { recursive: true });
for (const path of ['REFERENCE_MANIFEST.json', ...(verified.profile === 'public-1' ? ['PUBLIC_REFERENCE_MANIFEST.json'] : []), ...verified.files.map(file => file.path)]) {
  mkdirSync(dirname(join(target, path)), { recursive: true });
  copyFileSync(join(source, path), join(target, path));
}
verifyReferenceFiles(target);
process.stdout.write(JSON.stringify({ event: 'reference_snapshot_created', profile: verified.profile, packaging_sha256: verified.packaging_sha256, files: verified.files.length, custody: 'Pinned reproducibility snapshot. Copying from source is not independent provenance.' }) + '\n');
