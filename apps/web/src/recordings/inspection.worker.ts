import { importRecording } from '../../../../packages/runner/src/recording-schema.js';
import { replay } from '../../../../packages/runner/src/replay.js';
import { inspectionRequest } from './inspection-schema.js';
self.onmessage = (event: MessageEvent<unknown>) => {
  const request = inspectionRequest.safeParse(event.data);
  if (!request.success) return;
  const { id, raw } = request.data;
  try {
    const recording = importRecording(raw), result = replay(recording);
    self.postMessage({ id, error: null, summary: { category: recording.manifest.category, run_id: recording.manifest.run_id, status: result.status, commands: recording.commands.length, events: result.events.length, tick: result.plant?.tick ?? null, queued: result.plant?.queue.length ?? null, pulses: result.events.filter(event => event.type === 'pulse').length, mismatches: result.mismatches.slice(0, 12).map(value => value.slice(0, 512)) } });
  } catch (error) { self.postMessage({ id, summary: null, error: (error instanceof Error ? error.message : 'Invalid recording').slice(0, 512) }); }
};
