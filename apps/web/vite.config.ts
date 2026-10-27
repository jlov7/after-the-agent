import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { licenseNotices } from './license-notices.js';
const inventory = (worker = false): Plugin => ({
  name: 'browser-dependency-boundary',
  generateBundle(_options, bundle) {
    const modules = [...new Set(Object.values(bundle).flatMap(chunk => chunk.type === 'chunk' ? Object.keys(chunk.modules) : []))].sort();
    const forbidden = modules.filter(id => /(?:node:|__vite-browser-external|packages\/mcp\/|(?:capture|evaluate)\.ts$|child_process|node_modules\/(?:fs|@modelcontextprotocol)\/)/.test(id));
    if (forbidden.length) this.error(`Forbidden browser dependency: ${forbidden.join(', ')}`);
    const workerName = modules.some(id => id.endsWith('/backup.worker.ts')) ? 'notebook-worker-dependency-inventory.json' : modules.some(id => id.endsWith('/repair.worker.ts')) ? 'lab-worker-dependency-inventory.json' : modules.some(id => id.endsWith('/annotations.worker.ts')) ? 'annotations-worker-dependency-inventory.json' : modules.some(id => id.endsWith('/replay.worker.ts')) ? 'replay-worker-dependency-inventory.json' : modules.some(id => id.endsWith('/continuation.worker.ts')) ? 'continuation-worker-dependency-inventory.json' : modules.some(id => id.endsWith('/inspection.worker.ts')) ? 'recording-worker-dependency-inventory.json' : 'worker-dependency-inventory.json';
    this.emitFile({ type: 'asset', fileName: worker ? workerName : 'dependency-inventory.json', source: JSON.stringify({ schema_version: '1.0', forbidden, modules: modules.map(id => id.replace(resolve('../..'), '<repo>').replace(/.*\/node_modules\//, 'node_modules/')) }, null, 2) });
    if (!worker) {
      for (const path of ['packages/engine/src/engine.ts','packages/engine/src/session.ts','packages/runner/src/evaluation-core.ts','packages/runner/src/reference-port.ts','apps/web/src/App.tsx','apps/web/src/recordings/curated.ts']) {
        this.emitFile({ type:'asset',fileName:`source/${path.split('/').at(-1)}.txt`,source:readFileSync(resolve('../..',path),'utf8') });
      }
    }
  },
});
export default defineConfig({ base: process.env.BASE || '/', plugins: [inventory(), licenseNotices()], worker: { plugins: () => [inventory(true)] }, build: { target: 'es2023' } });
