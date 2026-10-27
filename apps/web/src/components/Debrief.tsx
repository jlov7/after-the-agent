import { useEffect, useMemo, useRef } from 'react';
import type { EvaluationResult, FrozenCandidate, Pulse } from '../../../../packages/contracts/src/index.js';
import type { SubmissionRecord } from '../../../../packages/engine/src/session.js';
import { explainFailure } from '../../../../packages/runner/src/failure-explanation.js';
import './interaction.css';
function differences(result: EvaluationResult) {
  return result.cases.flatMap(item => {
    const keys = new Map<string, Pulse>();
    for (const pulse of [...item.missing, ...item.extra]) keys.set(`${pulse.tick}.${pulse.lamp}`, pulse);
    const observed = result.observations.find(observation => observation.case_id === item.case_id);
    return [...keys.values()].sort((a, b) => a.tick - b.tick || a.lamp.localeCompare(b.lamp)).map(pulse => {
      const matches = (value: Pulse) => value.tick === pulse.tick && value.lamp === pulse.lamp;
      const actual = observed?.pulses.filter(matches).length ?? 0;
      return { ...pulse, case_id: item.case_id, observed: actual, expected: actual + item.missing.filter(matches).length - item.extra.filter(matches).length };
    });
  });
}
export function Debrief({ result, candidate, currentHash, currentTick, practice, onExplore, submission }: { result: EvaluationResult | null; candidate: FrozenCandidate | null; currentHash: string; currentTick: number; practice: boolean; submission?: SubmissionRecord | null; onExplore?: (caseId: string) => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (result) heading.current?.focus(); }, [result]);
  const rows = useMemo(() => result ? differences(result) : [], [result]);
  const first = rows[0];
  const explanation = useMemo(() => practice && first && submission && submission.candidate.candidate_sha256 === result?.candidate_sha256 ? explainFailure(submission, first.case_id, first.tick, first.lamp) : null, [practice, first, submission, result]);
  const stale = !!result && result.candidate_sha256 !== currentHash;
  return <section id="result" className={`debrief panel ${result ? result.status === 'pass' ? 'passed' : 'checked' : ''}`} aria-label="Repair check" data-candidate-sha256={result?.candidate_sha256} data-checked-attempt={candidate?.attempt_id} data-checked-tick={candidate?.capture_tick} data-current-tick={currentTick}>
    <p className="eyebrow">Your repair check</p><h2 ref={heading} id="result-heading" tabIndex={-1}>{result?.status === 'pass' ? 'Repair held' : result?.status === 'mismatch' ? 'Repair did not hold' : result ? 'Check incomplete' : 'Check what happens next'}</h2>
    {result ? <><div className={`candidate-state${stale ? ' stale' : ''}`}><strong>{stale ? 'Board changed since this check' : 'Current board matches this check'}</strong><span>Checked tick {candidate?.capture_tick ?? '?'} · Current tick {currentTick}</span>{stale && <p>This result belongs to the earlier board. Check repair again to test your changes.</p>}</div><p className="check-total">{result.status === 'pass' ? `All ${result.cases.length} future scenarios passed` : result.status === 'mismatch' ? `${result.cases.filter(item => item.status !== 'pass').length} of ${result.cases.length} future scenarios failed` : result.reason}</p>{result.status === 'mismatch' && <p>Observed {result.cases.reduce((sum, item) => sum + item.missing.length, 0)} missing and {result.cases.reduce((sum, item) => sum + item.extra.length, 0)} extra pulses. Counts include simultaneous duplicates.</p>}
      {first && <section className="counterexample" aria-label="First counterexample"><strong>First counterexample · {first.case_id}</strong><p>Tick {first.tick} · {first.lamp.charAt(0).toUpperCase() + first.lamp.slice(1)}</p><div><span>Expected <strong>{first.expected}</strong></span><span>Observed <strong>{first.observed}</strong></span></div>{practice && <p>{first.expected < first.observed ? 'The installation delivered more pulses than this scenario required.' : 'The installation missed a pulse that this scenario required.'} The table below comes from the actual checker trace.</p>}{explanation && <div className="ata-failure-explanation" aria-label="Factual pulse explanation"><strong>{explanation.status === 'unknown' ? 'Explanation unavailable' : 'Facts behind this count'}</strong><ul>{explanation.facts.map((fact, index) => <li key={index}>{fact}</li>)}</ul>{explanation.event_seqs.length > 0 && <p>Continuation events: {explanation.event_seqs.map(seq => `#${seq}`).join(', ')}.</p>}{explanation.job_ids.length > 0 && <p>Jobs: {explanation.job_ids.join(', ')}.</p>}</div>}{onExplore && <button onClick={() => onExplore(first.case_id)}>Explore this continuation</button>}</section>}
      {practice && result.status === 'pass' && !stale && <p className="repair-complete">This passing check is retained in this run. Save a progress file to resume, or export the evidence to inspect this result. You can keep experimenting until the original deadline; later edits need another check.</p>}
      <p>These checks start from your settings and pending work at tick {candidate?.capture_tick ?? '?'}. They test 12 fixed future scenarios and wait for all queued work to finish.</p><details><summary>See all checks and technical details</summary><ul className="case-results">{result.cases.map(item => <li key={item.case_id}><strong>{item.case_id}</strong><span>{item.status} · {item.missing.length} missing · {item.extra.length} extra</span></li>)}</ul>{rows.length > 0 && <div className="table-scroll"><table><caption>Exact expected and observed pulse counts</caption><thead><tr><th>Case</th><th>Tick / lamp</th><th>Expected</th><th>Observed</th></tr></thead><tbody>{rows.slice(0, 256).map(row => <tr key={`${row.case_id}.${row.tick}.${row.lamp}`}><td>{row.case_id}</td><td>{row.tick} / {row.lamp}</td><td>{row.expected}</td><td>{row.observed}</td></tr>)}</tbody></table>{rows.length > 256 && <p>First 256 mismatches shown. Download includes all {rows.length}.</p>}</div>}<p className="hint">Frozen candidate {result.candidate_sha256.slice(0, 12)}. Checks include the final queue drain. Earlier diagnostic output stays in the attempt history.</p></details>
      {practice && result.status === 'mismatch' && <p className="hint">Compare the queue versions, clock sources and gate activity. Make an edit, then check your repair again.</p>}
    </> : <p>Try your current settings and pending work against 12 fixed future scenarios. The checker compares every pulse and waits for all queued work to finish. Your live board stays unchanged.</p>}
  </section>;
}
