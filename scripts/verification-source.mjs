import { spawnSync } from 'node:child_process';
export function assertCleanVerifiedSource(commit, root = process.cwd()) {
  const git = args => {
    const result = spawnSync('git', ['-c', 'core.fsmonitor=false', '-C', root, ...args], { encoding: 'utf8', timeout: 10000 });
    if (result.status !== 0) throw new Error('Could not establish verified source identity');
    return result.stdout;
  };
  if (git(['rev-parse', 'HEAD']).trim() !== commit) throw new Error('Source commit changed after verification');
  const paths = [...git(['diff', '--name-only', '-z', 'HEAD']).split('\0'), ...git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0')].filter(path => path && !path.startsWith('evidence/'));
  if (paths.length) throw new Error('Source changed after verification. Commit source changes and rerun the complete gate.');
}
