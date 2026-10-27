import { useEffect, useState } from 'react';
import type { SessionPlaybackSource } from '../../../../packages/engine/src/index.js';
import { recordingCommitment } from '../../../../packages/runner/src/recording-schema.js';
import { parseRecordingJson } from '../../../../packages/runner/src/strict-json.js';
import type { Recording } from '../../../../packages/contracts/src/index.js';
import { loadRecordingGallery, type GalleryEntry } from '../recordings/gallery.js';
import './gallery.css';
type Props = { canUse: boolean; onUse: (source: SessionPlaybackSource) => void; onInspect: (raw: string, trustedLiveSha256?: string) => void; onClose: () => void };
const labels = { live_model: 'Genuine model recording', fixture: 'Test fixture', scripted: 'Scripted demonstration' };
export function RecordingGallery({ canUse, onUse, onInspect, onClose }: Props) {
  const [entries, setEntries] = useState<GalleryEntry[] | null>(null), [error, setError] = useState('');
  useEffect(() => { let disposed = false; void loadRecordingGallery().then(items => { if (!disposed) setEntries(items); }).catch(reason => { if (!disposed) setError(reason instanceof Error ? reason.message : 'Gallery could not load.'); }); return () => { disposed = true; }; }, []);
  return <section className="recording-gallery" aria-labelledby="gallery-title"><header><div><h2 id="gallery-title">Recording gallery</h2><p>Owner-reviewed local assets. Recordings, fixtures and scripted demonstrations keep their own provenance.</p></div><button type="button" onClick={onClose}>Close gallery</button></header>
    {error && <p role="alert">Gallery unavailable: {error}</p>}{!entries && !error && <p role="status">Verifying recording assets and continuations…</p>}
    {entries && !entries.some(entry => entry.category === 'live_model' && entry.status === 'qualified') && <p className="gallery-empty">No qualified genuine model recording is currently available. Test fixtures and scripted demonstrations are not genuine model evidence.</p>}
    {!canUse && <p>A setup can be selected only before takeover. Inspection remains available.</p>}
    {entries?.length === 0 && <p>The owner gallery is empty.</p>}
    <ul>{entries?.map(entry => <li key={entry.id}><p className="gallery-category">{labels[entry.category]}</p><h3>{entry.title}</h3><p>{entry.description}</p><p>{entry.detail}</p><p className="gallery-hash">Recording SHA-256: {entry.recordingSha256}</p><div className="gallery-actions"><button type="button" disabled={entry.rawRecording === null} onClick={() => { if (entry.rawRecording !== null) onInspect(entry.rawRecording, entry.category === 'live_model' ? recordingCommitment(parseRecordingJson(entry.rawRecording) as Recording) : undefined); }}>Inspect {entry.title}</button><button type="button" disabled={!canUse || entry.playback === null} onClick={() => { if (canUse && entry.playback !== null) onUse(entry.playback); }}>Use {entry.title}</button></div></li>)}</ul>
  </section>;
}
