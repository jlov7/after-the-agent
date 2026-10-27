import { z } from 'zod';
export const inspectionRequest = z.object({ id: z.string().uuid(), raw: z.string().max(2_000_000) }).strict();
export const inspectionResponse = z.object({
  id: z.string().uuid(), error: z.string().max(512).nullable(),
  summary: z.object({ category: z.enum(['live_model', 'scripted', 'fixture']), run_id: z.string().max(64), status: z.enum(['verified', 'mismatch', 'invalid']), commands: z.number().int().nonnegative().max(10000), events: z.number().int().nonnegative().max(100000), tick: z.number().int().nonnegative().max(4096).nullable(), queued: z.number().int().nonnegative().max(128).nullable(), pulses: z.number().int().nonnegative().max(16384), mismatches: z.array(z.string().max(512)).max(12) }).strict().nullable(),
}).strict();
export type InspectionSummary = NonNullable<z.infer<typeof inspectionResponse>['summary']>;
