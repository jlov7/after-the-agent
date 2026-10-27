import { useEffect, useMemo, useRef, useState } from 'react';
import type { DomainEvent, Job } from '../../../../packages/contracts/src/index.js';
import type { SubmissionRecord } from '../../../../packages/engine/src/session.js';
import type { ContinuationInspection } from '../../../../packages/runner/src/inspection-types.js';
import { compareSubmissions, traceJob } from '../../../../packages/runner/src/inspection.js';
import { inspectContinuationInWorker } from '../inspection/client.js';
import { eventText } from '../session/labels.js';
import { Installation } from './Installation.js';
import './inspection.css';

export interface InspectionPanelProps {
  attemptId: string;
  events: readonly DomainEvent[];
  queue: readonly Job[];
  submissions: readonly SubmissionRecord[];
  initialJobId?: string | null;
  initialCaseId?: string | null;
  remainingMs: number;
  onClose: () => void;
}
interface InspectionState {
  submission: SubmissionRecord;
  caseId: string;
  result: ContinuationInspection | null;
  error: string | null;
}
const frozenLabel = (submission: SubmissionRecord, index: number) => `Check ${index + 1} · tick ${submission.candidate.capture_tick} · ${submission.evaluation?.status ?? 'pending'} · ${submission.candidate.candidate_sha256.slice(0, 12)}`;

