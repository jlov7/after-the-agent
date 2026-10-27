import { runRepairLab } from '../../../../packages/runner/src/repair-lab.js';
import { labRequest } from './protocol.js';
self.onmessage = async (event: MessageEvent<unknown>) => {
  const checked = labRequest.safeParse(event.data); if (!checked.success) return;
  const request = checked.data;
  try { self.postMessage({ id: request.id, result: await runRepairLab(request.base, request.edits, request.case_id), error: null }); }
  catch (error) { self.postMessage({ id: request.id, result: null, error: (error instanceof Error ? error.message : 'Lab failed').slice(0, 512) }); }
};
