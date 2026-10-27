import { useEffect, useRef, useState } from 'react';
import { probeBrowserReadiness, readinessDiagnostic, type ReadinessReport } from '../session/readiness.js';
import './browser-readiness.css';
const labels = { localStorage: 'Autosave storage', indexedDB: 'Notebook storage', worker: 'Local workers', serviceWorker: 'Offline support' } as const;
export function BrowserReadiness() {
  const [report, setReport] = useState<ReadinessReport | null>(null), [busy, setBusy] = useState(false), [status, setStatus] = useState(''), active = useRef<AbortController | null>(null);
  useEffect(() => () => { active.current?.abort(); }, []);
  const check = async () => {
    active.current?.abort(); const controller = new AbortController(); active.current = controller; setBusy(true); setStatus('Checking disposable local browser features.');
    try { const value = await probeBrowserReadiness(controller.signal); if (active.current === controller && !controller.signal.aborted) { setReport(value); setStatus('Checks finished. These local checks do not qualify usability or offline completeness.'); } }
    catch { if (!controller.signal.aborted) setStatus('Readiness checks are unavailable. Attempt downloads remain available.'); }
    finally { if (active.current === controller && !controller.signal.aborted) setBusy(false); }
  };
  const download = () => {
    if (!report) return; const url = URL.createObjectURL(new Blob([readinessDiagnostic(report)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'after-the-agent-browser-readiness.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section className="browser-readiness" aria-labelledby="browser-readiness-heading"><h3 id="browser-readiness-heading">Browser readiness</h3><p>Optional, disposable checks on this device. No network requests, installation or attempt data.</p><button type="button" disabled={busy} onClick={() => { void check(); }}>Check browser readiness</button>{busy && <button type="button" onClick={() => { active.current?.abort(); setBusy(false); setStatus('Checks cancelled.'); }}>Cancel readiness checks</button>}<p role="status">{status}</p>{report && <><dl>{(Object.keys(labels) as (keyof typeof labels)[]).map(key => <div key={key}><dt>{labels[key]}</dt><dd>{report[key].state}: {report[key].detail}</dd></div>)}</dl><button type="button" onClick={download}>Download browser diagnostic</button><p className="hint">Diagnostic contains feature statuses only.</p></>}</section>;
}
