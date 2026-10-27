import { useEffect, useRef, useState } from 'react';
import { openNotebook, notebookBackupByteLimit, type AttemptNotebookStore, type NotebookEntry, type NotebookImportPreview } from '../notebook/store.js';
import { createNotebookClient } from '../notebook/client.js';
import './notebook.css';
const optInKey = 'after-the-agent.notebook.enabled.v1';
type Props = { getCurrent: () => string; onRestore: (raw: string) => Promise<void>; onInspect: (raw: string) => void; onClose: () => void };
export function AttemptNotebook({ getCurrent, onRestore, onInspect, onClose }: Props) {
  const store = useRef<AttemptNotebookStore | null>(null), mounted = useRef(true);
  const [client] = useState(() => createNotebookClient());
  const operation = useRef(0);
  const [preview, setPreview] = useState<NotebookImportPreview | null>(null), [workerBusy, setWorkerBusy] = useState(false);
  const [enabled, setEnabled] = useState(false), [entries, setEntries] = useState<NotebookEntry[]>([]), [name, setName] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  useEffect(() => {
    let disposed = false; mounted.current = true;
    let optedIn = false; try { optedIn = localStorage.getItem(optInKey) === 'yes'; } catch { /* Explicit enable remains available when Web Storage is blocked. */ }
    if (optedIn) {
      setBusy(true);
      void openNotebook().then(async value => { if (disposed) { value.close(); return; } store.current = value; setEnabled(true); const items = await value.list(); if (!disposed) setEntries(items); }).catch(reason => { if (!disposed) setError(message(reason)); }).finally(() => { if (!disposed) setBusy(false); });
    }
    return () => { disposed = true; mounted.current = false; operation.current++; client.dispose(); store.current?.close(); store.current = null; };
  }, []);
  async function act(operation: () => Promise<void>) { setBusy(true); setError(''); setNotice(''); try { await operation(); } catch (reason) { setError(message(reason)); } finally { setBusy(false); } }
  async function enable() {
    const value = await openNotebook(); if (!mounted.current) { value.close(); return; } store.current = value; setEnabled(true); setEntries(await value.list());
    try { localStorage.setItem(optInKey, 'yes'); } catch { setNotice('Notebook enabled for this view. Browser settings prevent remembering your opt-in.'); }
  }
  async function save() {
    if (!store.current) throw new Error('Enable notebook storage first.');
    await store.current.save(name, getCurrent()); setEntries(await store.current.list()); setName(''); setNotice('Immutable bookmark saved on this browser. Its original deadline is unchanged.');
  }
  function download(entry: NotebookEntry) {
    if (entry.raw === null) return;
    const url = URL.createObjectURL(new Blob([entry.raw], { type: 'application/json' })), link = document.createElement('a');
    link.href = url; link.download = `after-the-agent-bookmark-${entry.id}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function backup() {
    const current = ++operation.current; setPreview(null); setWorkerBusy(true);
    try {
      const raw = await client.backup(); if (!mounted.current || current !== operation.current) return;
      const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' })), link = document.createElement('a');
      link.href = url; link.download = 'after-the-agent-notebook.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('Notebook backup downloaded with original names, dates and exact attempt bytes.');
    } finally { if (mounted.current && current === operation.current) setWorkerBusy(false); }
  }
  async function importBackup(file?: File) {
    if (!file) return;
    const current = ++operation.current; client.cancel(); setPreview(null); setWorkerBusy(true);
    try {
      if (file.size > notebookBackupByteLimit) throw new Error('Notebook backup exceeds 64 MiB plus 64 KiB of metadata.');
      const raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer());
      if (!mounted.current || current !== operation.current) return;
      const result = await client.preview(raw);
      if (mounted.current && current === operation.current) { setPreview(result); setNotice('Backup checked locally. Review the merge below. Nothing has been imported.'); }
    } finally { if (mounted.current && current === operation.current) setWorkerBusy(false); }
  }
  async function merge() {
    setPreview(null); setWorkerBusy(true);
    try {
      const result = await client.commit();
      if (mounted.current) setNotice(`${result.added} bookmarks added, ${result.duplicates} identical bookmarks skipped. No attempt was resumed. Original deadlines are unchanged.`);
    } finally {
      if (mounted.current) { setWorkerBusy(false); if (store.current) setEntries(await store.current.list()); }
    }
  }
  return <section className="attempt-notebook" aria-labelledby="notebook-title" aria-busy={busy}>
    <header><div><h2 id="notebook-title">Attempt notebook</h2><p>Private bookmarks stored only in this browser. Nothing is uploaded.</p></div><button type="button" onClick={onClose}>Close notebook</button></header>
    <p>Up to 20 immutable bookmarks, 32 MiB total and 8 MiB each. Export bookmarks before clearing browser data. Restoring keeps the original recovery deadline, including time spent away.</p>
    {!enabled ? <button type="button" disabled={busy} onClick={() => void act(enable)}>Enable notebook on this browser</button> : <>
      <form onSubmit={event => { event.preventDefault(); void act(save); }}><label>Bookmark name<input maxLength={80} value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label><button type="submit" disabled={busy || !name.trim()}>Save current attempt</button></form>
      <p>{entries.length} / 20 bookmarks · {(entries.reduce((sum, entry) => sum + entry.bytes, 0) / 1024 / 1024).toFixed(2)} / 32 MiB</p>
      <div className="notebook-actions"><button type="button" disabled={busy} onClick={() => void act(backup)}>Download notebook backup</button><label>Import notebook backup<input type="file" accept="application/json,.json" disabled={busy} onChange={event => { void act(() => importBackup(event.target.files?.[0])); event.target.value = ''; }}/></label></div>
      <p className="hint">A backup keeps bookmark names, dates and exact resumable bytes. Imported provenance is unverified. Preview and merge never open an attempt. A JSON backup can be larger than its 32 MiB raw contents because embedded strings are escaped.</p>
      {workerBusy && <button type="button" onClick={() => { operation.current++; client.cancel(); setPreview(null); setWorkerBusy(false); }}>Cancel notebook operation</button>}
      {preview && <section aria-label="Notebook import preview" className="notebook-preview"><h3>Review notebook merge</h3><p>{preview.added} new bookmarks, {preview.duplicates} identical bookmarks. After merging: {preview.total} / 20 bookmarks, {(preview.bytes / 1024 / 1024).toFixed(2)} / 32 MiB.</p><ul>{preview.names.map((value, index) => <li key={index}>{value}</li>)}</ul><p>Identical saved IDs are skipped. Conflicting IDs or a changed quota reject the entire merge. Existing bookmarks are retained.</p><button type="button" disabled={busy} onClick={() => void act(merge)}>Merge notebook backup</button><button type="button" disabled={busy} onClick={() => { client.cancel(); setPreview(null); setNotice('Import cancelled. No bookmarks were added.'); }}>Cancel notebook import</button></section>}
      {entries.length === 0 && <p>No bookmarks saved.</p>}
      <ul>{entries.map(entry => <li key={entry.id}><h3>{entry.name}</h3>{entry.status === 'ready' ? <><p><time dateTime={new Date(entry.createdAt).toISOString()}>{new Date(entry.createdAt).toLocaleString()}</time> · {(entry.bytes / 1024).toFixed(1)} KiB</p><p className="notebook-hash">SHA-256: {entry.sha256}</p></> : <p role="alert">Corrupt bookmark. Its saved bytes or commitment are invalid. Delete it to free storage.</p>}
        <div className="notebook-actions"><button type="button" disabled={busy || entry.raw === null} onClick={() => { if (entry.raw !== null) onInspect(entry.raw); }}>Inspect {entry.name}</button><button type="button" disabled={busy || entry.raw === null} onClick={() => download(entry)}>Export {entry.name}</button><button type="button" disabled={busy || entry.raw === null} onClick={() => void act(async () => { if (entry.raw !== null) { await onRestore(entry.raw); setNotice('Bookmark restored with its original deadline.'); } })}>Restore {entry.name}</button><button type="button" disabled={busy} onClick={() => void act(async () => { if (!store.current) throw new Error('Notebook is unavailable. Reopen it to try again.'); await store.current.remove(entry.id); setEntries(await store.current.list()); setNotice('Bookmark deleted.'); })}>Delete {entry.name}</button></div>
      </li>)}</ul>
    </>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
  </section>;
}
const message = (reason: unknown) => reason instanceof Error ? reason.message : 'Notebook operation failed. Download the resumable attempt instead.';
