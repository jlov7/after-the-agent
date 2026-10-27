import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createReplayClient } from '../replay/client.js';
import { startReplayNotesImport } from '../lab/client.js';
import { annotationAnchors, createReplayNotes, replayNotesByteLimit, type ReplayNotes } from '../../../../packages/runner/src/replay-annotations.js';
import type { ReplayFrame, ReplayInspectionSummary } from '../../../../packages/runner/src/replay-inspection.js';
import type { PacketInspectionSummary } from '../../../../packages/runner/src/packet-inspection.js';
import './replay.css';
interface ReplayViewerProps { remainingMs: number; initialRaw?: string; initialKind?: 'attempt' | 'recording' | 'packet'; trustedLiveSha256?: string; onClose: () => void }
export function ReplayViewer({ remainingMs, initialRaw, initialKind = 'attempt', trustedLiveSha256, onClose }: ReplayViewerProps) {
  const [client] = useState(() => createReplayClient());
  const generation = useRef(0), heading = useRef<HTMLHeadingElement>(null);
  const [kind, setKind] = useState(initialKind), [summary, setSummary] = useState<ReplayInspectionSummary | null>(null), [frame, setFrame] = useState<ReplayFrame | null>(null);
  const [pending, setPending] = useState(false), [status, setStatus] = useState('Choose an attempt download, resumable attempt or recording.'), [original, setOriginal] = useState<string | null>(null);
  const [packetRaw, setPacketRaw] = useState<string | null>(null), [packet, setPacket] = useState<PacketInspectionSummary | null>(null);
  const [notes, setNotes] = useState<ReplayNotes['notes']>([]), [noteText, setNoteText] = useState(''), [anchorIndex, setAnchorIndex] = useState(0), [notesPage, setNotesPage] = useState(0);
  const [notesStatus, setNotesStatus] = useState('Notes are local and unsaved until you download them.'), [importingNotes, setImportingNotes] = useState(false);
  const notesGeneration = useRef(0), notesOperation = useRef<{ cancel: () => void } | null>(null);
  useEffect(() => {
    notesGeneration.current++; notesOperation.current?.cancel(); notesOperation.current = null;
    setNotes([]); setNoteText(''); setAnchorIndex(0); setNotesPage(0); setImportingNotes(false); setNotesStatus('Notes are local and unsaved until you download them.');
    return () => { notesGeneration.current++; notesOperation.current?.cancel(); };
  }, [original]);
  const anchors = useMemo(() => original && frame ? annotationAnchors(original, frame) : [], [original, frame]);
  const anchorLabel = (anchor: typeof anchors[number]) => `Command ${anchor.position}${anchor.kind === 'command' ? '' : ` · ${anchor.kind} ${anchor.identifier}`}`;
  const saveNote = () => {
    if (original === null || !anchors[anchorIndex]) return;
    try {
      const saved = createReplayNotes(original, [...notes, { anchor: anchors[anchorIndex], text: noteText }]);
      setNotes(saved.notes); setNotesPage(Math.floor((saved.notes.length - 1) / 20)); setNoteText(''); setNotesStatus('Note added in memory. Download notes to keep it.');
    } catch { setNotesStatus('A note needs 1 to 2,000 characters; at most 256 notes are allowed.'); }
  };
  const downloadNotes = () => {
    if (original === null) return;
    const value = createReplayNotes(original, notes), url = URL.createObjectURL(new Blob([JSON.stringify(value)], { type: 'application/json' })), link = document.createElement('a');
    link.href = url; link.download = 'after-the-agent-replay-notes.json'; link.click(); URL.revokeObjectURL(url); setNotesStatus('Notes downloaded separately. The inspected source file is unchanged.');
  };
  const importNotes = async (file?: File) => {
    if (!file || original === null || summary === null) return;
    const current = ++notesGeneration.current; notesOperation.current?.cancel(); setImportingNotes(true); setNotesStatus('Validating source hash and every pinned position locally.');
    try {
      if (file.size > replayNotesByteLimit) throw new Error('Replay notes exceed 1 MiB');
      const raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer());
      if (current !== notesGeneration.current) return;
      const task = startReplayNotesImport(raw, original, summary.kind, trustedLiveSha256); notesOperation.current = task;
      const result = await task.promise;
      if (current === notesGeneration.current) { setNotes(result.notes); setNotesPage(0); setNotesStatus('Notes imported. Every pin matches this exact source file.'); }
    } catch (error) { if (current === notesGeneration.current) setNotesStatus(`Notes rejected: ${error instanceof Error ? error.message : 'invalid notes'}`); }
    finally { if (current === notesGeneration.current) { setImportingNotes(false); notesOperation.current = null; } }
  };
  const load = useCallback(async (raw: string, inputKind: 'attempt' | 'recording' | 'packet', trust?: string) => {
    const current = ++generation.current; setPending(true); setFrame(null); setSummary(null); setOriginal(null); setPacket(null); setPacketRaw(null); setStatus('Reconstructing commands locally…');
    try {
      const response = await client.load(raw, inputKind, trust);
      if (current !== generation.current) return;
      setSummary(response.summary); setFrame(response.frame); setOriginal(response.inspectedRaw ?? raw); setPacket(response.packet ?? null); setPacketRaw(inputKind === 'packet' ? raw : null); setStatus('Replay loaded. Navigation only changes this read-only view.');
    } catch (error) { if (current === generation.current) setStatus(`Replay unavailable: ${error instanceof Error ? error.message : 'inspection failed'}`); }
    finally { if (current === generation.current) setPending(false); }
  }, [client]);
  useEffect(() => { heading.current?.focus(); if (initialRaw !== undefined) void load(initialRaw, initialKind, trustedLiveSha256); return () => { generation.current++; client.dispose(); }; }, [client, initialRaw, initialKind, trustedLiveSha256, load]);
  const chooseFile = async (file?: File) => {
    if (!file) return;
    const current = ++generation.current; client.cancel(); setPending(true); setFrame(null); setSummary(null); setOriginal(null); setPacket(null); setPacketRaw(null); setStatus('Reading selected local file…');
    try {
      const limit = kind === 'packet' ? 32 : 8;
      if (file.size > limit * 1024 * 1024) throw new Error(`Replay input exceeds ${limit} MiB`);
      const raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer()); if (current === generation.current) await load(raw, kind);
    } catch (error) { if (current === generation.current) { setPending(false); setStatus(`Replay unavailable: ${error instanceof Error ? error.message : 'file could not be read'}`); } }
  };
  const seek = async (position: number) => {
    if (pending) return;
    const current = ++generation.current; setPending(true); setStatus(`Reconstructing command ${position}…`);
    try { const response = await client.seek(position); if (current === generation.current) { setAnchorIndex(0); setFrame(response.frame); setStatus('Replay position reconstructed. Your live deadline continues.'); } }
    catch (error) { if (current === generation.current) { setFrame(null); setSummary(null); setStatus(`Replay unavailable: ${error instanceof Error ? error.message : 'seek failed'}. Load the file again.`); } }
    finally { if (current === generation.current) setPending(false); }
  };
  const cancel = () => { generation.current++; client.cancel(); setPending(false); setFrame(null); setSummary(null); setOriginal(null); setPacket(null); setPacketRaw(null); setStatus('Replay inspection cancelled. Load a file to inspect again.'); };
  const close = () => { generation.current++; client.dispose(); onClose(); };
  const download = (embedded = false) => {
    if (original === null) return;
    const url = URL.createObjectURL(new Blob([embedded ? original : packetRaw ?? original], { type: 'application/json' })), anchor = document.createElement('a');
    anchor.href = url; anchor.download = `after-the-agent-inspected-${packetRaw && !embedded ? 'packet' : summary?.kind ?? 'evidence'}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section className="replay-viewer panel" aria-labelledby="replay-heading" aria-busy={pending}>
    <div className="replay-heading"><h2 id="replay-heading" tabIndex={-1} ref={heading}>Read-only replay</h2><button onClick={close}>Close replay</button></div>
    <p>Inspect a local file without replacing the active board. The live recovery deadline keeps counting: <strong>{Math.ceil(Math.max(0, remainingMs) / 1000)} seconds remaining</strong>.</p>
    <div className="replay-file-tools"><label className="field">Replay file type<select value={kind} onChange={event => setKind(event.target.value as typeof kind)}><option value="attempt">Attempt or resumable attempt</option><option value="recording">Recording</option><option value="packet">Complete verification packet</option></select></label><label className="file-label">Open replay file<input type="file" accept="application/json,.json" onChange={event => { void chooseFile(event.target.files?.[0]); event.target.value = ''; }}/></label>{pending && <button onClick={cancel}>Cancel replay operation</button>}</div>
    <p role="status">{status}</p>
    {summary && <><p><strong>{summary.label}</strong> · {summary.category} · Command replay: <strong>{summary.status}</strong>.</p><p className="hint">{summary.provenance}</p>{summary.deadline_at_ms !== null && <p>Original imported deadline: <time>{summary.deadline_at_ms} milliseconds since Unix epoch</time>. Inspection does not resume this attempt.</p>}<button onClick={() => download()} disabled={original === null}>Download inspected file</button>
      {packet && <section aria-label="Packet inspection"><h3>Complete verification packet</h3><p>Packet inventory: consistent · {packet.entries} embedded files · Declared build: {packet.declared_build ?? 'not supplied'}.</p><p>Playback source: {packet.playback_source === 'consistent' ? 'reconstructed and bound to this attempt' : packet.playback_source === 'missing' ? 'missing; this packet is incomplete' : 'not required by this attempt'}.</p><p>This view does not run Python or verify retained repair scores. Imported provenance remains unverified. Use <code>npm run evidence:verify</code> for independent submission verification.</p><p>Replay notes pin to the exact embedded attempt. Keep the complete packet separately.</p><button onClick={() => download(true)}>Download embedded attempt</button></section>}
      {summary.mismatches.length > 0 && <ul>{summary.mismatches.map((message, index) => <li key={index}>{message}</li>)}</ul>}
      {summary.diagnostic && <section aria-label="First replay divergence"><h3>First replay divergence</h3><p>{summary.diagnostic.command === null ? 'Recording state or events' : `Command ${summary.diagnostic.command}`} · <code>{summary.diagnostic.path}</code></p><dl><dt>Recorded</dt><dd><pre>{summary.diagnostic.recorded}</pre></dd><dt>Reconstructed</dt><dd><pre>{summary.diagnostic.reconstructed}</pre></dd></dl></section>}
    </>}
    {summary && frame && <><nav className="replay-navigation" aria-label="Replay command navigation"><button disabled={pending || frame.position === 0} onClick={() => void seek(0)}>Initial state</button><button disabled={pending || frame.position === 0} onClick={() => void seek(frame.position - 1)}>Previous command</button><button disabled={pending || frame.position === summary.commands} onClick={() => void seek(frame.position + 1)}>Next command</button><button disabled={pending || frame.position === summary.commands} onClick={() => void seek(summary.commands)}>Final state</button><label>Command {frame.position} of {summary.commands}<input aria-label="Replay command position" type="range" min="0" max={summary.commands} value={frame.position} disabled={pending || summary.commands === 0} onChange={event => void seek(Number(event.target.value))}/></label></nav>
      <section aria-label="Reconstructed board"><h3>Settled tick {frame.plant.tick}</h3><p>Scene {frame.plant.world.scene_id} · {frame.plant.world.active ? 'active' : 'inactive'} · version {frame.plant.world.epoch} · revision {frame.plant.revision}</p><p>Primary clock {frame.plant.config.clocks.primary ? 'on' : 'off'} · standby clock {frame.plant.config.clocks.shadow ? 'on' : 'off'} · gate {frame.plant.config.gate_mode} · guard {frame.plant.config.epoch_guard ? 'on' : 'off'}</p><p>Cached gate {frame.plant.gate_cache.active ? 'active' : 'inactive'} · cached version {frame.plant.gate_cache.epoch}</p><p>Actual delivered pulses: left {frame.pulses.left}, center {frame.pulses.center}, right {frame.pulses.right}.</p><h4>Pending queue ({frame.plant.queue.length})</h4>{frame.plant.queue.length ? <ul>{frame.plant.queue.map(job => <li key={job.id}><code>{job.id}</code> · {job.lamp} · due tick {job.due_tick} · queued version {job.enqueue_epoch}</li>)}</ul> : <p>No queued work.</p>}</section>
      {frame.command && <section aria-label="Reconstructed command"><h3>Command {frame.command.seq}: {frame.command.outcome}</h3><p>{frame.command.actor.role} · phase {frame.command.actor.phase} · elapsed {frame.command.elapsed_ms} milliseconds{frame.command.raw ? ' · rejected raw request' : ''}</p><pre>{frame.command.request}</pre>{frame.command.error && <p>{frame.command.error}</p>}<dl><dt>Recorded result SHA-256</dt><dd><code>{frame.result_sha256}</code></dd><dt>Reconstructed result SHA-256</dt><dd><code>{frame.reconstructed_result_sha256}</code></dd></dl></section>}
      <section aria-label="Replay notes" className="replay-notes"><h3>Replay notes</h3><p>Plain text, in memory only. Pins refer to this exact input file and command position. Case pins are available where a retained frozen check matches the reconstructed board. Notes do not alter the source or its evidence category.</p>
        <label className="field">Pin note to<select disabled={importingNotes} value={anchorIndex} onChange={event => setAnchorIndex(Number(event.target.value))}>{anchors.map((anchor, index) => <option key={index} value={index}>{anchorLabel(anchor)}</option>)}</select></label>
        <label className="field">Plain-text replay note<textarea disabled={importingNotes} maxLength={2000} value={noteText} onChange={event => setNoteText(event.target.value)}/></label><p>{noteText.length} of 2,000 characters. {notes.length} of 256 notes.</p><button disabled={importingNotes || pending || !noteText.length || notes.length >= 256} onClick={saveNote}>Add pinned note</button>
        <button disabled={importingNotes || notes.length === 0} onClick={downloadNotes}>Download replay notes</button><label className="file-label">Import replay notes<input type="file" accept="application/json,.json" disabled={importingNotes} onChange={event => { void importNotes(event.target.files?.[0]); event.target.value = ''; }}/></label>
        {importingNotes && <button onClick={() => { notesGeneration.current++; notesOperation.current?.cancel(); notesOperation.current = null; setImportingNotes(false); setNotesStatus('Notes import cancelled.'); }}>Cancel notes import</button>}
        <p role="status">{notesStatus}</p><ol start={notesPage * 20 + 1}>{notes.slice(notesPage * 20, notesPage * 20 + 20).map((note, localIndex) => <li key={notesPage * 20 + localIndex}><button disabled={pending} onClick={() => void seek(note.anchor.position)}>{anchorLabel(note.anchor)}</button><p className="replay-note-text">{note.text}</p><button disabled={importingNotes} onClick={() => { setNotes(previous => previous.filter((_, index) => index !== notesPage * 20 + localIndex)); setNotesPage(0); setNotesStatus('Note removed from memory. Download again to keep this version.'); }}>Remove note {notesPage * 20 + localIndex + 1}</button></li>)}</ol>
        {notes.length > 20 && <nav aria-label="Replay note pages"><button disabled={notesPage === 0} onClick={() => setNotesPage(page => page - 1)}>Previous notes</button><span>Page {notesPage + 1} of {Math.ceil(notes.length / 20)}</span><button disabled={(notesPage + 1) * 20 >= notes.length} onClick={() => setNotesPage(page => page + 1)}>Next notes</button></nav>}
      </section>
      <section aria-label="Reconstructed events"><h3>Actual events ({frame.event_count})</h3><p className="hint">{frame.event_count > frame.events.length ? `Showing the most recent ${frame.events.length} events. The input retains all commands needed to reconstruct the event history.` : 'All events through this command are shown.'}</p><ol className="replay-events">{frame.events.map(event => <li key={event.seq}><span>#{event.seq} · tick {event.tick} · {event.type}</span><details><summary>Event fields</summary><pre>{JSON.stringify(event, null, 2)}</pre></details></li>)}</ol></section>
    </>}
  </section>;
}
