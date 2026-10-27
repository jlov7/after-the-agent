import { z } from 'zod';
import { canonicalJson } from '../../../../packages/contracts/src/index.js';
import type { ExtendedBoardSession } from '../../../../packages/engine/src/index.js';
import { parseStrictJson } from '../../../../packages/runner/src/strict-json.js';
import { factualManifest } from './manifest.js';
const milliseconds = z.number().int().nonnegative();
const receiptSchema = z.object({
  schema_version: z.literal('1.0'), synthetic: z.literal(true), researchEligible: z.literal(false),
  condition: z.enum(['observation','precommitment']), scenario: z.enum(['stale-queue','duplicate-clock','cached-gate']),
  exposure_started_at: milliseconds, scheduled_handover_at: milliseconds,
  factual_payload_sha256: z.string().regex(/^[a-f0-9]{64}$/), handover_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  choices: z.array(z.string().max(2000).nullable()).length(3),
  timings: z.array(z.object({window:z.number().int().min(0).max(2),revealed_at:milliseconds,actual_elapsed_ms:milliseconds}).strict()).length(3),
  commands: z.array(z.unknown()).length(3),
}).strict();
export function restoreRehearsalReceipt(raw: string | null, session: ExtendedBoardSession, handoverAt: number | null) {
  if (!raw || raw.length > 2_000_000) throw new Error('Synthetic exposure receipt is unavailable');
  const receipt = receiptSchema.parse(parseStrictJson(raw)), view = session.getView(), manifest = factualManifest(view.scenario);
  if (view.mode !== 'local_rehearsal' || receipt.condition !== view.condition || receipt.scenario !== view.scenario || receipt.exposure_started_at + 135000 !== receipt.scheduled_handover_at || receipt.scheduled_handover_at !== handoverAt || receipt.factual_payload_sha256 !== manifest.factual_payload_sha256 || receipt.handover_sha256 !== manifest.handover_sha256 || canonicalJson(receipt.commands) !== canonicalJson(view.history.slice(0,3))) throw new Error('Synthetic receipt differs from the restored episode');
  for (const [index,timing] of receipt.timings.entries()) if (timing.window !== index || timing.revealed_at !== receipt.exposure_started_at + 25000 + index * 45000 || timing.actual_elapsed_ms < 25000 + index * 45000 || (index > 0 && timing.actual_elapsed_ms < receipt.timings[index - 1]!.actual_elapsed_ms)) throw new Error('Synthetic exposure timings are invalid');
  if (receipt.choices.some((choice,index) => choice !== null && !manifest.windows[index]!.alternatives.includes(choice))) throw new Error('Synthetic choices are invalid');
  const precommitments = session.exportAttempt().precommitments;
  if (receipt.condition === 'observation' ? receipt.choices.some(choice => choice !== null) || precommitments.length !== 0 : precommitments.length !== 3 || precommitments.some((item,index) => item.window !== index + 1 || item.response !== receipt.choices[index])) throw new Error('Synthetic choices differ from the accepted journal');
  return receipt;
}
