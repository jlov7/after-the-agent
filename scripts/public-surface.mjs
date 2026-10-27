import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const privatePath = /\/(?:Users|home)\/[^\s/]+\/|\/private\/var\/|\/var\/folders\/|file:\/\/\/|[A-Za-z]:\\Users\\/;
const credential = /\b(?:gh[pousr]_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{40,}|sk-proj-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16})\b|-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/;
const internalPath = /(^|\/)(?:\.agent|\.codex|\.claude|\.cursor|prompts|work|releases|node_modules|AGENTS\.md|CLAUDE\.md)(?:\/|$)|evidence\/quality\/reviews/;
const operationalPlanning = /(^|\/)(?:docs\/07_RESEARCH_LAUNCH\.md|research\/(?:LAUNCH_MATERIALS\.md|USABILITY_[^/]+|launch-config\.example\.json))$/;
const neutralEmail = 'noreply@example.invalid';
export function inspectPublicFile(path, bytes) {
  const findings = [];
  if (operationalPlanning.test(path)) findings.push({ path, kind: 'operational_planning_document' });
  if (internalPath.test(path)) findings.push({ path, kind: 'internal_or_generated_path' });
  if (privatePath.test(bytes.toString('utf8'))) findings.push({ path, kind: 'local_machine_path' });
  if (credential.test(bytes.toString('utf8'))) findings.push({ path, kind: 'credential_pattern' });
  if (bytes.length > 25 * 1024 * 1024) findings.push({ path, kind: 'unexpected_large_file' });
  return findings;
}
function git(root, args) {
  const result = spawnSync('git', ['-c', 'core.fsmonitor=false', '-C', root, ...args], { encoding: 'utf8', timeout: 30000, maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) throw new Error('Public source audit requires a readable local Git checkout');
  return result.stdout;
}
export function inspectPublicSource(root) {
  const paths = git(root, ['ls-files', '-z']).split('\0').filter(Boolean);
  if (!paths.length) throw new Error('Public source is empty');
  const findings = [];
  for (const path of paths) {
    const target = join(root, path);
    if (!lstatSync(target).isFile() || lstatSync(target).isSymbolicLink()) findings.push({ path, kind: 'non_regular_file' });
    else findings.push(...inspectPublicFile(path, readFileSync(target)));
  }
  const authors = git(root, ['log', '--all', '--format=%an%x00%ae%x00%cn%x00%ce']).trim().split('\n');
  for (const author of authors) {
    const [name, email, committer, committerEmail] = author.split('\0');
    const publicEmail = value => value === neutralEmail || value === 'noreply@github.com' || value?.endsWith('@users.noreply.github.com');
    if (!name || !committer || !publicEmail(email) || !publicEmail(committerEmail) || privatePath.test(author)) findings.push({ path: '<git-metadata>', kind: 'non_public_author_metadata' });
  }
  const objects = git(root, ['rev-list', '--objects', '--all']).trim().split('\n');
  for (const object of objects) {
    const [oid, ...parts] = object.split(' '), path = parts.join(' ');
    const kind = git(root, ['cat-file', '-t', oid]).trim();
    if (!['blob', 'commit', 'tag'].includes(kind)) continue;
    const bytes = Buffer.from(git(root, ['cat-file', '-p', oid]));
    findings.push(...inspectPublicFile(path || `<git-${kind}>`, bytes));
    if (kind !== 'blob') {
      const emails = bytes.toString('utf8').match(/[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
      if (emails.some(email => email !== neutralEmail && email !== 'noreply@github.com' && !email.endsWith('@users.noreply.github.com'))) findings.push({ path: `<git-${kind}>`, kind: 'private_contact_metadata' });
    }
  }
  return { scope: 'tracked_source_and_all_reachable_history', files: paths.length, commits: Number(git(root, ['rev-list', '--all', '--count']).trim()), findings };
}
export function inspectStatic(root) {
  const findings = []; let files = 0;
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) findings.push({ path: relative(root, path), kind: 'symlink' });
      else if (entry.isDirectory()) walk(path);
      else { files++; findings.push(...inspectPublicFile(relative(root, path), readFileSync(path))); }
    }
  }
  walk(root);
  if (!files) throw new Error('Static distribution is empty');
  return { scope: 'every_static_distribution_file', files, findings };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf('--static');
  const report = at >= 0 ? inspectStatic(resolve(process.argv[at + 1])) : inspectPublicSource(process.cwd());
  process.stdout.write(JSON.stringify({ event: 'public_surface_audit', ...report, status: report.findings.length ? 'failed' : 'passed' }) + '\n');
  process.exitCode = report.findings.length ? 1 : 0;
}
