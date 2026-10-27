import { randomUUID } from 'node:crypto';
import { runCodexCapture } from './codex-capture.js';
const args = process.argv.slice(2);
try {
  const construction = args[1] === '--construction';
  if (construction) args.splice(1, 1);
  if (args.length !== 3 || args[0] !== '--authorised-subscription' || args[1] !== '--output' || !args[2]) throw new Error('Use --authorised-subscription --output <fresh-directory> for an owner-authorised existing-subscription run');
  const control = new AbortController();
  process.once('SIGINT', () => control.abort()); process.once('SIGTERM', () => control.abort());
  const result = await runCodexCapture({ mode: 'live', construction, outputDir: args[2], signal: control.signal });
  process.stdout.write(JSON.stringify(result.status) + '\n'); process.exitCode = result.status.status === 'passed' ? 0 : 1;
} catch (error) { process.stdout.write(JSON.stringify({ status: 'blocked', request_id: randomUUID(), reason: error instanceof Error ? error.message : 'Capture preflight failed' }) + '\n'); process.exitCode = 1; }
