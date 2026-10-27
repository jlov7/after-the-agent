import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
const pins = {
  'darwin-arm64': ['darwin_arm64', 'b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5'],
  'darwin-x64': ['darwin_x64', 'dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709'],
  'linux-x64': ['linux_x64', '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb'],
};
const version = '8.30.1';
const work = join(process.cwd(), 'work', 'tools');
mkdirSync(work, { recursive: true });
mkdirSync('evidence', { recursive: true });
const binary = process.env.GITLEAKS_BIN ?? join(work, 'gitleaks');
if (!existsSync(binary)) {
  const pin = pins[`${process.platform}-${process.arch}`];
  if (!pin) throw new Error('Pinned scanner is unavailable for this platform');
  const response = await fetch(`https://github.com/gitleaks/gitleaks/releases/download/v${version}/gitleaks_${version}_${pin[0]}.tar.gz`, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Official scanner download failed (${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== pin[1]) throw new Error('Scanner archive hash mismatch');
  const archive = join(work, 'gitleaks.tar.gz');
  writeFileSync(archive, bytes);
  const extracted = spawnSync('tar', ['-xzf', archive, '-C', work], { encoding: 'utf8', timeout: 10000 });
  if (extracted.status !== 0) throw new Error('Verified scanner archive could not be extracted');
}
const reported = spawnSync(binary, ['version'], { encoding: 'utf8', timeout: 10000 });
if (reported.status !== 0 || reported.stdout.trim() !== version) throw new Error('Scanner version does not match pinned release');
const scans = [];
for (const kind of ['git', 'dir']) {
  const report = `evidence/gitleaks-${kind}.json`;
  const args = [kind, '.', '--config', '.gitleaks.toml', '--redact=100', '--no-banner', '--no-color', '--timeout', '120', '--report-format', 'json', '--report-path', report];
  const started_at = new Date().toISOString();
  const result = spawnSync(binary, args, { encoding: 'utf8', timeout: 130000, maxBuffer: 8 * 1024 * 1024 });
  writeFileSync(`evidence/gitleaks-${kind}.log`, `${result.stdout ?? ''}${result.stderr ?? ''}`);
  const findings = existsSync(report) ? JSON.parse(readFileSync(report, 'utf8')) : null;
  scans.push({ kind, command: ['gitleaks', ...args], started_at, finished_at: new Date().toISOString(), exit_code: result.status, findings: findings?.length ?? null, report });
  if (result.status !== 0 || !Array.isArray(findings) || findings.length !== 0) {
    writeFileSync('evidence/secret-scan.json', JSON.stringify({ version, status: 'failed', scans }, null, 2) + '\n');
    throw new Error(`Secret scan ${kind} failed. Inspect its redacted receipt.`);
  }
}
writeFileSync('evidence/secret-scan.json', JSON.stringify({ version, status: 'passed', scans }, null, 2) + '\n');
process.stdout.write(JSON.stringify({ event: 'secret_scan_complete', version, scans: scans.length }) + '\n');
