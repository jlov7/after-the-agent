import { z } from 'zod';
import { compileSchema } from '../../../../packages/contracts/src/index.js';
import type { ContinuationCorpus, FrozenCandidate } from '../../../../packages/contracts/src/index.js';
import { validateCorpus } from '../../../../packages/runner/src/continuations.js';
import type { ContinuationInspection } from '../../../../packages/runner/src/inspection-types.js';
import { recordingSchema } from '../../../../packages/runner/src/recording-schema.js';

export const continuationRequest = z.object({ id: z.string().uuid(), type: z.literal('inspect-continuation'), candidate: z.custom<FrozenCandidate>(), corpus: z.custom<ContinuationCorpus>(), case_id: z.string().min(1).max(64) }).strict().superRefine((request, context) => {
  try {
    validateCorpus(request.candidate, request.corpus);
    if (!request.corpus.cases.some(c => c.case_id === request.case_id)) throw new Error('Unknown continuation case');
  } catch { context.addIssue({ code: 'custom', message: 'Invalid continuation candidate, corpus or case' }); }
});
const object = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) });
const tick = { type: 'integer', minimum: 0, maximum: 4096 };
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$', minLength: 64, maxLength: 64 };
const counts = object(Object.fromEntries(['left', 'right', 'center'].map(lamp => [lamp, { type: 'integer', minimum: 0, maximum: 16384 }])));
const resultShape = compileSchema<ContinuationInspection>({ $schema: recordingSchema.$schema, $defs: recordingSchema.$defs, ...object({ candidate_sha256: hash, case_id: { type: 'string', minLength: 1, maxLength: 64 }, case_sha256: hash, first_mismatch_tick: { anyOf: [tick, { type: 'null' }] }, frames: { type: 'array', minItems: 1, maxItems: 67, items: object({ tick, plant: { $ref: '#/$defs/CanonicalPlant' }, events: recordingSchema.properties.events, expected: counts, observed: counts }) } }) });
export const continuationResponse = z.object({ id: z.string().uuid(), result: z.custom<ContinuationInspection>(value => resultShape(value).valid).nullable(), error: z.string().min(1).max(512).nullable() }).strict().refine(value => (value.result === null) !== (value.error === null));
