import { version } from '../package.json';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createSession, createRecordedSession, compactAttemptExport, restoreSession, type SessionPlaybackSource, type ExtendedBoardSession } from '../../../packages/engine/src/index.js';
import { buildCorpus } from '../../../packages/runner/src/continuations.js';
import { parseStrictJson } from '../../../packages/runner/src/strict-json.js';
import { sha256Json, type Action, type ScenarioFamily } from '../../../packages/contracts/src/index.js';
import { createWorkerEvaluator } from './session/evaluator.js';
import { storageKey, autosavePrefix, persistSession, assertLatestSession, assertRestoreExtends, listSavedAttempts, readSavedAttempt, removeSavedAttempt, recordSavedDisposition, assertAttemptResumable, savedAttemptByteLimit, checkSavedAttemptSize, type SavedAttemptSummary } from './session/persistence.js';
import { createAttemptOwnership, type AttemptOwnership, type OwnershipStatus } from './session/ownership.js';
import { actionLabel, eventText, recordingModelLabel } from './session/labels.js';
import { TargetStrip } from './components/TargetStrip.js';
import { Installation } from './components/Installation.js';
import { Inspector } from './components/Inspector.js';
import { History } from './components/History.js';
import { Debrief } from './components/Debrief.js';
import { PublicTools } from './components/PublicTools.js';
import { serializeResumableAttempt, parseResumableAttempt } from './session/resumable.js';
import { OfflineControls } from './offline/OfflineControls.js';
import { EditReceipt, createEditReceipt, type EditReceiptData } from './components/EditReceipt.js';
import { PulseTimeline } from './components/PulseTimeline.js';
import { CommandMenu } from './components/CommandMenu.js';
import { BrowserReadiness } from './components/BrowserReadiness.js';
import { EvidencePacketTools } from './components/EvidencePacketTools.js';
import type { InspectionSummary } from './recordings/inspection-schema.js';
const faults = [{ value: 'stale-queue', label: 'Stale queue' }, { value: 'duplicate-clock', label: 'Duplicate clock' }, { value: 'cached-gate', label: 'Cached gate' }] as const;
function download(value: unknown, name: string) { downloadJson(JSON.stringify(value, null, 2), name); }
function downloadJson(raw: string, name: string) { downloadText(raw, name, 'application/json'); }
function downloadText(raw: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([raw], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function focusSection(id: string) { document.getElementById(id)?.focus(); }
function keepFocusVisible(target: HTMLElement) {
  requestAnimationFrame(() => {
    const toolbar = document.querySelector<HTMLElement>('main.public-workbench .toolbar');
    if (!target.isConnected || document.activeElement !== target || !toolbar || toolbar.contains(target) || getComputedStyle(toolbar).position !== 'fixed') return;
    const rect = target.getBoundingClientRect(), bottom = toolbar.getBoundingClientRect().top - 12;
    const movement = rect.top < 12 || rect.height > bottom - 12 ? rect.top - 12 : rect.bottom > bottom ? rect.bottom - bottom : 0;
    if (movement) window.scrollBy({ top: movement, behavior: 'instant' });
  });
}
function savedOptions(): SavedAttemptSummary[] { try { return listSavedAttempts(); } catch { return []; } }
interface OwnershipBinding { session: ExtendedBoardSession; attemptId: string; adapter: AttemptOwnership; status: OwnershipStatus }
export function App() {
  const evaluator = useMemo(() => createWorkerEvaluator(), []);
  const [session, setSession] = useState(() => createSession({ scenario: 'stale-queue' }, evaluator.evaluate, buildCorpus));
  const view = useSyncExternalStore(session.subscribe, session.getView);
  const [EvidencePanel, setEvidencePanel] = useState<typeof import('./components/EvidencePanel.js').EvidencePanel | null>(null);
  const [Study, setStudy] = useState<typeof import('./study/Study.js').Study | null>(null);
  const [LearningLab, setLearningLab] = useState<typeof import('./components/LearningLab.js').LearningLab | null>(null);
  const [InspectionPanel, setInspectionPanel] = useState<typeof import('./components/InspectionPanel.js').InspectionPanel | null>(null);
  const [learning, setLearning] = useState(false);
  const [inspection, setInspection] = useState<{ jobId: string | null; caseId: string | null; navigation: number } | null>(null);
  const inspectionNavigation = useRef(0);
  const [featureStatus, setFeatureStatus] = useState('');
  const [screen, setScreen] = useState<'landing' | 'tutorial' | 'board' | 'study'>('landing');
  const [playbackSource, setPlaybackSource] = useState<SessionPlaybackSource | null>(null);
  const [sourceReady, setSourceReady] = useState(false);
  const [offlineBusy, setOfflineBusy] = useState(false);
  const [historyRestored, setHistoryRestored] = useState(false);
  const restoreGeneration = useRef(0), activeSession = useRef(session); activeSession.current = session;
  const [selected, setSelected] = useState<string[]>([]);
  const [nextFault, setNextFault] = useState<ScenarioFamily>('stale-queue');
  const [rehearsalEvidence, setRehearsalEvidence] = useState<unknown>(null);
  const [inspect, setInspect] = useState(false);
  const [importStatus, setImportStatus] = useState('');
  const [importSummary, setImportSummary] = useState<InspectionSummary | null>(null);
  const [importPending, setImportPending] = useState(false);
  const importing = useRef<{ generation: number; cancel: (() => void) | null }>({ generation: 0, cancel: null });
  const [storageStatus, setStorageStatus] = useState('');
  const [restoreStatus, setRestoreStatus] = useState('');
  const [savedAttempts, setSavedAttempts] = useState(savedOptions);
  const [savedId, setSavedId] = useState(() => savedOptions().at(-1)?.id ?? '');
  const [saved, setSaved] = useState(() => savedOptions().length > 0);
  const owner = useRef<OwnershipBinding | null>(null);
  const ownerRelease = useRef<Promise<void>>(Promise.resolve());
  const [ownershipStatus, setOwnershipStatus] = useState<OwnershipStatus>({ state: 'acquiring', message: 'Checking editing ownership.' });
  const [transferPending, setTransferPending] = useState(false);
  const [resetPending, setResetPending] = useState(false);
  const mutationOperation = useRef(false);
  const keyboardNavigation = useRef(false);
  const [receipt, setReceipt] = useState<EditReceiptData | null>(null);
  const [stopEvent, setStopEvent] = useState<'delivery' | 'scene_change' | 'discard'>('delivery');
  const [acceleratorEnabled, setAcceleratorEnabled] = useState(false);
  const [readinessOpen, setReadinessOpen] = useState(false);
  const ownsAttempt = () => owner.current?.session === session && owner.current.attemptId === view.attempt_id && owner.current.status.state === 'owner';
  const canMutate = sourceReady && ownsAttempt() && !transferPending && !resetPending && !historyRestored;
  useEffect(() => {
    const restored = (event: PageTransitionEvent) => { if (event.persisted) setHistoryRestored(true); };
    window.addEventListener('pageshow', restored);
    return () => window.removeEventListener('pageshow', restored);
  }, []);
  useEffect(() => {
    const entry = { session, attemptId: view.attempt_id, status: { state: 'acquiring', message: 'Checking editing ownership.' } } as OwnershipBinding;
    const adapter = createAttemptOwnership(entry.attemptId, status => {
      if (owner.current !== entry) return;
      entry.status = status;
      if (status.state !== 'owner') session.pause();
      setOwnershipStatus(status);
    }, { beforeAcquire: () => assertLatestSession(session, playbackSource ? { playbackSource } : {}), beforeTransfer: async () => {
      session.pause();
      await persistSession(session, { ...(playbackSource ? { playbackSource } : {}), canWrite: () => owner.current === entry && entry.attemptId === session.getView().attempt_id && adapter.ownsLock() });
    } });
    const previousRelease = ownerRelease.current;
    entry.adapter = adapter; owner.current = entry;
    setOwnershipStatus(entry.status);
    void previousRelease.then(() => { if (owner.current === entry) return adapter.acquire(); });
    return () => { if (owner.current === entry) owner.current = null; ownerRelease.current = adapter.dispose(); };
  }, [session, view.attempt_id]);
  useEffect(() => {
    const refresh = () => { const options = savedOptions(); setSavedAttempts(options); setSavedId(current => options.some(option => option.id === current) ? current : options.at(-1)?.id ?? ''); setSaved(options.length > 0); };
    const changed = (event: StorageEvent) => { if (screen === 'landing' && (event.key === null || event.key === storageKey || event.key.startsWith(autosavePrefix))) refresh(); };
    if (screen === 'landing') refresh();
    window.addEventListener('storage', changed); return () => window.removeEventListener('storage', changed);
  }, [screen]);
  useEffect(() => {
    let mounted = true;
    void import('./recordings/curated.js').then(module => module.loadCuratedPlayback()).then(source => { if (!mounted || !source) return; setPlaybackSource(source); setSession(createRecordedSession(source, evaluator.evaluate, buildCorpus)); }).catch(error => { if (mounted) setStorageStatus(`Curated recording unavailable: ${error instanceof Error ? error.message : 'invalid asset'}. The scripted preview remains available.`); }).finally(() => { if (mounted) setSourceReady(true); });
    return () => { mounted = false; };
  }, [evaluator]);
  const save = () => {
    const binding = owner.current;
    if (!binding || binding.session !== session || binding.attemptId !== session.getView().attempt_id || binding.status.state !== 'owner' || mutationOperation.current) return;
    const failed = () => { if (owner.current === binding && binding.status.state === 'owner' && !mutationOperation.current) setStorageStatus(view.mode === 'local_rehearsal' ? 'Local rehearsal saving and resume are unavailable. Download retains the synthetic exposure receipt.' : 'Local resume is unavailable. You can still download this attempt.'); };
    try { void persistSession(session, { ...(playbackSource ? { playbackSource } : {}), canWrite: () => owner.current === binding && binding.session === session && binding.status.state === 'owner' && binding.attemptId === session.getView().attempt_id && !mutationOperation.current }).catch(failed); } catch { failed(); }
  };
  const saveResumable = () => {
    try { downloadJson(serializeResumableAttempt(session, rehearsalEvidence), `after-the-agent-resume-${view.attempt_id}.json`); }
    catch (error) { setRestoreStatus(`Save rejected: ${error instanceof Error ? error.message : 'attempt could not be serialized'}`); }
  };
  useEffect(() => {
    const visibility = () => { session.setVisibility(document.hidden); save(); };
    const flush = () => save();
    document.addEventListener('visibilitychange', visibility); window.addEventListener('pagehide', flush);
    return () => { document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', flush); session.dispose(); };
  }, [session]);
  useEffect(() => () => { evaluator.dispose(); importing.current.generation++; importing.current.cancel?.(); }, [evaluator]);
  // Deadline-only publications do not change the saved command/state evidence.
  useEffect(save, [session, view.attempt_id, view.phase, view.history.length, view.latest_result, view.evaluation, view.submitting, view.running, ownershipStatus.state]);
  useEffect(() => { if (screen !== 'landing') focusSection(screen === 'board' ? 'board-heading' : screen === 'tutorial' ? 'tutorial-heading' : 'study-heading'); }, [screen]);
  useEffect(() => { if (historyRestored) focusSection('history-return-heading'); }, [historyRestored]);
  useEffect(() => { setLearning(false); setInspection(null); setReceipt(null); }, [session, view.attempt_id, screen]);
  useEffect(() => { restoreGeneration.current++; }, [session, view.attempt_id, screen, offlineBusy]);
  useEffect(() => { if (learning && LearningLab) focusSection('concept-lessons'); }, [learning, LearningLab]);
  useEffect(() => { if (inspection && InspectionPanel) focusSection('behavior-inspection-heading'); }, [inspection, InspectionPanel]);
  const openLessons = () => {
    setLearning(true); setFeatureStatus('');
    if (!LearningLab) void import('./components/LearningLab.js').then(module => setLearningLab(() => module.LearningLab)).catch(() => setFeatureStatus('Concept lessons could not load. Reload to retry.'));
  };
  const openInspection = (jobId: string | null = null, caseId: string | null = null) => {
    setInspection({ jobId, caseId, navigation: ++inspectionNavigation.current }); setFeatureStatus('');
    if (!InspectionPanel) void import('./components/InspectionPanel.js').then(module => setInspectionPanel(() => module.InspectionPanel)).catch(() => setFeatureStatus('Behavior inspection could not load. Reload to retry.'));
  };
  const recoveryEnded = view.phase === 'timed_out' || (['recovery', 'submitted'].includes(view.phase) && view.remaining_ms === 0);
  const editable = canMutate && view.phase === 'recovery' && !view.submitting && !recoveryEnded;
  const selectedJobs = selected.filter(id => view.plant.queue.some(job => job.id === id));
  const act = (action: Action) => { if (!editable || !ownsAttempt() || mutationOperation.current) return; const before = session.getView().plant; const result = session.act(action); if (view.mode === 'public') setReceipt(createEditReceipt(before, result)); setSelected([]); };
  const step = () => { if (editable && ownsAttempt() && !mutationOperation.current) session.step(); };
  const run = () => { if (editable && ownsAttempt() && !mutationOperation.current) session.run(); };
  const submit = () => { if (editable && ownsAttempt() && !mutationOperation.current) void session.submit(); };
  const begin = () => { if (!canMutate || !ownsAttempt() || mutationOperation.current) return; session.start(); setScreen('board'); setSaved(false); };
  const captureRestore = () => {
    const generation = ++restoreGeneration.current, before = session.getView(), checks = session.exportAttempt().submissions.length;
    return () => {
      const current = session.getView();
      if (generation !== restoreGeneration.current || activeSession.current !== session || current.attempt_id !== before.attempt_id || current.history.length !== before.history.length || session.exportAttempt().submissions.length !== checks) throw new Error('Restore superseded by a newer action. Select the file again to restore it.');
    };
  };
  const restore = async (value: unknown, receipt: unknown, fromStorage: boolean, ensureCurrent = captureRestore()) => {
    ensureCurrent();
    if (!sourceReady) throw new Error('Wait for local playback assets to finish loading before restoring an attempt.');
    if (value && typeof value === 'object' && 'attempt_id' in value && typeof value.attempt_id === 'string') assertAttemptResumable(value.attempt_id);
    evaluator.cancel();
    let originalSource = playbackSource;
    if (value && typeof value === 'object' && 'playback_source' in value) {
      const binding = value.playback_source;
      if (binding === null) originalSource = null;
      else if (binding && typeof binding === 'object' && 'recording_sha256' in binding && typeof binding.recording_sha256 === 'string' && /^[a-f0-9]{64}$/.test(binding.recording_sha256) && binding.recording_sha256 !== originalSource?.recording_sha256) {
        const { loadRecordingGallery } = await import('./recordings/gallery.js');
        originalSource = (await loadRecordingGallery()).find(entry => entry.recordingSha256 === binding.recording_sha256)?.playback ?? null;
      }
    }
    ensureCurrent();
    const restored = restoreSession(value, evaluator.evaluate, buildCorpus, { ...(originalSource ? { playbackSource: originalSource } : {}), now: Date.now });
    let restoredReceipt: unknown = null;
    try {
      if (restored.getView().mode === 'local_rehearsal') {
        const { restoreRehearsalReceipt } = await import('./study/receipt.js');
        const handover = compactAttemptExport(restored).handover_at_ms;
        try { restoredReceipt = restoreRehearsalReceipt(fromStorage ? localStorage.getItem('after-the-agent.rehearsal-evidence.v1') : JSON.stringify(receipt), restored, handover); } catch (error) { if (!fromStorage) throw error; setStorageStatus('Saved episode restored. Its synthetic exposure receipt is unavailable. The original deadline still applies.'); }
      } else if (receipt !== null) throw new Error('Public attempts cannot carry synthetic exposure evidence.');
      ensureCurrent(); assertRestoreExtends(session, restored);
      await assertLatestSession(restored, originalSource ? { playbackSource: originalSource } : {});
      ensureCurrent(); session.pause(); setPlaybackSource(originalSource); setSession(restored); setRehearsalEvidence(restoredReceipt); setNextFault(restored.getView().scenario); setSelected([]); setInspect(false); setSaved(false);
      if (restoredReceipt && !fromStorage) { try { localStorage.setItem('after-the-agent.rehearsal-evidence.v1', JSON.stringify(restoredReceipt)); } catch { setStorageStatus('Local rehearsal saving and resume are unavailable. Download retains the synthetic exposure receipt.'); } }
      const pendingPlayback = ['setup', 'playback'].includes(restored.getView().phase);
      setScreen(pendingPlayback ? 'tutorial' : 'board');
      if (restored.getView().mode !== 'local_rehearsal' || restoredReceipt) setStorageStatus(pendingPlayback ? 'Saved setup replay validated. Recovery time begins at takeover.' : 'Saved commands validated and replayed. The original deadline still applies.');
    } catch (error) { restored.dispose(); throw error; }
  };
  const resume = async () => {
    try { if (!savedId) throw new Error('Saved attempt is unavailable.'); const raw = readSavedAttempt(savedId); checkSavedAttemptSize(raw); await restore(parseStrictJson(raw), null, true); }
    catch (error) { setStorageStatus(`Cannot resume: ${error instanceof Error ? error.message : 'incompatible saved attempt'}. Start a fresh attempt.`); }
  };
  const downloadSaved = () => {
    try {
      if (!savedId) throw new Error('Select a saved attempt first.');
      const raw = readSavedAttempt(savedId), summary = savedAttempts.find(item => item.id === savedId);
      downloadJson(raw, 'after-the-agent-retained.autosave.json');
      setStorageStatus(`Raw autosave downloaded. Local disposition: ${summary?.disposition ?? 'not recorded'}. These exact bytes are recovery evidence, not a Save progress to a file download. Downloading cannot resume or revive this attempt.`);
    } catch (error) { setStorageStatus(`Autosave download unavailable: ${error instanceof Error ? error.message : 'browser storage is unavailable'}`); }
  };
  const transferEditing = async () => {
    const binding = owner.current; if (!binding || mutationOperation.current) return;
    const ensureCurrent = captureRestore(); mutationOperation.current = true; setTransferPending(true);
    try {
      const status = await binding.adapter.requestTransfer(); ensureCurrent();
      if (status.state !== 'owner') throw new Error(status.message);
      const latest = readSavedAttempt(binding.attemptId); ensureCurrent();
      await restore(parseStrictJson(latest), null, true, ensureCurrent);
      setStorageStatus('Latest saved state restored after editing transfer. The original deadline still applies.');
    } catch (error) {
      if (owner.current === binding) {
        session.pause(); owner.current = null;
        setOwnershipStatus({ state: 'released', message: 'Editing transfer failed. This attempt remains read-only. Reload to start fresh, or restore a valid saved attempt.' });
        ownerRelease.current = binding.adapter.dispose(); await ownerRelease.current;
      }
      setStorageStatus(`Editing transfer incomplete: ${error instanceof Error ? error.message : 'unavailable'}. Download this attempt before closing.`);
    }
    finally { mutationOperation.current = false; setTransferPending(false); }
  };
  const deleteSaved = async () => {
    if (!savedId) return;
    try { await removeSavedAttempt(savedId); const options = savedOptions(); setSavedAttempts(options); setSavedId(options.at(-1)?.id ?? ''); setSaved(options.length > 0); setStorageStatus('Selected local autosave deleted. Other attempts are retained.'); }
    catch { setStorageStatus('The selected autosave could not be deleted.'); }
  };
  const restoreFile = async (file: File | undefined) => {
    if (!file) return;
    setRestoreStatus('Validating saved attempt…');
    const ensureCurrent = captureRestore();
    if (file.size > savedAttemptByteLimit) { setRestoreStatus('Attempt rejected: file exceeds 8 MiB.'); return; }
    try { const raw = await file.text(); ensureCurrent(); const value = parseResumableAttempt(raw); await restore(value.session, value.rehearsal_evidence, false, ensureCurrent); setRestoreStatus('Attempt restored. Commands were validated and replayed. The original deadline still applies.'); }
    catch (error) { setRestoreStatus(`Attempt rejected: ${error instanceof Error ? error.message : 'invalid data'}`); }
  };
  const restart = async () => {
    const binding = owner.current; if (!canMutate || !binding || mutationOperation.current) return;
    mutationOperation.current = true; setResetPending(true); session.pause(); evaluator.cancel();
    const before = session.getView(), disposition = before.phase === 'timed_out' || before.phase === 'submitted' ? before.phase : 'abandoned_reset';
    try {
      await recordSavedDisposition(before.attempt_id, disposition, { canWrite: () => owner.current === binding && binding.adapter.ownsLock() && session.getView().attempt_id === before.attempt_id });
      if (owner.current !== binding || !binding.adapter.ownsLock()) throw new Error('Editing ownership changed.');
      setRestoreStatus(''); setStorageStatus(''); session.restart(nextFault);
      if (compactAttemptExport(session).playback_source?.recording_sha256 !== playbackSource?.recording_sha256) setPlaybackSource(null);
      setScreen('tutorial'); setSelected([]); setInspect(false); setRehearsalEvidence(null);
    } catch { setStorageStatus('New attempt could not start safely because the old attempt disposition could not be saved. Download the evidence before closing.'); }
    finally { mutationOperation.current = false; setResetPending(false); }
  };
  const importRun = async (file: File | undefined) => {
    if (!file) return;
    const generation = ++importing.current.generation; importing.current.cancel?.(); importing.current.cancel = null; setImportSummary(null);
    if (file.size > 2_000_000) { setImportPending(false); setImportStatus('Recording rejected: file exceeds 2 MB.'); return; }
    setImportPending(true); setImportStatus('Inspecting recording in a local worker…');
    try {
      const raw = await file.text(), { inspectRecording } = await import('./recordings/inspector.js');
      if (generation !== importing.current.generation) return;
      const task = inspectRecording(raw); importing.current.cancel = task.cancel;
      const summary = await task.promise;
      if (generation !== importing.current.generation) return;
      setImportSummary(summary); setImportStatus(`Imported ${summary.category} recording ${summary.run_id}: replay ${summary.status}. Imported files do not establish model provenance or change this preview.`);
    } catch (error) { if (generation === importing.current.generation) setImportStatus(`Recording rejected: ${error instanceof Error ? error.message : 'invalid data'}`); }
    finally { if (generation === importing.current.generation) { importing.current.cancel = null; setImportPending(false); } }
  };
  const snapshot = useMemo(() => ({ hash: sha256Json(view.plant), candidate: session.exportAttempt().candidate }), [session, view.attempt_id, view.plant.revision, view.evaluation, view.submitting]);
  const submissions = useMemo(() => inspection ? compactAttemptExport(session).submissions : [], [session, view.attempt_id, view.evaluation, view.submitting, inspection !== null]);
  const seconds = Math.ceil(view.remaining_ms / 1000);
  const time = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  const recorded = view.provenance.label === 'Recorded agent run';
  const constructedRecording = recorded && playbackSource?.setup.config.clocks.primary === false && playbackSource.setup.config.clocks.shadow === false;
  const lastCommand = view.history.at(-1);
  const setupEffects = lastCommand?.result.events.filter(event => event.type !== 'settled_tick').map(eventText).join('. ');
  const orientation = view.scenario === 'duplicate-clock' ? 'Compare the two clocks and the sources of pending work. Step once to watch delivery, or check this state before changing it.' : view.scenario === 'cached-gate' ? 'Compare the current scene with the state stored by the gate. Step once to watch delivery, or check this state before changing it.' : 'Compare the pending job’s version with the current scene. Step once to watch the due delivery, or check this state before changing it.';
  const feedback = view.latest_result?.error ? `Rejected ${view.latest_result.request_id}: ${view.latest_result.error.message}` : view.submitting ? 'Checking a copy of your board and pending work.' : lastCommand?.actor.role === 'human' && editable ? `${actionLabel(lastCommand.request.action)}. ${view.latest_result?.no_op ? 'Already set; no state change.' : `Accepted at tick ${lastCommand.tick}.`}` : `Handover ready at tick ${view.plant.tick}. ${view.plant.queue.length} pending ${view.plant.queue.length === 1 ? 'job' : 'jobs'}. Simulation pauses independently of the recovery deadline.`;
  const runStop = session.getRunStop();
  const currentSubmissions = useMemo(() => compactAttemptExport(session).submissions, [session, view.attempt_id, view.evaluation, view.submitting]);
  return <>
    <a className="skip-link" href="#main" onClick={() => focusSection('main')}>Skip to main content</a>
    <header className="site-header"><a className="wordmark" href={import.meta.env.BASE_URL}>After the Agent</a><span className="source-badge">{view.provenance.label}</span>{view.provenance.category === 'fixture' && <small>Fixture recording</small>}{recorded && <details className="recording-details"><summary>Recording details</summary><p>{recordingModelLabel(view.provenance.model)}</p><p>Recorded {view.provenance.date ?? 'on an unavailable date'}. Replayed locally; this is not a live conversation.</p></details>}<a href="#method" onClick={event => { event.preventDefault(); focusSection('method-heading'); }}>How it works</a></header>
    <main id="main" tabIndex={-1} onKeyDownCapture={() => { keyboardNavigation.current = true; }} onPointerDownCapture={() => { keyboardNavigation.current = false; }} onFocusCapture={event => { if (keyboardNavigation.current) keepFocusVisible(event.target); }} className={screen === 'board' && view.mode === 'public' ? 'public-workbench' : undefined}>
      {screen !== 'board' && ['readonly', 'unavailable'].includes(ownershipStatus.state) && <p className="notice" role="status" aria-label="Editing ownership">{ownershipStatus.message}</p>}
      {historyRestored && <section className="notice" role="alert"><h2 id="history-return-heading" tabIndex={-1}>Return from browser history</h2><p>This cached view is read-only. Save this copy before reloading if you need to keep it. Reload to choose the latest saved attempt. The original deadline keeps counting.</p><button onClick={saveResumable}>Save cached attempt</button><button onClick={() => window.location.reload()}>Reload saved attempts</button></section>}
      {screen === 'landing' && <section className="landing"><div className="landing-copy"><p className="eyebrow">Take over a small light installation</p><h1 id="landing-heading" tabIndex={-1}>{recorded ? 'The agent handed it over. Can you keep it working?' : <>A working system.<br/>An unfamiliar fault.<br/>Your move.</>}</h1><p className="intro">A clock creates work. A queue holds it. Three lights show what happened. Inherit the actual state and restore the pattern when assistance ends.</p><button className="primary" disabled={!sourceReady || offlineBusy || !canMutate} onClick={() => setScreen('tutorial')}>Take over the lights <span aria-hidden="true">→</span></button>{view.mode === 'public' && <button id="concept-trigger" aria-expanded={learning} onClick={openLessons}>Explore the concepts</button>}<p className="landing-meta">About five minutes · no account · no sound required</p>{!sourceReady && <p role="status">Loading local playback assets…</p>}{saved && <div className="resume"><p>Saved attempts stay on this device.</p><label>Saved attempt<select aria-label="Saved attempt" value={savedId} onChange={event => setSavedId(event.target.value)}>{savedAttempts.map(option => <option key={option.id} value={option.id}>{option.scenario} · {option.phase} · {option.id}{option.retired ? " · abandoned" : option.corrupt ? " · damaged" : ""}</option>)}</select></label><button disabled={!sourceReady || offlineBusy || transferPending} onClick={() => void resume()}>Resume saved attempt</button><button onClick={downloadSaved}>Download selected autosave</button><button onClick={() => void deleteSaved()}>Delete selected autosave</button><p className="hint">Raw autosave downloads preserve stored bytes, including damaged or abandoned attempts. They do not certify a repair or replace a resumable download.</p></div>}</div><div className="landing-demo"><p className="eyebrow">Actual installation, before setup</p><Installation plant={view.plant} events={view.events}/><p className="eyebrow">The normal target</p><TargetStrip interactive/><p className="hint">One pulse per beat, plus center on the fourth. These example ticks assume the scene stays active and its version does not change.</p></div><p className="source-caption">{recorded ? constructedRecording ? 'The agent enabled a clock and delivery guard, switched the gate to live, then advanced to tick 5. Its recorded actions replay unchanged. The controlled fault is authored separately.' : 'The agent inspected the existing correct settings and advanced to tick 5. Its recorded actions replay unchanged. The controlled fault is authored separately.' : view.provenance.category === 'fixture' ? 'Fixture recording. Authored actions replay in the engine; the controlled fault is applied separately.' : 'Scripted preview. The setup and fault are authored and execute in the real engine.'} Public play sends no research events or text to a server or model.</p></section>}
      {screen === 'tutorial' && <section className="tutorial"><div className="tutorial-intro"><p className="eyebrow">1. Target · 2. Setup · 3. Takeover</p><h1 id="tutorial-heading" tabIndex={-1}>Alternate left and right.</h1><p className="intro">Center joins every fourth beat. The clock fires every 4 ticks; pulses wait 2 ticks in the queue.</p>{view.mode === 'public' && <button id="concept-trigger" aria-expanded={learning} onClick={openLessons}>Explore the concepts</button>}<TargetStrip/><p>Only an active scene owes work. A queued pulse is owed only if the scene version still matches when it is delivered.</p><ol className="instructions"><li>Inspect the scene, pending work and settings.</li><li>Edit a setting or select queued jobs to drop. Edits do not advance time.</li><li>Step, run or pause, then test your repair against 12 fixed future scenarios.</li></ol><p>The takeover begins paused at tick 5. The five-minute wall deadline keeps counting while the simulation is paused.</p></div><section className="setup-replay panel" aria-label="Actual setup playback"><p className="eyebrow">Actual engine state</p><h2>Replay the setup</h2><p>{view.history.length} of {session.playbackLength()} actions replayed.</p><Installation plant={view.plant} events={view.events} setup/>{view.history.length > 0 && <p className="action-feedback"><span>Executed: {actionLabel(lastCommand!.request.action)} </span>{setupEffects && <span className="setup-effects">{setupEffects}.</span>}</p>}<div className="setup-actions"><button disabled={!canMutate || view.history.length >= session.playbackLength()} onClick={() => { if (canMutate) session.playbackStep(); }}>Replay next setup action</button><button className="primary" disabled={offlineBusy || !canMutate} onClick={begin}>Begin takeover</button></div><p className="hint">Begin takeover executes any remaining setup actions before handing you the actual tick-5 state. Recovery time begins then.</p><p className="source-caption">{recorded ? constructedRecording ? 'The recorded agent configured the clock, gate and delivery guard, then advanced to tick 5 with work still queued. Captions and the controlled fault are authored separately.' : 'The recorded agent inspected the existing correct settings and advanced five ticks. It made no configuration edit. Captions and the controlled fault are authored separately.' : view.provenance.category === 'fixture' ? 'Fixture recording replayed locally. Captions and the controlled fault are authored separately.' : 'Scripted preview. This is an authored setup, not a live agent conversation.'}</p></section></section>}
      {learning && view.mode === 'public' && ['landing', 'tutorial'].includes(screen) && <div id="concept-lessons" tabIndex={-1}><button onClick={() => { setLearning(false); focusSection('concept-trigger'); }}>Close concept lessons</button>{LearningLab ? <LearningLab/> : <p role="status">Loading concept lessons…</p>}</div>}
      {screen === 'study' && (Study ? <Study evaluator={evaluator.evaluate} onStart={(next, evidence, persistenceAvailable) => { setSession(next); setNextFault(next.getView().scenario); setRehearsalEvidence(evidence); setSelected([]); if (!persistenceAvailable) setStorageStatus('Local rehearsal saving and resume are unavailable. Download retains the synthetic exposure receipt.'); setScreen('board'); }}/> : <p role="status">Loading local rehearsal…</p>)}
      {screen === 'board' && <>
        <nav className="board-nav" aria-label="Board sections">{[['instrument', 'Board', 'board-heading'], ['settings', 'Settings', 'settings-heading'], ['result', 'Check result', 'result-heading'], ['history', 'History', 'history-events']].map(([id, label, heading]) => <a key={id} href={`#${id}`} onClick={event => { event.preventDefault(); focusSection(heading!); }}>{label}</a>)}</nav>
        <div className="workspace"><div className="workspace-primary"><section id="instrument" className="instrument panel" aria-label="Light installation"><div className="board-heading"><div><p className="eyebrow">{view.mode === 'local_rehearsal' ? 'Synthetic local rehearsal' : 'Your takeover'} · {faults.find(fault => fault.value === view.scenario)?.label}</p><h1 id="board-heading" tabIndex={-1}>{recoveryEnded ? 'Recovery time ended.' : recorded ? 'Recorded assistance ended. Restore the pattern.' : 'Assistant unavailable. Restore the pattern.'}</h1><p>Alternate left and right. Center joins every fourth beat.</p></div><div className="clock-readout"><strong aria-label="Recovery time remaining">{time}</strong><span>Tick {view.plant.tick} / {view.running ? 'Running' : 'Paused'}</span><small>{view.phase.replaceAll('_', ' ')}</small></div></div><Installation plant={view.plant} events={view.events}/>{view.mode === 'public' && !view.evaluation && editable && !view.history.some(command => command.actor.role === 'human') && <p className="orientation">{orientation}</p>}<div className="toolbar" data-testid="recovery-toolbar"><span className="dock-context" data-testid="recovery-countdown" aria-hidden="true">{time} · Tick {view.plant.tick} · {view.running ? 'Running' : 'Paused'}</span><button disabled={!editable} onClick={step}>Step</button><button disabled={!editable || view.running} onClick={run}>Run</button><button disabled={!editable || !view.running} onClick={() => session.pause()}>Pause</button><button className="primary" disabled={!editable} onClick={submit}>{view.submitting ? 'Checking…' : 'Check repair'}</button>{view.submitting && <button onClick={evaluator.cancel}>Cancel check</button>}</div><p className="ownership-notice" role="status" aria-label="Editing ownership">{ownershipStatus.message}{transferPending && " Loading the latest saved state…"}</p>{!canMutate && ["readonly", "unavailable"].includes(ownershipStatus.state) && <button disabled={transferPending} onClick={() => void transferEditing()}>Transfer editing here</button>}{view.mode === "public" && <><PulseTimeline tick={view.plant.tick} events={view.events}/><EditReceipt receipt={receipt}/><details className="event-run-tools"><summary>Pause on an event</summary><label>Stop after<select aria-label="Stop after event" value={stopEvent} onChange={event => setStopEvent(event.target.value as typeof stopEvent)}><option value="delivery">A delivery</option><option value="scene_change">A scene change</option><option value="discard">A discarded job</option></select></label><button disabled={!editable || view.running} onClick={() => { if (editable) session.runUntil(stopEvent); }}>Run until event</button><p className="hint">Stops after a settled tick, at 128 ticks, or at the original deadline. Manual Step interrupts event-run. The live authored board has no later scene transition; frozen continuations explore those changes.</p>{runStop && <p role="status">Event run: {runStop.reason.replaceAll("_", " ")} at tick {runStop.tick}, {runStop.ticks} ticks advanced.</p>}</details><label className="toggle"><input type="checkbox" checked={acceleratorEnabled} onChange={event => setAcceleratorEnabled(event.target.checked)}/>Enable Alt + Shift + K command shortcut</label><CommandMenu acceleratorEnabled={acceleratorEnabled} items={[{id:"step",label:"Step",disabled:!editable,run:step},{id:"run",label:view.running?"Pause":"Run",disabled:!editable,run:()=>view.running?session.pause():run()},{id:"check",label:"Check repair",disabled:!editable,run:submit}]} sections={[["board-heading","Board"],["settings-heading","Settings"],["result-heading","Check result"],["history-events","History"]].map(([id,label])=>({id:id!,label:label!,disabled:false,run:()=>focusSection(id!)}))}/></>}<p className="feedback" role="status">{recoveryEnded ? 'Recovery ended. The original deadline has elapsed.' : feedback}</p><p className="hint deadline-note">Five-minute wall deadline, including paused time. Editing never advances a tick.</p></section>
          <Debrief submission={currentSubmissions.at(-1) ?? null} result={view.evaluation} candidate={snapshot.candidate} currentHash={snapshot.hash} currentTick={view.plant.tick} practice={view.mode === 'public'} {...(view.mode === 'public' ? { onExplore: (caseId: string) => openInspection(null, caseId) } : {})}/>
          <History key={view.attempt_id} events={view.events} commands={view.history} advanced={view.mode === 'public'}/></div><div className="workspace-secondary"><Inspector view={view} editable={editable} selected={selectedJobs} setSelected={setSelected} act={act} {...(view.mode === 'public' ? { onInspectJob: (jobId: string) => openInspection(jobId) } : {})}/>
          <section className="attempt-tools panel" aria-label="Attempt files and new attempt"><h2>Keep your progress</h2>
            <button onClick={saveResumable}>Save progress to a file</button><p className="hint">Download a file you can restore later. The original five-minute deadline still applies, including time away.</p>
            {view.mode === 'public' && <button id="behavior-trigger" onClick={() => openInspection()} aria-expanded={inspection !== null}>Explore behavior</button>}
            <details className="attempt-exports"><summary>Export and inspect evidence</summary><p>These exports are for reviewing what happened. To resume, use the progress file above.</p><div className="attempt-buttons">
              <button onClick={() => { setInspect(!inspect); if (!EvidencePanel) void import('./components/EvidencePanel.js').then(module => setEvidencePanel(() => module.EvidencePanel)).catch(() => setStorageStatus('Evidence inspection could not load. The complete download remains available.')); }} aria-expanded={inspect}>Inspect this run</button>
              <button onClick={() => download({ ...compactAttemptExport(session), ...(view.mode === 'local_rehearsal' ? { rehearsal_evidence: rehearsalEvidence } : {}) }, `after-the-agent-${view.attempt_id}.json`)}>Download attempt evidence</button>
              {view.mode === 'public' && <button onClick={() => void import('../../../packages/runner/src/evidence-report.js').then(module => downloadText(module.createEvidenceReport(compactAttemptExport(session)), `after-the-agent-${view.attempt_id}.html`, 'text/html')).catch(error => setFeatureStatus(`Report unavailable: ${error instanceof Error ? error.message : 'invalid evidence'}`))}>Download HTML evidence report</button>}
            </div>{view.mode === "public" && <EvidencePacketTools getAttempt={() => JSON.stringify(compactAttemptExport(session))} playbackSource={playbackSource}/>}</details>
            {view.mode === 'public' && <div className="new-attempt"><label className="field">Try another fault<select aria-label="Try another fault" value={nextFault} onChange={event => setNextFault(event.target.value as ScenarioFamily)}>{faults.map(fault => <option key={fault.value} value={fault.value}>{fault.label}</option>)}</select></label><button disabled={!canMutate} onClick={() => void restart()}>New attempt</button><p className="hint">Ends this attempt as {['submitted', 'timed_out'].includes(view.phase) ? view.phase.replaceAll('_', ' ') : 'abandoned reset'}. Prior identity and disposition remain in the new attempt’s evidence.</p></div>}
          </section></div>
        </div>{inspection && view.mode === 'public' && (InspectionPanel ? <InspectionPanel key={`${view.attempt_id}.${inspection.navigation}`} attemptId={view.attempt_id} events={view.events} queue={view.plant.queue} submissions={submissions} initialJobId={inspection.jobId} initialCaseId={inspection.caseId} remainingMs={view.remaining_ms} onClose={() => { setInspection(null); focusSection('behavior-trigger'); }}/> : <p role="status">Loading behavior inspection…</p>)}{inspect && (EvidencePanel ? <EvidencePanel session={session} receipt={rehearsalEvidence} revision={view.plant.revision} evaluation={view.evaluation} phase={view.phase} submitting={view.submitting} commands={view.history.length}/> : <p role="status">Loading evidence inspection…</p>)}</>}
      {featureStatus && <p role="status" className="notice">{featureStatus}</p>}
      {storageStatus && <p role="status" className="notice">{storageStatus}</p>}{restoreStatus && <p role="status" className="notice">{restoreStatus}</p>}
      {view.mode === 'public' && screen !== 'study' && <PublicTools submissions={currentSubmissions} key={view.attempt_id} remainingMs={view.remaining_ms} getCurrent={() => serializeResumableAttempt(session, rehearsalEvidence)} onRestore={async raw => { if (offlineBusy || view.submitting) throw new Error('Wait until the current operation finishes.'); const value = parseResumableAttempt(raw); await restore(value.session, value.rehearsal_evidence, false); }} canUseSource={canMutate && sourceReady && !offlineBusy && screen === 'landing' && view.phase === 'setup'} onUseSource={source => { if (!ownsAttempt() || !sourceReady || offlineBusy || screen !== 'landing' || session.getView().phase !== 'setup') return; evaluator.cancel(); setPlaybackSource(source); setSession(createRecordedSession(source, evaluator.evaluate, buildCorpus)); setNextFault('stale-queue'); setSelected([]); setFeatureStatus('Qualified recording selected. The authored controlled fault is applied at takeover.'); }}/>}
      {view.mode === 'public' && screen !== 'study' && <OfflineControls canUpdate={canMutate && ['setup', 'playback'].includes(view.phase) && !view.submitting} onBusy={setOfflineBusy}/>}
      {view.mode === "public" && screen !== "study" && <section className="panel browser-readiness-tool"><button aria-expanded={readinessOpen} onClick={() => setReadinessOpen(!readinessOpen)}>Browser readiness</button>{readinessOpen && <BrowserReadiness/>}</section>}
      <section id="method" className="method"><div><p className="eyebrow">How it works</p><h2 id="method-heading" tabIndex={-1}>Repair the behavior, then inspect the evidence.</h2><p>A deterministic engine handles every tick and action. The checker preserves pending work and compares exact pulse counts under twelve fixed continuation patterns. Browser, headless runner and local MCP server share the same action contract.</p><p>This is a small simulated recovery task. Browser scoring is local. Human usability and the controlled study have not been observed; research collection is disabled.</p><div className="method-links"><a href={`${import.meta.env.BASE_URL}docs/product-spec.txt`}>Product specification</a><a href={`${import.meta.env.BASE_URL}docs/engine-and-contracts.txt`}>Engine and contracts</a><a href={`${import.meta.env.BASE_URL}docs/research-protocol.txt`}>Research methodology</a><a href={`${import.meta.env.BASE_URL}docs/source-map.html`}>View the code</a></div><h3>Local rehearsal</h3><p>Both arms share identical facts, trace, timing and handover state. Synthetic exports are ineligible for research.</p><button disabled={offlineBusy || !canMutate} onClick={() => { if (!ownsAttempt()) return; session.pause(); setScreen('study'); void import('./study/Study.js').then(module => setStudy(() => module.Study)).catch(() => setStorageStatus('Local rehearsal could not load. Reload to retry.')); }}>Open local rehearsal</button></div><div className="file-tools"><h3>Restore a saved attempt</h3><p>Use a Save progress to a file download (up to 8 MiB). Accepted commands replay and prior checks are recomputed. Restoring keeps the original deadline.</p><label className="file-label">Restore attempt<input disabled={!sourceReady || view.submitting || offlineBusy} type="file" accept="application/json,.json" onChange={event => { void restoreFile(event.target.files?.[0]); event.target.value = ''; }}/></label><h3>Inspect a recording</h3><p>Recordings are separate from attempt files. Inspection runs in a bounded worker, cannot establish model provenance and does not replace your board.</p><label className="file-label">Import recording<input type="file" accept="application/json,.json" onChange={event => { void importRun(event.target.files?.[0]); event.target.value = ''; }}/></label>{importPending && <button onClick={() => { importing.current.generation++; importing.current.cancel?.(); importing.current.cancel = null; setImportPending(false); setImportStatus('Recording inspection cancelled.'); }}>Cancel recording inspection</button>}<p role="status">{importStatus}</p>{importSummary && <dl className="evidence-grid"><dt>Category / replay</dt><dd>{importSummary.category} / {importSummary.status}</dd><dt>Journal</dt><dd>{importSummary.commands} commands · {importSummary.events} events</dd><dt>Reconstructed state</dt><dd>Tick {importSummary.tick ?? 'unavailable'} · {importSummary.queued ?? 'unavailable'} queued · {importSummary.pulses} pulses</dd>{importSummary.mismatches.length > 0 && <><dt>Mismatches (first 12)</dt><dd><ul>{importSummary.mismatches.map((item, index) => <li key={index}>{item}</li>)}</ul></dd></>}</dl>}</div></section>
    </main><footer><span>{view.provenance.label}. Research collection disabled.</span><a href={`${import.meta.env.BASE_URL}docs/source-map.html`}>Source</a><a href={`${import.meta.env.BASE_URL}THIRD_PARTY_NOTICES.txt`}>Third-party notices</a><span>After the Agent · v{version}</span></footer>
  </>;
}
