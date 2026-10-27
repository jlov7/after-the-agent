import { readFileSync, statSync } from 'node:fs';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { packetByteLimit } from './evidence-packet.js';
import { verifyEvidencePacket, type PacketVerification } from './verify-evidence-packet.js';

if (!isMainThread) {
  const input = workerData as { raw: string; request_id: string };
  parentPort!.postMessage(await verifyEvidencePacket(input.raw, input.request_id));
} else {
  const requestId = 'evidence.verify';
  const fail = (code: string, exitCode = 2) => {
    process.stdout.write(JSON.stringify({ request_id: requestId, status: exitCode === 3 ? 'incomplete' : 'invalid', error: { code }, note: 'Packet verification did not complete. No repair qualification or provenance is established.' }) + '\n'); process.exitCode = exitCode;
  };
  try {
    if (process.argv.length !== 3) throw new Error('USAGE');
    const file = process.argv[2]!, stat = statSync(file);
    if (!stat.isFile() || stat.size > packetByteLimit) throw new Error('INPUT_BOUND');
    const raw = readFileSync(file, 'utf8');
    const worker = new Worker(new URL(import.meta.url), { workerData: { raw, request_id: requestId }, resourceLimits: { maxOldGenerationSizeMb: 256 } });
    let complete = false;
    const timer = setTimeout(() => { if (!complete) { complete = true; void worker.terminate(); fail('VERIFICATION_TIME_LIMIT', 3); } }, 30000);
    worker.once('message', (result: PacketVerification) => {
      if (complete) return; complete = true; clearTimeout(timer); process.stdout.write(JSON.stringify(result) + '\n'); process.exitCode = result.status === 'reproduced' ? 0 : result.status === 'incomplete' ? 3 : 2; void worker.terminate();
    });
    worker.once('error', () => { if (!complete) { complete = true; clearTimeout(timer); fail('VERIFIER_WORKER_FAILED'); } });
    worker.once('exit', () => { if (!complete) { complete = true; clearTimeout(timer); fail('VERIFIER_WORKER_EXITED'); } });
  } catch { fail('INPUT_UNAVAILABLE_OR_INVALID'); }
}
