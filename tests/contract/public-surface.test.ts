import { expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
const { inspectPublicFile, inspectPublicSource } = await import(new URL('../../scripts/public-surface.mjs', import.meta.url).href);
it('rejects machine paths, internal files and credential patterns without echoing their values', () => {
  const machine = ['/', 'Users', '/synthetic-person/project/file.ts'].join('');
  expect(inspectPublicFile('docs/example.txt', Buffer.from(machine))).toEqual([{ path: 'docs/example.txt', kind: 'local_machine_path' }]);
  expect(inspectPublicFile(['.', 'agent/notes.md'].join(''), Buffer.from('internal'))).toHaveLength(1);
  const token = ['gh', 'p_', 'X'.repeat(40)].join('');
  expect(inspectPublicFile('example.json', Buffer.from(token))).toEqual([{ path: 'example.json', kind: 'credential_pattern' }]);
  expect(inspectPublicFile('README.md', Buffer.from('Local simulation. No account required.'))).toEqual([]);
});
it('rejects operational planning while retaining public scientific specifications', () => {
  for (const path of ['docs/07_RESEARCH_LAUNCH.md', 'research/LAUNCH_MATERIALS.md', 'research/USABILITY_EXERCISE.md', 'research/USABILITY_PARTICIPANT_CARD.md', 'research/USABILITY_OBSERVATION_TEMPLATE.json', 'research/launch-config.example.json']) {
    expect(inspectPublicFile(path, Buffer.from('Private operational preparation'))).toEqual([{ path, kind: 'operational_planning_document' }]);
  }
  expect(inspectPublicFile('docs/06_RESEARCH_PROTOCOL.md', Buffer.from('Frozen scientific specification'))).toEqual([]);
  expect(inspectPublicFile('research/power_budget.py', Buffer.from('Executable reference calculation'))).toEqual([]);
});
it('rejects planning left in reachable history after it is removed from the current tree', () => {
  mkdirSync('work', { recursive: true }); const root = mkdtempSync('work/public-history-');
  const git = (args: string[]) => {
    const result = spawnSync('git', ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TEMPLATE_DIR: '', GIT_AUTHOR_NAME: 'Synthetic test', GIT_AUTHOR_EMAIL: 'noreply@example.invalid', GIT_COMMITTER_NAME: 'Synthetic test', GIT_COMMITTER_EMAIL: 'noreply@example.invalid' } });
    expect(result.status).toBe(0); return result.stdout.trim();
  };
  try {
    git(['init', '--quiet']); mkdirSync(join(root, 'docs'));
    writeFileSync(join(root, 'README.md'), 'Public instrument');
    writeFileSync(join(root, 'docs/07_RESEARCH_LAUNCH.md'), 'Private operational preparation');
    git(['add', '.']); git(['commit', '--quiet', '--no-gpg-sign', '-m', 'synthetic initial source']);
    git(['rm', 'docs/07_RESEARCH_LAUNCH.md']); git(['commit', '--quiet', '--no-gpg-sign', '-m', 'remove planning from head']);
    expect(git(['ls-files'])).toBe('README.md');
    expect(inspectPublicSource(root).findings).toContainEqual({ path: 'docs/07_RESEARCH_LAUNCH.md', kind: 'operational_planning_document' });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
