import { z } from 'zod';
import { sha256Text } from '../../../../packages/contracts/src/index.js';
import { parseResumableAttempt } from '../session/resumable.js';
import { packetJson } from '../../../../packages/runner/src/evidence-packet-json.js';

export const bookmarkByteLimit = 8 * 1024 * 1024;
export const notebookByteLimit = 32 * 1024 * 1024;
export const notebookEntryLimit = 20;
export const notebookBackupByteLimit = notebookByteLimit * 2 + 64 * 1024;
export const notebookDatabase = 'after-the-agent.notebook.v1';
const recordSchema = z.object({ id: z.string().uuid(), name: z.string().min(1).max(80), createdAt: z.number().int().nonnegative().max(8640000000000000), bytes: z.number().int().nonnegative().max(bookmarkByteLimit), sha256: z.string().regex(/^[a-f0-9]{64}$/), raw: z.string().max(bookmarkByteLimit) }).strict();
export type Bookmark = z.infer<typeof recordSchema>;
const backupSchema = z.object({ format: z.literal('after-the-agent-notebook'), version: z.literal('1.0'), entries: z.array(recordSchema).max(notebookEntryLimit) }).strict();
export interface NotebookImportPreview { added: number; duplicates: number; total: number; bytes: number; names: string[] }
export type NotebookEntry = { id: string; name: string; createdAt: number; bytes: number; sha256: string; raw: string | null; status: 'ready' | 'corrupt' };
export function prepareBookmark(name: string, raw: string): Readonly<Bookmark> {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > 80) throw new Error('Bookmark name must contain 1 to 80 characters.');
  const bytes = new TextEncoder().encode(raw).length;
  if (bytes > bookmarkByteLimit) throw new Error('Bookmark exceeds 8 MiB.');
  parseResumableAttempt(raw);
  return Object.freeze({ id: crypto.randomUUID(), name: trimmed, createdAt: Date.now(), bytes, sha256: sha256Text(raw), raw });
}
function validateBookmark(value: unknown): Bookmark {
  const item = recordSchema.parse(value);
  if (!item.name.trim() || new TextEncoder().encode(item.raw).length !== item.bytes || sha256Text(item.raw) !== item.sha256) throw new Error('Bookmark bytes or commitment differ. Nothing was imported.');
  parseResumableAttempt(item.raw); return item;
}
function validateBackupEntries(values: readonly unknown[]): Bookmark[] {
  if (values.length > notebookEntryLimit) throw new Error('Backup exceeds 20 bookmarks.');
  const entries = values.map(validateBookmark), ids = new Set(entries.map(item => item.id));
  if (ids.size !== entries.length) throw new Error('Backup contains duplicate bookmark IDs. Nothing was imported.');
  if (entries.reduce((sum, item) => sum + item.bytes, 0) > notebookByteLimit) throw new Error('Backup exceeds the 32 MiB raw quota.');
  return entries;
}
export function parseNotebookBackup(raw: string): Bookmark[] {
  return validateBackupEntries(backupSchema.parse(packetJson(raw, notebookBackupByteLimit)).entries);
}
export function createNotebookBackup(entries: readonly unknown[]): string {
  const raw = JSON.stringify({ format: 'after-the-agent-notebook', version: '1.0', entries: validateBackupEntries(entries).sort((a, b) => a.id.localeCompare(b.id)) });
  if (new TextEncoder().encode(raw).length > notebookBackupByteLimit) throw new Error('Notebook backup exceeds its file limit.');
  return raw;
}
export function planNotebookImport(existing: readonly unknown[], imported: readonly Bookmark[]): { additions: Bookmark[]; preview: NotebookImportPreview } {
  const records = existing.map(validateBookmark), incoming = validateBackupEntries(imported);
  const byId = new Map(records.map(item => [item.id, item]));
  const additions: Bookmark[] = []; let duplicates = 0;
  for (const item of incoming) {
    const same = byId.get(item.id);
    if (!same) additions.push(item);
    else if (same.name === item.name && same.createdAt === item.createdAt && same.bytes === item.bytes && same.sha256 === item.sha256 && same.raw === item.raw) duplicates++;
    else throw new Error('A bookmark ID conflicts with a different saved record. Nothing was imported.');
  }
  const total = records.length + additions.length, bytes = [...records, ...additions].reduce((sum, item) => sum + item.bytes, 0);
  if (total > notebookEntryLimit) throw new Error('Notebook is full (20 bookmarks). Nothing was imported.');
  if (bytes > notebookByteLimit) throw new Error('Notebook exceeds its 32 MiB quota. Nothing was imported.');
  return { additions, preview: { added: additions.length, duplicates, total, bytes, names: incoming.map(item => item.name) } };
}
function inspect(value: unknown): NotebookEntry {
  const parsed = recordSchema.safeParse(value);
  if (parsed.success) {
    const item = parsed.data;
    try {
      if (new TextEncoder().encode(item.raw).length !== item.bytes || sha256Text(item.raw) !== item.sha256) throw new Error('Commitment differs');
      parseResumableAttempt(item.raw); return { ...item, status: 'ready' };
    } catch { return { ...item, raw: null, status: 'corrupt' }; }
  }
  const item = value as Partial<Bookmark> | null;
  return { id: typeof item?.id === 'string' ? item.id : '', name: 'Corrupt bookmark', createdAt: 0, bytes: 0, sha256: '', raw: null, status: 'corrupt' };
}
const storageError = (error: DOMException | null) => new Error(error?.name === 'QuotaExceededError' ? 'Browser storage quota exceeded. Export or delete bookmarks and try again.' : 'Notebook storage is unavailable. Browser settings or another tab may be blocking it.');
export type AttemptNotebookStore = { list: () => Promise<NotebookEntry[]>; save: (name: string, raw: string) => Promise<void>; backup: () => Promise<string>; previewImport: (entries: readonly Bookmark[]) => Promise<NotebookImportPreview>; import: (entries: readonly Bookmark[]) => Promise<NotebookImportPreview>; remove: (id: string) => Promise<void>; close: () => void };
export function openNotebook(factory: IDBFactory | undefined = globalThis.indexedDB): Promise<AttemptNotebookStore> {
  return new Promise((resolve, reject) => {
    if (!factory) { reject(new Error('IndexedDB is unavailable. Use a resumable attempt download instead.')); return; }
    let request: IDBOpenDBRequest, finished = false;
    try { request = factory.open(notebookDatabase, 1); } catch { reject(storageError(null)); return; }
    const timeout = setTimeout(() => fail('Notebook storage did not open within 5 seconds. Close other tabs and try again.'), 5000);
    const fail = (message: string) => { if (finished) return; finished = true; clearTimeout(timeout); reject(new Error(message)); };
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('bookmarks')) request.result.createObjectStore('bookmarks', { keyPath: 'id' }); };
    request.onerror = () => fail(storageError(request.error).message);
    request.onblocked = () => fail('Notebook storage is blocked by another tab. Close that tab and try again.');
    request.onsuccess = () => {
      const db = request.result;
      if (finished) { db.close(); return; } finished = true; clearTimeout(timeout);
      db.onversionchange = () => db.close();
      const transaction = <T>(mode: IDBTransactionMode, action: (store: IDBObjectStore, set: (value: T) => void, fail: (message: string) => void) => void) => new Promise<T>((accept, decline) => {
        let tx: IDBTransaction, result: T, problem: string | null = null;
        try { tx = db.transaction('bookmarks', mode); } catch { decline(storageError(null)); return; }
        tx.oncomplete = () => accept(result);
        tx.onabort = () => decline(problem ? new Error(problem) : storageError(tx.error));
        tx.onerror = () => {};
        try { action(tx.objectStore('bookmarks'), value => { result = value; }, message => { problem = message; tx.abort(); }); } catch { tx.abort(); }
      });
      resolve({
        list: () => transaction('readonly', (store, set) => { const all = store.getAll(); all.onsuccess = () => set((all.result as unknown[]).map(inspect).sort((a, b) => b.createdAt - a.createdAt)); }),
        backup: () => transaction('readonly', (store, set, abort) => { const all = store.getAll(); all.onsuccess = () => { try { set(createNotebookBackup(all.result)); } catch { abort('Notebook contains an invalid record. Export valid bookmarks individually before resolving it.'); } }; }),
        previewImport: entries => transaction('readonly', (store, set, abort) => { const all = store.getAll(); all.onsuccess = () => { try { set(planNotebookImport(all.result, entries).preview); } catch (error) { abort(error instanceof Error ? error.message : 'Notebook preview unavailable.'); } }; }),
        import: entries => transaction('readwrite', (store, set, abort) => {
          const all = store.getAll();
          all.onsuccess = () => {
            try {
              // Recheck inside the write transaction. Another tab may have changed the notebook since preview.
              const plan = planNotebookImport(all.result, entries);
              for (const item of plan.additions) store.add(item);
              set(plan.preview);
            } catch (error) { abort(error instanceof Error ? error.message : 'Notebook import failed. Nothing was imported.'); }
          };
        }),
        save: async (name, raw) => {
          const item = prepareBookmark(name, raw);
          await transaction<void>('readwrite', (store, set, abort) => {
            const all = store.getAll();
            all.onsuccess = () => {
              const records = all.result as unknown[];
              const used = records.reduce<number>((total, value) => { const record = value as Partial<Bookmark> | null; return total + (typeof record?.raw === 'string' && record.raw.length <= bookmarkByteLimit ? new TextEncoder().encode(record.raw).length : notebookByteLimit); }, 0);
              if (records.length >= notebookEntryLimit) { abort('Notebook is full (20 bookmarks). Export or delete one first.'); return; }
              if (used + item.bytes > notebookByteLimit) { abort('Notebook exceeds its 32 MiB quota. Export or delete bookmarks first.'); return; }
              store.add(item); set(undefined);
            };
          });
        },
        remove: id => transaction<void>('readwrite', (store, set) => { store.delete(id); set(undefined); }),
        close: () => db.close(),
      });
    };
  });
}
