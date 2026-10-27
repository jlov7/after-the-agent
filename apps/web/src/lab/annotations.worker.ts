import { z } from 'zod';
import { importReplayNotes } from '../../../../packages/runner/src/replay-annotations.js';
const requestSchema = z.object({ id: z.string().uuid(), raw: z.string().max(1024 * 1024), source: z.string().max(8 * 1024 * 1024), kind: z.enum(['attempt', 'recording']), trustedLiveSha256: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict();
self.onmessage = (event: MessageEvent<unknown>) => {
  const checked = requestSchema.safeParse(event.data); if (!checked.success) return;
  const request = checked.data;
  try { self.postMessage({ id: request.id, result: importReplayNotes(request.raw, request.source, request.kind, request.trustedLiveSha256 ? { trusted_live_sha256: request.trustedLiveSha256 } : {}), error: null }); }
  catch (error) { self.postMessage({ id: request.id, result: null, error: (error instanceof Error ? error.message : 'Notes import failed').slice(0, 512) }); }
};
