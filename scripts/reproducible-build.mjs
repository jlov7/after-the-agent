import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertCleanVerifiedSource } from './verification-source.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const retainedOnly = new Set(['evidence', 'verification', 'releases', 'work', '.agent', '.agents', '.codex', '.claude', 'prompts', 'AGENTS.md', 'CLAUDE.md', 'BUILD_REPORT.md']);
export function isBuildInput(path) {
  return path !== '' && !retainedOnly.has(path.split('/')[0]) && !path.split('/').some(part => part.startsWith('.env'));
}
export function assetInventory(directory) {
  const files = []; let total = 0;
  const walk = at => {
    for (const name of readdirSync(at).sort()) {
      const path = join(at, name), stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new Error('Distributable contains a symlink');
      if (stat.isDirectory()) walk(path);
      else if (stat.isFile()) {
        total += stat.size;
        if (files.length >= 32768 || total > 64 * 1024 * 1024) throw new Error('Distributable inventory exceeds limits');
        files.push({ path: relative(directory, path).split('\\').join('/'), bytes: stat.size, sha256: sha(readFileSync(path)) });
      } else throw new Error('Distributable contains a non-regular entry');
    }
  };
  walk(directory);
  if (!files.length) throw new Error('Distributable is empty');
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
export function compareInventories(before, after) {
  const left = new Map(before.map(item => [item.path, item])), right = new Map(after.map(item => [item.path, item]));
  return [...new Set([...left.keys(), ...right.keys()])].sort().flatMap(path => !right.has(path) ? [{ path, kind: 'missing' }] : !left.has(path) ? [{ path, kind: 'extra' }] : left.get(path).sha256 !== right.get(path).sha256 || left.get(path).bytes !== right.get(path).bytes ? [{ path, kind: 'different' }] : []);
}
export function reproducibleBuild(root = process.cwd()) {
  root = resolve(root); mkdirSync(join(root, 'evidence/twelve/reproducible'), { recursive: true }); mkdirSync(join(root, 'work'), { recursive: true });
  const evidence = join(root, 'evidence/twelve/reproducible'), commands = [], startedAt = new Date().toISOString();
  const git = args => {
    const result = spawnSync('git', ['-c', 'core.fsmonitor=false', '-C', root, ...args], { encoding: 'utf8', timeout: 30000, maxBuffer: 64 * 1024 * 1024 });
    if (result.status !== 0) throw new Error('Could not read committed build source');
    return result.stdout.trim();
  };
  const commit = git(['rev-parse', 'HEAD']); assertCleanVerifiedSource(commit, root);
  const metadata = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const npmVersion = spawnSync('npm', ['--version'], { encoding: 'utf8', timeout: 10000 }).stdout?.trim();
  if (Number(process.versions.node.split('.')[0]) !== 24 || metadata.packageManager !== `npm@${npmVersion}`) throw new Error('Reproducibility requires the declared Node24/npm toolchain');
  const scratch = mkdtempSync(join(root, 'work/repro-build-'));
  const inputs = { source_commit: commit, node: process.version, npm: npmVersion, lock_sha256: sha(readFileSync(join(root, 'package-lock.json'))), static_base: process.env.BASE ?? '/after-the-agent/', platform: process.platform, arch: process.arch, source_date_epoch: git(['show', '-s', '--format=%ct', 'HEAD']) };
  const env = { ...process.env, BASE: inputs.static_base, TZ: 'UTC', LC_ALL: 'C', SOURCE_DATE_EPOCH: inputs.source_date_epoch, npm_config_audit: 'false', npm_config_fund: 'false', npm_config_cache: join(root, 'work/npm-cache') };
  let failure = null, differences = [], control = null; const builds = [];
  const run = (name, executable, args, cwd, input) => {
    const result = spawnSync(executable, args, { cwd, env, input, timeout: 180000, maxBuffer: 64 * 1024 * 1024 });
    const stdout = name === 'source-archive' ? Buffer.from(`Captured committed source archive (${result.stdout?.length ?? 0} bytes).\n`) : result.stdout ?? Buffer.alloc(0);
    const log = `${name}.log`; writeFileSync(join(evidence, log), Buffer.concat([stdout, result.stderr ?? Buffer.alloc(0)]));
    commands.push({ name, exit_code: result.status, signal: result.signal, error: result.error?.message ?? null, log: `evidence/twelve/reproducible/${log}`, log_sha256: sha(readFileSync(join(evidence, log))) });
    if (result.status !== 0) throw new Error(`${name} failed`);
    return result.stdout;
  };
  try {
    // Only committed files enter the isolated builds. Never copy local environment files.
    const paths = git(['ls-files', '-z']).split('\0').filter(isBuildInput);
    inputs.build_input_paths = paths; inputs.build_input_paths_sha256 = sha(JSON.stringify(paths));
    const archive = run('source-archive', 'git', ['-c', 'core.fsmonitor=false', 'archive', '--format=tar', commit, '--', ...paths], root);
    for (const label of ['a', 'b']) {
      const directory = join(scratch, label); mkdirSync(directory);
      run(`${label}-extract`, 'tar', ['-xf', '-', '-C', directory], root, archive);
      run(`${label}-install`, 'npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], directory);
      run(`${label}-build`, 'npm', ['run', 'build'], directory);
      const output = join(directory, 'apps/web/dist'), assets = assetInventory(output), release = JSON.parse(readFileSync(join(output, 'release-manifest.json'), 'utf8'));
      builds.push({ name: label, inventory_sha256: sha(JSON.stringify(assets)), release_id: release.release_id, assets });
    }
    differences = compareInventories(builds[0].assets, builds[1].assets);
    if (differences.length || builds[0].release_id !== builds[1].release_id) throw new Error('Distributable builds differ');
    const target = join(scratch, 'b/apps/web/dist/index.html'), original = readFileSync(target);
    writeFileSync(target, Buffer.concat([original, Buffer.from('\n<!-- reproducibility negative control -->\n')]));
    const detected = compareInventories(builds[0].assets, assetInventory(join(scratch, 'b/apps/web/dist')));
    writeFileSync(target, original);
    if (detected.length !== 1 || detected[0].path !== 'index.html' || detected[0].kind !== 'different') throw new Error('Changed-content negative control was not detected');
    control = { mutant: 'changed-distributable-bytes', status: 'killed', differences: detected, original_restored: true };
    assertCleanVerifiedSource(commit, root);
  } catch (error) { failure = error instanceof Error ? error.message : 'Reproducibility check failed'; }
  finally { rmSync(scratch, { recursive: true, force: true }); }
  const receipt = { schema_version: '1.0', status: failure ? 'failed' : 'passed', started_at: startedAt, finished_at: new Date().toISOString(), inputs, commands, builds, differences, negative_control: control, scratch_removed: !existsSync(scratch), failure, claim_ceiling: 'Two clean builds of the named committed source under the recorded toolchain and platform. Byte equality is not model provenance, authorship or equivalence across untested environments.' };
  writeFileSync(join(evidence, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  return receipt;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const receipt = reproducibleBuild(); process.stdout.write(JSON.stringify({ event: 'reproducible_build_complete', status: receipt.status, differences: receipt.differences, evidence: 'evidence/twelve/reproducible/receipt.json' }) + '\n'); process.exitCode = receipt.status === 'passed' ? 0 : 1; }
  catch (error) { process.stderr.write(JSON.stringify({ event: 'reproducible_build_failed', request_id: 'reproducible-build', message: error instanceof Error ? error.message : 'Build check failed' }) + '\n'); process.exitCode = 1; }
}
