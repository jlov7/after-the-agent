import { z } from 'zod';
import { checkSavedAttemptSize } from './persistence.js';
import { parseStrictJson } from '../../../../packages/runner/src/strict-json.js';
import { saveSession, type ExtendedBoardSession } from '../../../../packages/engine/src/index.js';
const envelope = z.object({ format: z.literal('after-the-agent.resume'), version: z.literal('1.0'), session: z.unknown(), rehearsal_evidence: z.unknown().nullable() }).strict();
export const resumableAttempt = (session: ExtendedBoardSession, receipt: unknown) => ({ format: 'after-the-agent.resume', version: '1.0', session: saveSession(session), rehearsal_evidence: receipt });
export function serializeResumableAttempt(session: ExtendedBoardSession, receipt: unknown) {
  const raw = JSON.stringify(resumableAttempt(session, receipt)); checkSavedAttemptSize(raw); return raw;
}
export function parseResumableAttempt(raw: string) {
  checkSavedAttemptSize(raw);
  const parsed = envelope.safeParse(parseStrictJson(raw));
  if (!parsed.success) throw new Error('Use a Save progress to a file download. Evidence downloads and recordings have separate formats.');
  return parsed.data;
}
