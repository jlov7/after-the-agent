import { useEffect, useRef, useState } from 'react';
import './offline.css';
import { auditOfflineCache, describeOfflineAudit, repairOfflineCache } from './audit.js';

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
const timeout = 30000;
function waitForActivation(registration: ServiceWorkerRegistration, previous: ServiceWorker | null): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('Offline installation timed out. Retry when connected.')), timeout);
    const check = () => { if (registration.active && navigator.serviceWorker.controller && navigator.serviceWorker.controller !== previous) finish(); };
    const finish = (error?: Error) => { clearTimeout(timer); navigator.serviceWorker.removeEventListener('controllerchange', check); if (error) reject(error); else resolve(); };
    navigator.serviceWorker.addEventListener('controllerchange', check); check();
  });
}
function waitForInstall(registration: ServiceWorkerRegistration): Promise<ServiceWorker | null> {
  if (registration.waiting) return Promise.resolve(registration.waiting);
  const worker = registration.installing;
  if (!worker) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('Offline installation timed out. Retry when connected.')), timeout);
    const changed = () => { if (worker.state === 'installed' || worker.state === 'activated') finish(); else if (worker.state === 'redundant') finish(new Error('Offline assets could not be verified. Retry when connected.')); };
    const finish = (error?: Error) => { clearTimeout(timer); worker.removeEventListener('statechange', changed); if (error) reject(error); else resolve(registration.waiting); };
    worker.addEventListener('statechange', changed); changed();
  });
}
export function OfflineControls({ canUpdate, onBusy }: { canUpdate: boolean; onBusy: (busy: boolean) => void }) {
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [status, setStatus] = useState('');
  const [auditing, setAuditing] = useState(false);
  const [incomplete, setIncomplete] = useState(false);
  const audit = useRef<AbortController | null>(null);
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const eligible = useRef(canUpdate); eligible.current = canUpdate;
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    if (!('serviceWorker' in navigator)) return;
    let mounted = true;
    void navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL).then(registration => { if (mounted && registration?.active) setReady(true); });
    const install = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPrompt); };
    window.addEventListener('beforeinstallprompt', install);
    return () => { mounted = false; alive.current = false; eligible.current = false; audit.current?.abort(); window.removeEventListener('beforeinstallprompt', install); onBusy(false); };
  }, []);
  const checkFiles = async () => {
    if (busy || auditing) return;
    setAuditing(true); setStatus('Checking saved offline bytes locally. No network requests or repairs.');
    const controller = new AbortController(); audit.current = controller;
    try {
      const registration = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
      if (!registration?.active || registration.scope !== new URL(import.meta.env.BASE_URL, location.href).href) throw new Error('No active offline edition is available. Enable it between attempts when connected.');
      const result = await auditOfflineCache(registration.active, new URL(`${import.meta.env.BASE_URL}sw.js`, location.href).href, controller.signal);
      if (alive.current) { setIncomplete(result.matched !== result.checked); setStatus(describeOfflineAudit(result)); }
    } catch (error) { if (alive.current) setStatus(error instanceof Error ? error.message : 'Offline completeness is unknown.'); }
    finally { if (audit.current === controller) audit.current = null; if (alive.current) setAuditing(false); }
  };
  const repair = async () => {
    if (!eligible.current || busy || auditing) return;
    setBusy(true); onBusy(true); setStatus('Repairing saved offline files from verified release bytes. Attempts and notebook entries stay on this device.');
    try {
      const registration = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
      if (!registration?.active || registration.scope !== new URL(import.meta.env.BASE_URL, location.href).href) throw new Error('No active offline edition is available.');
      const result = await repairOfflineCache(registration.active, new URL(`${import.meta.env.BASE_URL}sw.js`, location.href).href);
      if (!alive.current) return;
      setIncomplete(result.status !== 'complete');
      const reasons = { busy: 'Another repair is in progress.', other_tabs: 'Close other application tabs before retrying.', timeout: 'The 30-second worker limit elapsed.', mismatch: 'The server no longer supplies these exact release bytes. Check for an offline update.', storage: 'Browser cache storage refused a write.', unavailable: 'Some release files could not be read or fetched.', verified: 'All saved files match this release.' };
      setStatus(result.status === 'complete' ? `Offline repair complete. ${result.repaired} files replaced and the full inventory verified. Attempts and notebook entries were not changed.` : `Offline repair ${result.status}. ${result.repaired} verified replacements completed. ${reasons[result.reason]} Previous matching files and attempt data were preserved. Check saved offline files before retrying.`);
    } catch (error) { if (alive.current) setStatus(error instanceof Error ? error.message : 'Offline repair outcome is unknown. Check saved offline files before retrying.'); }
    finally { if (alive.current) setBusy(false); onBusy(false); }
  };
  const enable = async () => {
    if (!eligible.current || busy || auditing) return;
    setBusy(true); onBusy(true); setStatus('Verifying offline assets…');
    try {
      const previous = navigator.serviceWorker.controller;
      const registration = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL, updateViaCache: 'none' });
      await registration.update();
      const waiting = await waitForInstall(registration);
      if (!alive.current) return;
      if (waiting) {
        if (!eligible.current) throw new Error('An update is waiting. Apply it between attempts.');
        const approved = await new Promise<boolean>((resolve) => {
          const channel = new MessageChannel();
          const timer = setTimeout(() => { channel.port1.close(); resolve(false); }, 3000);
          channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve(event.data?.ok === true); };
          waiting.postMessage({ type: 'activate-between-attempts' }, [channel.port2]);
        });
        if (!approved) throw new Error('Close other After the Agent tabs before applying this update.');
      }
      if (waiting || !previous) await waitForActivation(registration, previous);
      if (!alive.current) return;
      setReady(true);
      if (waiting && previous && eligible.current) { location.reload(); return; }
      const result = await auditOfflineCache(registration.active!, new URL(`${import.meta.env.BASE_URL}sw.js`, location.href).href);
      if (alive.current) { setIncomplete(result.matched !== result.checked); setStatus(`${result.matched === result.checked ? 'Offline edition ready. ' : ''}${describeOfflineAudit(result)}`); }
    } catch (error) { if (alive.current) setStatus(error instanceof Error ? error.message : 'Offline installation unavailable. Retry when connected.'); }
    finally { if (alive.current) setBusy(false); onBusy(false); }
  };
  return <section className="offline-tools" aria-label="Offline edition"><h3>Keep a local edition</h3><p>Opt in to cache the application and its bundled recordings on this device. Attempts stay in your browser. Recovery deadlines still count while closed or offline.</p><button disabled={!canUpdate || busy || auditing || !('serviceWorker' in navigator)} onClick={() => void enable()}>{busy ? 'Preparing offline edition…' : ready ? 'Check offline update' : 'Enable offline edition'}</button>{ready && <button disabled={busy || auditing} onClick={() => void checkFiles()}>{auditing ? 'Checking saved offline files…' : 'Check saved offline files'}</button>}{ready && <button disabled={!canUpdate || busy || auditing} onClick={() => void repair()}>Repair saved offline files</button>}{!canUpdate && <p className="hint">Install, update and repair between attempts. Close other tabs to apply an update.</p>}{ready && <p className="hint">{prompt ? 'Install a standalone window using the button below.' : 'Use your browser’s install or Add to Home Screen command if available.'} Browser storage can be cleared or evicted. Download important attempts separately.</p>}{prompt && ready && <button onClick={() => { void prompt.prompt().then(() => prompt.userChoice).then(() => setPrompt(null)).catch(() => setStatus('Installation was not completed. Use the browser install menu to retry.')); }}>Install application</button>}{ready && <p className="hint">{incomplete ? "Repair missing or altered files when connected. " : "Repair verifies this edition and fetches only missing or altered files. "}Attempts and notebook entries are preserved.</p>}<p role="status">{status}</p></section>;
}
