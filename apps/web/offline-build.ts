import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function writeOfflineEdition(output: string, base: string) {
  if (!base.startsWith('/') || !base.endsWith('/') || base.includes('..')) throw new Error('Offline edition requires an absolute local base path ending in /.');
  const assets: { path: string; sha256: string; bytes: number }[] = [];
  const walk = (directory: string, prefix = '') => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = prefix + entry.name;
      if (entry.isDirectory()) walk(join(directory, entry.name), path + '/');
      else if (entry.isFile() && !['sw.js', 'release-manifest.json'].includes(path)) {
        const contents = readFileSync(join(directory, entry.name));
        assets.push({ path, sha256: createHash('sha256').update(contents).digest('hex'), bytes: contents.length });
      }
    }
  };
  walk(output); assets.sort((a, b) => a.path.localeCompare(b.path));
  if (assets.reduce((sum, asset) => sum + asset.bytes, 0) > 64 * 1024 * 1024) throw new Error('Offline edition exceeds 64 MiB.');
  const source = readFileSync(new URL('./service-worker.js', import.meta.url), 'utf8');
  const workerSha256 = createHash('sha256').update(source).digest('hex');
  const release = { schema_version: '1.0', release_id: createHash('sha256').update(JSON.stringify({ base, assets, workerSha256 })).digest('hex'), service_worker_sha256: workerSha256, assets };
  writeFileSync(join(output, 'release-manifest.json'), JSON.stringify(release, null, 2) + '\n');
  writeFileSync(join(output, 'sw.js'), source.replace('/* OFFLINE_RELEASE */ null', JSON.stringify(release)).replace('/* OFFLINE_BASE */ null', JSON.stringify(base)));
}
