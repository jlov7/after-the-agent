import { expect, it } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { PUBLIC_PROTOCOL_SHA256, verifyReferenceFiles } from '../../packages/runner/src/reference-files.js';

const hash = (bytes: string) => createHash('sha256').update(bytes).digest('hex');
function retained() {
  mkdirSync('work', { recursive: true });
  const directory = mkdtempSync('work/reference-test-');
  const manifest = JSON.parse(readFileSync('REFERENCE_MANIFEST.json', 'utf8')) as { files: { path: string; sha256: string }[] };
  for (const path of ['REFERENCE_MANIFEST.json', ...manifest.files.map(file => file.path)]) {
    mkdirSync(dirname(join(directory, path)), { recursive: true }); copyFileSync(path, join(directory, path));
  }
  return { directory, manifest, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

it('accepts only the exact public protocol derivative and eighteen unchanged reference files', () => {
  const fixture = retained();
  try {
    const protocol = readFileSync('apps/web/public/docs/research-protocol.txt', 'utf8');
    expect(hash(protocol)).toBe(PUBLIC_PROTOCOL_SHA256);
    writeFileSync(join(fixture.directory, 'docs/06_RESEARCH_PROTOCOL.md'), protocol);
    fixture.manifest.files.find(file => file.path === 'docs/06_RESEARCH_PROTOCOL.md')!.sha256 = PUBLIC_PROTOCOL_SHA256;
    writeFileSync(join(fixture.directory, 'PUBLIC_REFERENCE_MANIFEST.json'), JSON.stringify(fixture.manifest, null, 2) + '\n');
    expect(verifyReferenceFiles(fixture.directory)).toMatchObject({ profile: 'public-1', identical_upstream_files: 18, protocol_derivative: true });
    writeFileSync(join(fixture.directory, 'oracle/reference.py'), 'changed behavior');
    expect(() => verifyReferenceFiles(fixture.directory)).toThrow('differs');
    fixture.manifest.files.find(file => file.path === 'oracle/reference.py')!.sha256 = hash('changed behavior');
    writeFileSync(join(fixture.directory, 'PUBLIC_REFERENCE_MANIFEST.json'), JSON.stringify(fixture.manifest, null, 2) + '\n');
    expect(() => verifyReferenceFiles(fixture.directory)).toThrow('Unknown public');
  } finally { fixture.cleanup(); }
});

it('rejects unknown profiles, missing references and reference symlinks', () => {
  const fixture = retained();
  try {
    // This works in both original and public source distributions.
    const protocol = readFileSync('apps/web/public/docs/research-protocol.txt', 'utf8');
    writeFileSync(join(fixture.directory, 'docs/06_RESEARCH_PROTOCOL.md'), protocol);
    fixture.manifest.files.find(file => file.path === 'docs/06_RESEARCH_PROTOCOL.md')!.sha256 = PUBLIC_PROTOCOL_SHA256;
    writeFileSync(join(fixture.directory, 'PUBLIC_REFERENCE_MANIFEST.json'), JSON.stringify(fixture.manifest, null, 2) + '\n');
    expect(() => verifyReferenceFiles(fixture.directory)).not.toThrow();
    rmSync(join(fixture.directory, 'fixtures/golden.json'));
    expect(() => verifyReferenceFiles(fixture.directory)).toThrow();
    symlinkSync(join(process.cwd(), 'fixtures/golden.json'), join(fixture.directory, 'fixtures/golden.json'));
    expect(() => verifyReferenceFiles(fixture.directory)).toThrow('outside');
    writeFileSync(join(fixture.directory, 'PUBLIC_REFERENCE_MANIFEST.json'), '{}');
    expect(() => verifyReferenceFiles(fixture.directory)).toThrow('Unknown public');
  } finally { fixture.cleanup(); }
});
