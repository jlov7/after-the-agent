import { z } from 'zod';
import { notebookBackupByteLimit, notebookByteLimit, notebookEntryLimit } from './store.js';
const id = z.string().uuid();
export const notebookRequest = z.discriminatedUnion('type', [
  z.object({ id, type: z.literal('preview'), raw: z.string().max(notebookBackupByteLimit) }).strict(),
  z.object({ id, type: z.literal('commit'), preview_id: id }).strict(),
  z.object({ id, type: z.literal('backup') }).strict(),
]);
const count = z.number().int().nonnegative().max(notebookEntryLimit);
export const notebookPreview = z.object({ added: count, duplicates: count, total: count, bytes: z.number().int().nonnegative().max(notebookByteLimit), names: z.array(z.string().min(1).max(80)).max(notebookEntryLimit) }).strict().refine(value => value.added <= value.total && value.added + value.duplicates === value.names.length);
export const notebookResponse = z.object({ id, error: z.string().max(512).nullable(), preview: notebookPreview.nullable(), raw: z.string().max(notebookBackupByteLimit).nullable() }).strict();
