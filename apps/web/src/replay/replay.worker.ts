import { createReplayInspection, type ReplayInspection } from '../../../../packages/runner/src/replay-inspection.js';
import { replayWorkerRequest } from './protocol.js';
import { inspectPacket } from '../../../../packages/runner/src/packet-inspection.js';
let inspection: ReplayInspection | null = null;
self.onmessage = (event: MessageEvent<unknown>) => {
  const request = replayWorkerRequest.safeParse(event.data);
  if (!request.success) return;
  const value = request.data;
  try {
    let packet: ReturnType<typeof inspectPacket> | undefined;
    if (value.type === 'load') {
      inspection = null;
      if (value.kind === 'packet') packet = inspectPacket(value.raw);
      inspection = createReplayInspection(packet?.attempt ?? value.raw, value.kind === 'packet' ? 'attempt' : value.kind, value.trustedLiveSha256 ? { trusted_live_sha256: value.trustedLiveSha256 } : {});
    }
    if (!inspection) throw new Error('Load an attempt or recording before seeking');
    const position = value.type === 'load' ? 0 : value.position;
    self.postMessage({ id: value.id, error: null, summary: inspection.summary, frame: inspection.frame(position), ...(packet ? { packet: packet.summary, inspectedRaw: packet.attempt } : {}) });
  } catch (error) {
    inspection = null;
    self.postMessage({ id: value.id, error: (error instanceof Error ? error.message : 'Replay inspection failed').slice(0, 512), summary: null, frame: null });
  }
};
