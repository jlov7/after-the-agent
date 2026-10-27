import { describe, expect, it } from 'vitest';
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

describe('offline release custody', () => {
  it('a worker-only change cannot reuse the active edition cache identity', () => {
    mkdirSync('work', { recursive: true });
    const directory = mkdtempSync(resolve('work/offline-build-'));
    try {
      for (const name of ['offline-build.ts', 'service-worker.js']) copyFileSync(`apps/web/${name}`, join(directory, name));
      for (const version of ['first', 'second']) {
        const output = join(directory, version); mkdirSync(output); writeFileSync(join(output, 'index.html'), '<!doctype html><title>Offline fixture</title>');
        if (version === 'second') appendFileSync(join(directory, 'service-worker.js'), '\n/* worker-only deployment */\n');
        const result = spawnSync(process.execPath, ['--input-type=module', '-e', `import(${JSON.stringify(join(directory, 'offline-build.ts'))}).then(module => module.writeOfflineEdition(${JSON.stringify(output)}, '/edition/'))`], { encoding: 'utf8' });
        expect(result.status, result.stderr).toBe(0);
      }
      const first = JSON.parse(readFileSync(join(directory, 'first/release-manifest.json'), 'utf8'));
      const second = JSON.parse(readFileSync(join(directory, 'second/release-manifest.json'), 'utf8'));
      expect(second.assets).toEqual(first.assets);
      expect(second.release_id).not.toBe(first.release_id);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
