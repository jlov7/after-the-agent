import { expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

it('ships no local machine paths in directly served public assets', () => {
  const files: string[] = [];
  function visit(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path); else files.push(path);
    }
  }
  visit('apps/web/public');
  const findings = files.filter(path => /\/(?:Users|home)\/[^\s/]+\/|\/private\/var\/|file:\/\/\//.test(readFileSync(path).toString('utf8')));
  expect(findings).toEqual([]);
});
