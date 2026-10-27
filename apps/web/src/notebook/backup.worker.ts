import { openNotebook, parseNotebookBackup, type Bookmark } from './store.js';
import { notebookRequest } from './protocol.js';
let prepared: { id: string; entries: Bookmark[] } | null = null;
self.onmessage = async (event: MessageEvent<unknown>) => {
  const parsed = notebookRequest.safeParse(event.data); if (!parsed.success) return;
  const request = parsed.data;
  let store: Awaited<ReturnType<typeof openNotebook>> | undefined;
  try {
    if (request.type === 'preview') prepared = { id: request.id, entries: parseNotebookBackup(request.raw) };
    store = await openNotebook();
    if (request.type === 'backup') { prepared = null; self.postMessage({ id: request.id, error: null, preview: null, raw: await store.backup() }); return; }
    if (!prepared || request.type === 'commit' && request.preview_id !== prepared.id) throw new Error('Load a notebook backup before merging.');
    const preview = request.type === 'preview' ? await store.previewImport(prepared.entries) : await store.import(prepared.entries);
    if (request.type === 'commit') prepared = null;
    self.postMessage({ id: request.id, error: null, preview, raw: null });
  } catch (error) {
    prepared = null;
    self.postMessage({ id: request.id, error: (error instanceof Error ? error.message : 'Notebook operation failed').slice(0, 512), preview: null, raw: null });
  } finally { store?.close(); }
};
