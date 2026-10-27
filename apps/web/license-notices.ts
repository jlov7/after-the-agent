import type { Plugin } from 'vite';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { writeOfflineEdition } from './offline-build.js';

export function licenseNotices(): Plugin {
  let base = '/';
  return {
    name: 'bundled-license-notices',
    apply: 'build',
    configResolved(config) { base = config.base; },
    closeBundle() {
      const output = resolve('dist'), root = resolve('../..');
      const inventories = ['dependency-inventory.json', 'worker-dependency-inventory.json', 'recording-worker-dependency-inventory.json', 'continuation-worker-dependency-inventory.json', 'replay-worker-dependency-inventory.json', 'lab-worker-dependency-inventory.json', 'annotations-worker-dependency-inventory.json'];
      const packages = new Set<string>();
      for (const file of inventories) {
        const inventory = JSON.parse(readFileSync(join(output, file), 'utf8')) as { modules: string[] };
        for (const module of inventory.modules) {
          const match = module.match(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)/);
          if (match) packages.add(match[1]!);
        }
      }
      const records = [...packages].sort().map(name => {
        const directory = join(root, 'node_modules', name);
        const metadata = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as { version: string; license: string };
        const files = readdirSync(directory).filter(file => /^(?:licen[cs]e|copying)(?:\..*)?$/i.test(file)).sort();
        if (!files.length) throw new Error(`Missing license notice for bundled dependency: ${name}`);
        const notices = files.map(file => readFileSync(join(directory, file), 'utf8')).join('\n');
        return { name, version: metadata.version, license: metadata.license, license_sha256: createHash('sha256').update(notices).digest('hex'), notices };
      });
      writeFileSync(join(output, 'THIRD_PARTY_NOTICES.txt'), 'Third-party code bundled with After the Agent\n\n' + records.map(record => `${record.name}@${record.version} (${record.license})\n${record.notices}`).join('\n\n'));
      writeFileSync(join(output, 'third-party-inventory.json'), JSON.stringify({ packages: records.map(record => ({ name: record.name, version: record.version, license: record.license, license_sha256: record.license_sha256 })) }, null, 2) + '\n');
      writeFileSync(join(output, 'LICENSE.txt'), readFileSync(join(root, 'LICENSE')));
      writeOfflineEdition(output, base);
    },
  };
}
