import { useState } from 'react';
import { createEngine, defaultTask, dispatch, engineAudit, engineEvents, snapshot } from '../../../../packages/engine/src/index.js';
import type { Action, EngineHandle, SetupSpec } from '../../../../packages/contracts/src/index.js';
import './learning.css';

type Lesson = 'queue' | 'version' | 'cache';
const lessons = [
  { id: 'queue', title: 'Queued work', question: 'The primary clock is now off. Will the job already in the queue still deliver at tick 6?', explanation: 'Disabling a clock prevents new work. It preserves jobs already queued.' },
  { id: 'version', title: 'Scene version', question: 'Blue changes to amber at tick 5. Will the blue job deliver at tick 6?', explanation: 'The scene change increments its version. The delivery guard discards a job whose enqueue version differs. With the guard off, the stale job delivers.' },
  { id: 'cache', title: 'Cached activity', question: 'The gate was refreshed while active at tick 4. Activity ends at tick 8. Will cached mode deliver a new pulse at tick 10?', explanation: 'Refresh stores activity once. At tick 8 the cached gate still opens, while the live gate stays closed. The new cached job has the current version, so the delivery guard admits it.' },
] as const;

function act(engine: EngineHandle, action: Action): void {
  const plant = snapshot(engine);
  const result = dispatch(engine, { schema_version: '1.0', request_id: `lesson.${plant.revision + 1}`, expected_revision: plant.revision, action }, { actor_id: 'isolated-lesson', role: 'controller', phase: 'setup' });
  if (result.outcome !== 'accepted') throw new Error(`Example action rejected: ${result.error?.code}`);
}

function createExample(lesson: Lesson, guard: boolean) {
  const setup: SetupSpec = {
    task: { ...defaultTask('valid-pending'), enqueue_until_tick: lesson === 'cache' ? 8 : 4 },
    world: { initial_world: { scene_id: 'blue', active: true }, transitions: lesson === 'version' ? [{ tick: 5, scene_id: 'amber', active: true }] : lesson === 'cache' ? [{ tick: 8, scene_id: 'blue', active: false }] : [] },
    config: { clocks: { primary: true, shadow: false }, gate_mode: lesson === 'cache' ? 'cached' : 'live', epoch_guard: guard },
  };
  const engine = createEngine(setup);
  const live = lesson === 'cache' ? createEngine({ ...setup, config: { ...setup.config, gate_mode: 'live' } }) : null;
  for (const lane of live ? [engine, live] : [engine]) {
    act(lane, { type: 'advance', ticks: 4 });
    if (lesson === 'queue') act(lane, { type: 'set_clock', clock: 'primary', enabled: false });
    if (lesson === 'cache') { act(lane, { type: 'refresh_gate' }); act(lane, { type: 'advance', ticks: 2 }); }
  }
  return { engine, live, startTick: snapshot(engine).tick, completed: false };
}

export function LearningLab() {
  const [lesson, setLesson] = useState<Lesson>('queue');
  const [guard, setGuard] = useState(true);
  const [example, setExample] = useState(() => createExample('queue', true));
  const [prediction, setPrediction] = useState<number | null>(null);
  const current = lessons.find(item => item.id === lesson)!;
  const plant = snapshot(example.engine);
  const observed = engineEvents(example.engine).filter(event => event.type === 'pulse' && event.tick > example.startTick).length;
  const discarded = engineEvents(example.engine).filter(event => event.type === 'job_discarded' && event.tick > example.startTick).length;
  const liveObserved = example.live ? engineEvents(example.live).filter(event => event.type === 'pulse' && event.tick > example.startTick).length : null;
  const reset = (next: Lesson = lesson, nextGuard = guard) => {
    setLesson(next); setGuard(nextGuard); setPrediction(null); setExample(createExample(next, nextGuard));
  };
  const advance = () => {
    if (prediction === null || example.completed) return;
    act(example.engine, { type: 'advance', ticks: lesson === 'cache' ? 4 : 2 });
    if (example.live) act(example.live, { type: 'advance', ticks: 4 });
    setExample({ ...example, completed: true });
  };
  return <section className="learning-lab panel" aria-label="Interactive concept lessons">
    <p className="eyebrow">Isolated engine examples</p><h2>Try the mechanics</h2>
    <p>Predict, then run the same deterministic engine used by the board. These examples do not change or save your attempt. No research data is collected.</p>
    <div className="lesson-choices" role="group" aria-label="Choose a concept">{lessons.map(item => <button key={item.id} aria-pressed={lesson === item.id} onClick={() => reset(item.id, true)}>{item.title}</button>)}</div>
    <h3>{current.title}</h3><p>{current.question}</p>
    {lesson === 'version' && <label className="toggle"><input type="checkbox" checked={guard} onChange={event => reset(lesson, event.target.checked)}/>Example delivery guard</label>}
    {lesson === 'cache' && <p className="lesson-fact">Refresh at tick 4: active, version 1.</p>}
    <dl className="lesson-state"><dt>Settled tick</dt><dd>{plant.tick}</dd><dt>Scene</dt><dd>{plant.world.scene_id}, {plant.world.active ? 'active' : 'inactive'}, version {plant.world.epoch}</dd><dt>Primary clock</dt><dd>{plant.config.clocks.primary ? 'On' : 'Off'}</dd><dt>Gate</dt><dd>{plant.config.gate_mode}; stored {plant.gate_cache.active ? 'active' : 'inactive'}, version {plant.gate_cache.epoch}</dd><dt>Pending jobs</dt><dd data-testid="lesson-queue">{plant.queue.length}</dd></dl>
    <ul className="lesson-jobs">{plant.queue.map(job => <li key={job.id}><code>{job.id}</code>: due {job.due_tick}, queued version {job.enqueue_epoch}</li>)}</ul>
    <fieldset disabled={example.completed} className="lesson-prediction"><legend>Your prediction: pulses during the next {lesson === 'cache' ? 4 : 2} ticks</legend>{[0, 1].map(count => <label className="radio" key={count}><input type="radio" name="lesson-prediction" checked={prediction === count} onChange={() => setPrediction(count)}/>{count} {count === 1 ? 'pulse' : 'pulses'}</label>)}</fieldset>
    <div className="lesson-actions"><button className="primary" disabled={prediction === null || example.completed} onClick={advance}>Advance example</button><button onClick={() => reset()}>Reset example</button></div>
    <p role="status" className="lesson-feedback">{example.completed ? `${prediction === observed ? 'Correct' : 'Try again'}: observed ${observed} ${observed === 1 ? 'pulse' : 'pulses'}. ${current.explanation}` : 'Choose a prediction to advance the example.'}</p>
    {example.completed && <dl className="lesson-state"><dt>Observed pulses</dt><dd data-testid="lesson-observed">{observed}</dd><dt>Discarded jobs</dt><dd data-testid="lesson-discarded">{discarded}</dd>{liveObserved !== null && <><dt>Live gate comparison: observed pulses</dt><dd data-testid="lesson-live-observed">{liveObserved}</dd></>}</dl>}
    <details><summary>Actual example commands and events</summary><p className="hint">Read-only local example output. Pulse totals above count only ticks after {example.startTick}.</p><pre tabIndex={0} aria-label="Actual example commands and events">{JSON.stringify({ commands: engineAudit(example.engine).map(command => command.request.action), events: engineEvents(example.engine), ...(example.live ? { live_comparison_events: engineEvents(example.live) } : {}) }, null, 2)}</pre></details>
  </section>;
}