// Attempt changes remount the read-only view and cancel its previous worker.
export function InspectionPanel(props: InspectionPanelProps) {
  return <InspectionContent key={props.attemptId} {...props}/>;
}
function InspectionContent({ attemptId, events, queue, submissions, initialJobId, initialCaseId, remainingMs, onClose }: InspectionPanelProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [chosenCheck, setChosenCheck] = useState<number | null>(null);
  const [chosenCase, setChosenCase] = useState(initialCaseId ?? '');
  const [chosenJob, setChosenJob] = useState(initialJobId ?? '');
  const [beforeIndex, setBeforeIndex] = useState(0);
  const [afterIndex, setAfterIndex] = useState<number | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [inspection, setInspection] = useState<InspectionState | null>(null);
  const [diagnosticStatus, setDiagnosticStatus] = useState('');
  const checkIndex = chosenCheck ?? submissions.length - 1;
  const submission = submissions[checkIndex];
  const caseId = chosenCase || submission?.corpus.cases[0]?.case_id || '';
  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => { if (initialJobId) setChosenJob(initialJobId); }, [initialJobId]);
  useEffect(() => { if (initialCaseId) { setChosenCase(initialCaseId); setFrameIndex(0); } }, [initialCaseId]);
  useEffect(() => {
    if (!submission || !caseId) return;
    let active = true;
    let cancel: (() => void) | undefined;
    try {
      const task = inspectContinuationInWorker(submission.candidate, submission.corpus, caseId);
      cancel = task.cancel;
      void task.promise.then(result => {
        if (!active) return;
        setFrameIndex(0);
        setInspection({ submission, caseId, result, error: null });
      }).catch(error => {
        if (active) setInspection({ submission, caseId, result: null, error: error instanceof Error ? error.message : 'Worker failed' });
      });
    } catch (error) {
      setInspection({ submission, caseId, result: null, error: error instanceof Error ? error.message : 'Worker could not start' });
    }
    return () => { active = false; cancel?.(); };
  }, [attemptId, submission, caseId]);
  const current = inspection && inspection.submission === submission && inspection.caseId === caseId ? inspection : null;
  const result = current?.result;
  const frame = result?.frames[frameIndex];
  const frameEvents = useMemo(() => result?.frames.slice(0, frameIndex + 1).flatMap(item => item.events) ?? [], [result, frameIndex]);
  const mismatchIndex = result?.frames.findIndex(item => item.tick === result.first_mismatch_tick) ?? -1;
  const jobIds = useMemo(() => {
    const ids = new Set(queue.map(job => job.id));
    for (const event of events) {
      if (event.type === 'job_enqueued') ids.add(event.job.id);
      if (event.type === 'pulse' || event.type === 'job_discarded') ids.add(event.job_id);
      if (event.type === 'jobs_dropped') for (const id of event.job_ids) ids.add(id);
    }
    return [...ids];
  }, [events, queue]);
  const jobId = chosenJob || jobIds[0] || '';
  const job = useMemo(() => jobId ? traceJob(jobId, events, queue) : null, [jobId, events, queue]);
  const before = submissions[beforeIndex];
  const after = submissions[afterIndex ?? submissions.length - 1];
  const comparison = useMemo(() => before && after ? compareSubmissions(before, after) : null, [before, after]);
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  return <section className="behavior-inspection panel" aria-label="Behavior inspection" data-attempt-id={attemptId}>
    <div className="inspection-heading"><div><p className="eyebrow">Read-only exploration</p><h2 id="behavior-inspection-heading" tabIndex={-1} ref={heading}>Behavior inspection</h2></div><button onClick={onClose}>Close behavior inspection</button></div>
    <p>Continuation playback uses a frozen check, including its pending work. Following jobs uses this attempt’s actual journal. These controls do not edit or advance your live board.</p>
    <p className="inspection-deadline">{seconds > 0 ? `Recovery wall time remaining: ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}. The deadline keeps running while inspecting.` : 'Recovery time has ended. Frozen inspection remains available.'}</p>
    <section aria-label="Frozen continuation playback"><h3>Play a continuation</h3>
      {!submission ? <p role="status">No frozen checks yet. Use Check repair on the live board to retain a candidate and its continuations.</p> : <>
        <div className="inspection-fields"><label>Inspect frozen check<select aria-label="Inspect frozen check" value={checkIndex} onChange={event => { setChosenCheck(Number(event.target.value)); setFrameIndex(0); }}>{submissions.map((item, index) => <option key={index} value={index}>{frozenLabel(item, index)}</option>)}</select></label><label>Continuation case<select aria-label="Continuation case" value={caseId} onChange={event => { setChosenCase(event.target.value); setFrameIndex(0); }}>{submission.corpus.cases.map(item => <option key={item.case_id} value={item.case_id}>{item.case_id}</option>)}</select></label></div>
        <p className="hint">Frozen at tick {submission.candidate.capture_tick}. Candidate {submission.candidate.candidate_sha256}. Attempt {submission.candidate.attempt_id}. Stored check: {submission.evaluation?.status ?? 'pending'}.</p>
        <button disabled={!submission.evaluation} onClick={() => { setDiagnosticStatus(''); void import('../../../../packages/runner/src/diagnostic.js').then(module => {
          const raw = JSON.stringify(module.createReproducer(submission, caseId), null, 2), url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
          const link = document.createElement('a'); link.href = url; link.download = `after-the-agent-case-${caseId}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        }).catch(error => setDiagnosticStatus(`Diagnostic unavailable: ${error instanceof Error ? error.message : 'invalid retained observation'}`)); }}>Download this case reproducer</button>
        <p className="hint">One canonical case and its exact observed pulses, including final drain. A diagnostic is not a twelve-case repair qualification.</p>{diagnosticStatus && <p role="status">{diagnosticStatus}</p>}
        {!submission.evaluation && <p role="status">The original check is pending. Playback shows the frozen candidate’s actual continuation, without changing its stored result.</p>}
        {submission.evaluation && !['pass', 'mismatch'].includes(submission.evaluation.status) && <p role="status">Stored check {submission.evaluation.status}: {submission.evaluation.reason ?? 'No completed check result.'}</p>}
        {current?.error ? <p role="status">Continuation inspection unavailable: {current.error}</p> : !result ? <p role="status">Loading frozen continuation…</p> : !frame ? <p role="status">No continuation frames are available.</p> : <>
          <div className="inspection-tick-controls"><button disabled={frameIndex === 0} onClick={() => setFrameIndex(index => Math.max(0, index - 1))}>Previous tick</button><button disabled={frameIndex >= result.frames.length - 1} onClick={() => setFrameIndex(index => Math.min(result.frames.length - 1, index + 1))}>Next tick</button><button disabled={mismatchIndex < 0} onClick={() => setFrameIndex(mismatchIndex)}>Jump to first mismatch</button></div>
          <label className="inspection-range">Continuation tick<input type="range" min={0} max={result.frames.length - 1} value={frameIndex} aria-valuetext={`Tick ${frame.tick}`} onChange={event => setFrameIndex(Number(event.target.value))}/></label>
          <output aria-label="Selected continuation tick">Tick {frame.tick} · frame {frameIndex + 1} of {result.frames.length}{frame.tick > (submission.corpus.cases.find(item => item.case_id === caseId)?.enqueue_until_tick ?? Infinity) ? ' · Final drain' : frameIndex === 0 ? ' · Frozen cut' : ''}</output>
          <p className="hint">{result.first_mismatch_tick === null ? 'No pulse count mismatch in this continuation.' : `First pulse count mismatch: tick ${result.first_mismatch_tick}.`} All ticks include settled actual state, through the two-tick final drain.</p>
          <div className="inspection-table"><table><caption>Exact pulse counts at selected tick</caption><thead><tr><th>Lamp</th><th>Expected</th><th>Observed</th></tr></thead><tbody>{(['left', 'center', 'right'] as const).map(lamp => <tr key={lamp}><th scope="row">{lamp}</th><td>{frame.expected[lamp]}</td><td>{frame.observed[lamp]}</td></tr>)}</tbody></table></div>
          <section aria-label="Frozen continuation board"><h3>Frozen actual board at tick {frame.tick}</h3><Installation plant={frame.plant} events={frameEvents}/><p>Cached gate: {frame.plant.gate_cache.active ? 'active' : 'inactive'}, version {frame.plant.gate_cache.epoch}. Actual world: {frame.plant.world.active ? 'active' : 'inactive'}, version {frame.plant.world.epoch}.</p></section>
          <div className="inspection-table"><table><caption>Actual pending queue at tick {frame.tick} ({frame.plant.queue.length})</caption><thead><tr><th>Job</th><th>Clock / lamp</th><th>Enqueued</th><th>Due</th><th>Version</th></tr></thead><tbody>{frame.plant.queue.map(item => <tr key={item.id}><th scope="row">{item.id}</th><td>{item.clock} / {item.lamp}</td><td>{item.enqueue_tick}</td><td>{item.due_tick}</td><td>{item.enqueue_epoch}</td></tr>)}</tbody></table>{!frame.plant.queue.length && <p>No pending jobs at this tick.</p>}</div>
          <details><summary>Actual events at tick {frame.tick} and complete plant state</summary>{frame.events.length ? <ol>{frame.events.map(event => <li key={event.seq}>{eventText(event)}</li>)}</ol> : <p>No events at the frozen cut.</p>}<pre>{JSON.stringify(frame.plant, null, 2)}</pre></details>
        </>}
      </>}
    </section>
    <section aria-label="Job lineage"><h3>Follow an actual job</h3><p className="hint">Source: this attempt’s journal and current pending queue. Continuation events above are separate frozen playback.</p>
      {jobIds.length ? <label>Follow job<select value={jobId} onChange={event => setChosenJob(event.target.value)}>{jobIds.map(id => <option key={id} value={id}>{id}</option>)}</select></label> : <p>No job IDs in the current journal or pending queue.</p>}
      {job && <><p><strong>Outcome: {job.outcome}</strong></p>{job.job && <p>{job.job.clock} clock · {job.job.lamp} · Enqueued tick {job.job.enqueue_tick} · due tick {job.job.due_tick} · queued version {job.job.enqueue_epoch}</p>}{!job.enqueue_recorded && <p>Enqueue event is not recorded in the supplied journal. {job.job ? 'The pending job retains its enqueue metadata.' : 'Enqueue metadata is unavailable.'}</p>}{job.events.length ? <ol className="inspection-lineage">{job.events.map(event => <li key={event.seq}><strong>Tick {event.tick}</strong> {eventText(event)}</li>)}</ol> : <p>No recorded lifecycle events for this job.</p>}</>}
    </section>
    <section aria-label="Frozen repair comparison"><h3>Compare frozen repairs</h3><p>Compare retained checks, including their configuration and dynamic state.</p>
      {submissions.length < 2 ? <p role="status">Two frozen checks are needed for comparison. Each Check repair retains the exact candidate, queue and result.</p> : <>
        <div className="inspection-fields"><label>Before frozen check<select value={beforeIndex} onChange={event => setBeforeIndex(Number(event.target.value))}>{submissions.map((item, index) => <option key={index} value={index}>{frozenLabel(item, index)}</option>)}</select></label><label>After frozen check<select value={afterIndex ?? submissions.length - 1} onChange={event => setAfterIndex(Number(event.target.value))}>{submissions.map((item, index) => <option key={index} value={index}>{frozenLabel(item, index)}</option>)}</select></label></div>
        {comparison && <>{!comparison.same_context && <div className="inspection-context" role="note"><strong>Different capture context</strong><p>These checks are not a controlled improvement comparison.</p><ul>{comparison.context_notes.map(note => <li key={note}>{note}</li>)}</ul></div>}{(!before?.evaluation || !after?.evaluation) && <p role="status">A selected check is pending. Its continuation result remains pending.</p>}
          <div className="inspection-table"><table><caption>Exact frozen state differences</caption><thead><tr><th>State field</th><th>Before</th><th>After</th></tr></thead><tbody>{comparison.changes.map(change => <tr key={change.path}><th scope="row">{change.path}</th><td>{change.before}</td><td>{change.after}</td></tr>)}</tbody></table>{!comparison.changes.length && <p>No frozen state differences.</p>}</div>
          <div className="inspection-table"><table><caption>Continuation result comparison</caption><thead><tr><th>Case</th><th>Before</th><th>After</th></tr></thead><tbody>{comparison.cases.map(item => <tr key={item.case_id}><th scope="row">{item.case_id}</th><td>{item.before}</td><td>{item.after}</td></tr>)}</tbody></table></div>
        </>}
      </>}
    </section>
  </section>;
}
