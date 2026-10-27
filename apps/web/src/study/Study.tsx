import { useEffect, useMemo, useState } from 'react';
import { createSession, saveSession, restoreSession } from '../../../../packages/engine/src/index.js';
import { buildCorpus } from '../../../../packages/runner/src/continuations.js';
import { sha256Json } from '../../../../packages/contracts/src/index.js';
import type { CandidateEvaluator, ScenarioFamily, StudyCondition } from '../../../../packages/contracts/src/index.js';
import { actionLabel, factualManifest, schedule } from './manifest.js';
import { Installation } from '../components/Installation.js';
import { History } from '../components/History.js';
const key = 'after-the-agent.rehearsal.v1';
type Exposure = { session: ReturnType<typeof createSession>; started: number; revealed: number; choices: (string | null)[]; timings: { window: number; revealed_at: number; actual_elapsed_ms: number }[] };
export function Study({ evaluator, onStart }: { evaluator: CandidateEvaluator; onStart: (session: ReturnType<typeof createSession>, evidence: unknown, persistenceAvailable: boolean) => void }) {
  const [condition, setCondition] = useState<StudyCondition>('observation');
  const [scenario, setScenario] = useState<ScenarioFamily>('stale-queue');
  const [exposure, setExposure] = useState<Exposure | null>(null);
  const [now, setNow] = useState(Date.now());
  const [status, setStatus] = useState('');
  const manifest = useMemo(() => factualManifest(scenario), [scenario]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 100); return () => clearInterval(timer); }, []);
  useEffect(() => { if (!exposure) return; const visibility = () => exposure.session.setVisibility(document.hidden); document.addEventListener('visibilitychange', visibility); return () => document.removeEventListener('visibilitychange', visibility); }, [exposure?.session]);
  useEffect(() => {
    if (!exposure) return;
    const elapsed = now - exposure.started;
    let revealed = exposure.revealed;
    const timings = [...exposure.timings];
    for (let index = revealed; index < 3; index++) {
      const at = index * 45000 + schedule.before_ms;
      if (elapsed < at) break;
      if (condition === 'precommitment') exposure.session.recordPrecommitment(index + 1, exposure.choices[index] ?? null);
      exposure.session.playbackStep();
      timings.push({ window: index, revealed_at: exposure.started + at, actual_elapsed_ms: elapsed }); revealed++;
    }
    if (revealed !== exposure.revealed) { setExposure({ ...exposure, revealed, timings }); return; }
    if (elapsed >= 135000) {
      exposure.session.beginRecoveryAt(exposure.started + 135000);
      const handover = sha256Json(exposure.session.getView().plant);
      if (handover !== manifest.handover_sha256) { setStatus('Handover differs from the frozen trace. Rehearsal stopped.'); return; }
      const receipt = { schema_version: '1.0', synthetic: true, researchEligible: false, condition, scenario, exposure_started_at: exposure.started, scheduled_handover_at: exposure.started + 135000, factual_payload_sha256: manifest.factual_payload_sha256, handover_sha256: handover, choices: exposure.choices, timings: exposure.timings, commands: exposure.session.getView().history };
      let persistenceAvailable = true;
      try { localStorage.setItem('after-the-agent.rehearsal-evidence.v1', JSON.stringify(receipt)); localStorage.removeItem(key); } catch { persistenceAvailable = false; }
      onStart(exposure.session, receipt, persistenceAvailable);
    }
  }, [now, exposure, scenario, condition, manifest, onStart]);
  useEffect(() => {
    if (!exposure) return;
    try { localStorage.setItem(key, JSON.stringify({ schema_version: '1.0', scenario, condition, started: exposure.started, revealed: exposure.revealed, choices: exposure.choices, timings: exposure.timings, session: saveSession(exposure.session), manifest_sha256: manifest.factual_payload_sha256 })); } catch { setStatus('Local exposure persistence unavailable. Timing is still local, not research evidence.'); }
  }, [exposure, scenario, condition, manifest]);
  useEffect(() => { document.getElementById('study-heading')?.focus(); }, []);
  const begin = () => { const session = createSession({ scenario, mode: 'local_rehearsal', condition, now: Date.now }, evaluator, buildCorpus); setExposure({ session, started: Date.now(), revealed: 0, choices: [null, null, null], timings: [] }); };
  const resume = () => {
    try {
      const raw = localStorage.getItem(key); if (!raw || raw.length > 2_000_000) throw new Error('No compatible rehearsal is saved.');
      const data = JSON.parse(raw) as Record<string, unknown>;
      if (data.schema_version !== '1.0' || !Number.isSafeInteger(data.started) || typeof data.started !== 'number' || data.started > Date.now() || !Number.isInteger(data.revealed) || typeof data.revealed !== 'number' || data.revealed < 0 || data.revealed > 3 || !Array.isArray(data.choices) || data.choices.length !== 3 || !Array.isArray(data.timings) || !['observation','precommitment'].includes(String(data.condition)) || !['stale-queue','duplicate-clock','cached-gate'].includes(String(data.scenario))) throw new Error('Saved rehearsal is invalid.');
      const restoredScenario = data.scenario as ScenarioFamily;
      if (data.manifest_sha256 !== factualManifest(restoredScenario).factual_payload_sha256) throw new Error('The factual manifest changed.');
      if (data.choices.some((choice, index) => choice !== null && !factualManifest(restoredScenario).windows[index]!.alternatives.includes(String(choice)))) throw new Error('Saved choices are invalid.');
      const session = restoreSession(data.session, evaluator, buildCorpus, { now: Date.now });
      if (session.getView().mode !== 'local_rehearsal' || session.getView().condition !== data.condition || session.getView().scenario !== restoredScenario || !['setup','playback'].includes(session.getView().phase) || session.getView().history.length !== data.revealed) throw new Error('Saved exposure does not match its session.');
      setScenario(restoredScenario); setCondition(data.condition as StudyCondition); setExposure({ session, started: data.started, revealed: data.revealed, choices: data.choices as (string|null)[], timings: data.timings as Exposure['timings'] });
    } catch (error) { setStatus(`Cannot resume rehearsal: ${error instanceof Error ? error.message : 'invalid data'}`); }
  };
  const elapsed = exposure ? Math.max(0, now - exposure.started) : 0;
  const window = Math.min(2, Math.floor(elapsed / 45000));
  const revealed = elapsed % 45000 >= 25000;
  const card = manifest.windows[window]!;
  return <section className="study panel"><p className="eyebrow">Synthetic local rehearsal · collection disabled</p><h1 id="study-heading" tabIndex={-1}>Rehearse the matched instrument.</h1><p>This is engineering preparation. It creates no participant assignment or server receipt. Local exports are ineligible for research.</p>{!exposure ? <><fieldset><legend>Local condition</legend><label className="radio"><input type="radio" name="condition" checked={condition === 'observation'} onChange={() => setCondition('observation')}/>Observation</label><label className="radio"><input type="radio" name="condition" checked={condition === 'precommitment'} onChange={() => setCondition('precommitment')}/>Pre-commitment</label></fieldset><label className="field">Local scenario<select value={scenario} onChange={event => setScenario(event.target.value as ScenarioFamily)}><option value="stale-queue">Stale queue</option><option value="duplicate-clock">Duplicate clock</option><option value="cached-gate">Cached gate</option></select></label><p>Three windows: 25 seconds before reveal and 20 seconds after reveal. Both arms see the same factual cards, executed actions and final handover.</p><button className="primary" onClick={begin}>Begin synthetic rehearsal</button><button onClick={resume}>Resume saved rehearsal</button></> : <><p>Window {window + 1} of 3 · {revealed ? 'Action revealed' : 'Before reveal'}</p><p className="time">{Math.max(0, Math.ceil(((revealed ? 45000 : 25000) - elapsed % 45000) / 1000))} seconds</p><p>{card.before}</p><h2>Action alternatives</h2><ul>{card.alternatives.map(choice => <li key={choice}>{choice}</li>)}</ul>{condition === 'precommitment' && !revealed && <fieldset className="choices"><legend>Which action do you think should happen next? Your choice does not change the system.</legend>{card.alternatives.map(choice => <label key={choice}><input type="radio" name={`window-${window}`} value={choice} checked={exposure.choices[window] === choice} onChange={() => { const choices = [...exposure.choices]; choices[window] = choice; setExposure({ ...exposure, choices }); }}/>{choice}</label>)}</fieldset>}{revealed && <><h2>Executed: {actionLabel(card.action)}</h2><p>Resulting settled tick: {exposure.session.getView().plant.tick}. Queue: {exposure.session.getView().plant.queue.length} jobs. Scene version: {exposure.session.getView().plant.world.epoch}.</p><details><summary>Actual action diff and state</summary><p>Before: tick {card.before_plant.tick}, scene {card.before_plant.world.scene_id}, version {card.before_plant.world.epoch}, {card.before_plant.queue.length} queued jobs.</p><Installation plant={exposure.session.getView().plant} events={exposure.session.getView().events} setup/><History events={exposure.session.getView().events}/></details></>}<p className="hint">Scripted preview. No advice is added based on your choice.</p></>}<p role="status">{status}</p><p className="hint">Factual payload: {manifest.factual_payload_sha256}<br/>Handover: {manifest.handover_sha256}</p></section>;
}
