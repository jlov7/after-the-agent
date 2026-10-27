import { useEffect, useMemo, useRef, useState } from 'react';
import type { SubmissionRecord } from '../../../../packages/engine/src/session.js';
import { buildCorpus } from '../../../../packages/runner/src/continuations.js';
import { prepareRepairBranch, repairActionLimit, type RepairEdit, type RepairLabResult } from '../../../../packages/runner/src/repair-lab.js';
import { startRepairLab } from '../lab/client.js';
import './repair-lab.css';
interface RepairLabProps { submissions: readonly SubmissionRecord[]; remainingMs: number; onClose: () => void }
export function RepairLab({ submissions, remainingMs, onClose }: RepairLabProps) {
  const [baseIndex, setBaseIndex] = useState(Math.max(0, submissions.length - 1));
  const base = submissions[baseIndex]?.candidate;
  const [edits, setEdits] = useState<readonly [readonly RepairEdit[], readonly RepairEdit[]]>([[], []]);
  const [caseId, setCaseId] = useState('quiet-prefix'), [result, setResult] = useState<RepairLabResult | null>(null);
  const [positions, setPositions] = useState([0, 0]), [pending, setPending] = useState(false), [status, setStatus] = useState('Choose two alternatives, then compare their continuations.');
  const generation = useRef(0), active = useRef<{ cancel: () => void } | null>(null), heading = useRef<HTMLHeadingElement>(null);
  const cancel = () => { generation.current++; active.current?.cancel(); active.current = null; setPending(false); };
  useEffect(() => { heading.current?.focus(); return () => { generation.current++; active.current?.cancel(); }; }, []);
  useEffect(() => { generation.current++; active.current?.cancel(); active.current = null; setPending(false); setResult(null); setEdits([[], []]); setPositions([0, 0]); }, [base]);
  const preview = useMemo(() => base ? edits.map(actions => prepareRepairBranch(base, actions)) : [], [base, edits]);
  const cases = useMemo(() => base ? buildCorpus(base).cases : [], [base]);
  const update = (index: number, action?: RepairEdit) => {
    cancel(); setResult(null); setPositions([0, 0]);
    try {
      const next = edits.map((actions, i) => i === index ? action ? [...actions, action] : [] : actions) as [readonly RepairEdit[], readonly RepairEdit[]];
      if (base) prepareRepairBranch(base, next[index]);
      setEdits(next); setStatus('Alternative edited locally. Compare again for fresh continuation outcomes.');
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Repair edit rejected'); }
  };
  const compare = async () => {
    if (!base) return;
    cancel(); const current = generation.current; setResult(null); setPending(true); setStatus('Comparing two isolated branches locally.');
    try {
      const task = startRepairLab(base, edits, caseId); active.current = task;
      const response = await task.promise; if (current !== generation.current) return;
      setResult(response); setPositions([0, 0]); setStatus('Exploratory comparison complete. Stored checks and the live board are unchanged.');
    } catch (error) { if (current === generation.current) setStatus(`Comparison unavailable: ${error instanceof Error ? error.message : 'worker failed'}`); }
    finally { if (current === generation.current) { active.current = null; setPending(false); } }
  };
  return <section className="repair-lab panel" aria-labelledby="repair-lab-heading" aria-busy={pending}>
    <div className="repair-lab-heading"><h2 id="repair-lab-heading" tabIndex={-1} ref={heading}>Repair lab</h2><button onClick={() => { cancel(); onClose(); }}>Close repair lab</button></div>
    <p>Explore two alternatives from one retained frozen check. This is an exploratory comparison, separate from the live attempt and stored check results. Your recovery deadline continues: <strong>{Math.ceil(Math.max(0, remainingMs) / 1000)} seconds remaining</strong>.</p>
    {!base ? <p>Run a check on the live board first to retain a shared base.</p> : <>
      <label className="field">Shared frozen check<select value={baseIndex} onChange={event => { cancel(); setEdits([[], []]); setResult(null); setPositions([0, 0]); setBaseIndex(Number(event.target.value)); }}>{submissions.map((submission, i) => <option key={i} value={i}>Check {i + 1}, tick {submission.candidate.capture_tick}, {submission.evaluation?.status ?? 'pending'}</option>)}</select></label>
      <p>Base candidate SHA-256: <code>{base.candidate_sha256}</code></p><p>Both alternatives begin at tick {base.capture_tick} with {base.plant.queue.length} pending jobs. Editing never advances time.</p>
      <div className="repair-lab-branches">{preview.map((branch, index) => {
        const plant = branch.candidate.plant, full = edits[index]!.length >= repairActionLimit, outcome = result?.branches[index], frame = outcome?.inspection.frames[positions[index] ?? 0];
        return <section key={index} aria-label={`Alternative ${index + 1}`} className="repair-lab-branch"><h3>Alternative {index + 1}</h3>
          <p>{edits[index]!.length} of {repairActionLimit} repair edits. <button disabled={!edits[index]!.length} onClick={() => update(index)}>Clear alternative {index + 1} edits</button></p>
          <fieldset disabled={full}><legend>Repair controls for alternative {index + 1}</legend>
            {(['primary', 'shadow'] as const).map(clock => <label key={clock}><input type="checkbox" checked={plant.config.clocks[clock]} onChange={event => update(index, { type: 'set_clock', clock, enabled: event.target.checked })}/>{clock === 'primary' ? 'Primary clock' : 'Standby clock'}</label>)}
            <label><input type="checkbox" checked={plant.config.epoch_guard} onChange={event => update(index, { type: 'set_epoch_guard', enabled: event.target.checked })}/>Version guard</label>
            <label className="field">Gate source<select value={plant.config.gate_mode} onChange={event => update(index, { type: 'set_gate_mode', mode: event.target.value as 'live' | 'cached' })}><option value="live">Live world</option><option value="cached">Cached world</option></select></label>
            <button onClick={() => update(index, { type: 'refresh_gate' })}>Refresh cached gate</button>
            <p>Cached active {String(plant.gate_cache.active)}, version {plant.gate_cache.epoch}. Pending queue ({plant.queue.length}):</p>
            {plant.queue.length ? <ul>{plant.queue.map(job => <li key={job.id}><code>{job.id}</code> due {job.due_tick} <button onClick={() => update(index, { type: 'drop_jobs', job_ids: [job.id] })}>Drop {job.id}</button></li>)}</ul> : <p>No pending jobs.</p>}
          </fieldset>
          <details open><summary>Immediate configuration and state diff</summary>{branch.changes.length ? <dl>{branch.changes.map(change => <div key={change.path}><dt>{change.path}</dt><dd><span>Before</span><pre>{change.before}</pre><span>After</span><pre>{change.after}</pre></dd></div>)}</dl> : <p>No changes from the shared base.</p>}</details>
          <p>Edits SHA-256: <code>{branch.edits_sha256}</code></p><p>Branch candidate SHA-256: <code>{branch.candidate.candidate_sha256}</code></p>
          {outcome && <><h4>Exploratory continuation result: {outcome.evaluation.status}</h4><p>All twelve cases share the regenerated schedules. A pass here does not replace a check of the live attempt.</p><ul>{outcome.evaluation.cases.map(c => <li key={c.case_id}>{c.case_id}: {c.status}, missing {c.missing.length}, extra {c.extra.length}</li>)}</ul>
            {frame && <section aria-label={`Alternative ${index + 1} continuation frame`}><label className="field">Continuation frame for alternative {index + 1}<input type="range" min={0} max={outcome.inspection.frames.length - 1} value={positions[index] ?? 0} onChange={event => setPositions(previous => previous.map((position, i) => i === index ? Number(event.target.value) : position))}/></label><p>{outcome.inspection.case_id}, tick {frame.tick}. Required left {frame.expected.left}, center {frame.expected.center}, right {frame.expected.right}. Observed left {frame.observed.left}, center {frame.observed.center}, right {frame.observed.right}.</p><p>Queue {frame.plant.queue.length}, world version {frame.plant.world.epoch}. Frame belongs to base <code>{result!.base_candidate_sha256}</code> and edits <code>{outcome.edits_sha256}</code>.</p></section>}
          </>}
        </section>;
      })}</div>
      <label className="field">Continuation case for frame comparison<select value={caseId} onChange={event => { cancel(); setResult(null); setCaseId(event.target.value); }}>{cases.map(c => <option key={c.case_id}>{c.case_id}</option>)}</select></label>
      <button disabled={pending} onClick={() => void compare()}>Compare two alternatives</button>{pending && <button onClick={() => { cancel(); setStatus('Comparison cancelled.'); }}>Cancel lab comparison</button>}
    </>}
    <p role="status">{status}</p>
  </section>;
}
