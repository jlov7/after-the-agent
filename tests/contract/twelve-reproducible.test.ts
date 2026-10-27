import { expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const { assetInventory, compareInventories } = await import(new URL('../../scripts/reproducible-build.mjs', import.meta.url).href);

it('pins local workspace dependencies to the checked workspace versions for a fresh install', () => {
  const paths = ['apps/web', 'packages/contracts', 'packages/engine', 'packages/runner', 'packages/mcp'];
  const manifests = paths.map(path => JSON.parse(readFileSync(join(path, 'package.json'), 'utf8')));
  const versions = new Map(manifests.map(pkg => [pkg.name, pkg.version]));
  for (const pkg of manifests) for (const [name, version] of Object.entries(pkg.dependencies ?? {})) if (versions.has(name)) expect(version, `${pkg.name} -> ${name}`).toBe(versions.get(name));
});

it('builds committed source without re-archiving retained releases, evidence, private instructions or environment files', async () => {
  const { isBuildInput } = await import(new URL('../../scripts/reproducible-build.mjs', import.meta.url).href);
  for (const path of ['apps/web/src/App.tsx', 'packages/engine/src/engine.ts', 'package-lock.json', 'LICENSE', 'docs/01_PRODUCT_SPEC.md', 'REFERENCE_MANIFEST.json']) expect(isBuildInput(path), path).toBe(true);
  for (const path of ['evidence/run.json', 'verification/commands/log.txt', 'releases/old.zip', '.agent/PROGRESS.md', 'prompts/CODEX_START.md', 'AGENTS.md', 'BUILD_REPORT.md', '.env', 'apps/web/.env.local']) expect(isBuildInput(path), path).toBe(false);
});

it('detects changed bytes, missing and extra assets rather than trusting one build manifest', () => {
  mkdirSync('work', { recursive: true });
  const scratch = mkdtempSync('work/repro-control-');
  const left = join(scratch, 'a'), right = join(scratch, 'b');
  mkdirSync(left); mkdirSync(right);
  try {
    for (const directory of [left, right]) { mkdirSync(join(directory, 'assets')); writeFileSync(join(directory, 'index.html'), '<p>actual build</p>'); writeFileSync(join(directory, 'assets/app.js'), 'export const value=1;'); }
    const original = assetInventory(left);
    expect(compareInventories(original, assetInventory(right))).toEqual([]);
    writeFileSync(join(right, 'assets/app.js'), 'export const value=2;');
    writeFileSync(join(right, 'unexpected.txt'), 'extra');
    rmSync(join(right, 'index.html'));
    expect(compareInventories(original, assetInventory(right))).toEqual([
      { path: 'assets/app.js', kind: 'different' }, { path: 'index.html', kind: 'missing' }, { path: 'unexpected.txt', kind: 'extra' },
    ]);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
