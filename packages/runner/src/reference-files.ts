import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { z } from 'zod';

export const REFERENCE_MANIFEST_SHA256 = '2a1e32b4cf42b1c94c802f9a1822d4878959f652a5afedb4b3cd52123184597f';
export const PUBLIC_PACKAGING_SHA256 = 'b30d96406f0b7344e135bd4f09b70a29543ef3d4e2d6e23ed72d421e33e18901';
export const PUBLIC_PROTOCOL_SHA256 = '5327c740e874889648e985f1602eb22ce2ccbff0c8e2a996a7d6b0ab4e3dde6d';
const protocol = 'docs/06_RESEARCH_PROTOCOL.md';
const manifestSchema = z.object({ schema_version: z.literal('1.0'), reference_version: z.literal('1.0.0'), files: z.array(z.object({ path: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).length(19) }).strict();
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export function verifyReferenceFiles(directory: string) {
  const root = realpathSync(directory);
  const read = (path: string) => {
    if (!path || path.includes('\\') || path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid reference path');
    const target = join(root, path);
    if (lstatSync(target).isSymbolicLink() || !realpathSync(target).startsWith(root + sep)) throw new Error('Reference file resolves outside its retained root');
    return readFileSync(target);
  };
  const upstream = read('REFERENCE_MANIFEST.json');
  if (hash(upstream) !== REFERENCE_MANIFEST_SHA256) throw new Error('External reference manifest differs from pinned SHA-256');
  const original = manifestSchema.parse(JSON.parse(upstream.toString('utf8')));
  let profile: 'original' | 'public-1' = 'original';
  let selected = original;
  let packaging_sha256 = REFERENCE_MANIFEST_SHA256;
  let manifest_file = 'REFERENCE_MANIFEST.json';
  // The public profile changes attribution in one document, never executable truth.
  try { lstatSync(join(root, 'PUBLIC_REFERENCE_MANIFEST.json')); profile = 'public-1'; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (profile === 'public-1') {
    manifest_file = 'PUBLIC_REFERENCE_MANIFEST.json';
    const raw = read(manifest_file);
    if (hash(raw) !== PUBLIC_PACKAGING_SHA256) throw new Error('Unknown public reference packaging profile');
    selected = manifestSchema.parse(JSON.parse(raw.toString('utf8')));
    for (let i = 0; i < original.files.length; i++) {
      const entry = original.files[i]!, candidate = selected.files[i]!;
      if (candidate.path !== entry.path || candidate.sha256 !== (entry.path === protocol ? PUBLIC_PROTOCOL_SHA256 : entry.sha256)) throw new Error('Public reference changed more than the approved protocol attribution');
    }
    packaging_sha256 = PUBLIC_PACKAGING_SHA256;
  }
  for (const entry of selected.files) if (hash(read(entry.path)) !== entry.sha256) throw new Error(`External reference file differs from pinned manifest: ${entry.path}`);
  return { profile, manifest_file, upstream_manifest_sha256: REFERENCE_MANIFEST_SHA256, packaging_sha256, files: selected.files, identical_upstream_files: profile === 'original' ? 19 : 18, protocol_derivative: profile === 'public-1' };
}

export function referenceDirectory(): string {
  const directory = resolve(process.env.ATA_REFERENCE_DIR ?? '../after-the-agent-reference');
  verifyReferenceFiles(directory);
  return directory;
}
