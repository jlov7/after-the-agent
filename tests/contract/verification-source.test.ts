import { it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
const { assertCleanVerifiedSource } = await import(new URL('../../scripts/verification-source.mjs', import.meta.url).href);
it('rejects edited, untracked and newly committed source while allowing regenerated local evidence', () => {
  mkdirSync('work', { recursive: true }); const root = mkdtempSync('work/source-guard-');
  const git = (args: string[]) => { const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Synthetic test', GIT_AUTHOR_EMAIL: 'synthetic@example.invalid', GIT_COMMITTER_NAME: 'Synthetic test', GIT_COMMITTER_EMAIL: 'synthetic@example.invalid' } }); expect(result.status).toBe(0); return result.stdout.trim(); };
  try {
    git(['init', '--quiet']); writeFileSync(join(root, 'source.txt'), 'original'); git(['add', '.']); git(['commit', '--quiet', '--no-gpg-sign', '-m', 'synthetic fixture']); const commit = git(['rev-parse', 'HEAD']);
    expect(() => assertCleanVerifiedSource(commit, root)).not.toThrow();
    mkdirSync(join(root, 'evidence')); writeFileSync(join(root, 'evidence/result.json'), '{}'); expect(() => assertCleanVerifiedSource(commit, root)).not.toThrow();
    writeFileSync(join(root, 'source.txt'), 'edited'); expect(() => assertCleanVerifiedSource(commit, root)).toThrow('Source changed'); writeFileSync(join(root, 'source.txt'), 'original');
    writeFileSync(join(root, 'new-source.ts'), 'changed'); expect(() => assertCleanVerifiedSource(commit, root)).toThrow('Source changed');
    git(['add', 'new-source.ts']); git(['commit', '--quiet', '--no-gpg-sign', '-m', 'synthetic source change']); expect(() => assertCleanVerifiedSource(commit, root)).toThrow('commit changed');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
