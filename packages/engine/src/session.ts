import { canonicalJson, sha256Json, validateRequest } from '../../contracts/src/index.js';
import type { Action, AttemptExport, BoardResult, BoardSession, CandidateEvaluator, CommandRecord, ContinuationCorpus, CorpusFactory, EvaluationResult, FrozenCandidate, Phase, ProvenanceView, SessionOptions, SessionView, SetupSpec } from '../../contracts/src/index.js';
import { createEngine, dispatch, engineAudit, engineEvents, immutable, setEnginePhase, snapshot } from './engine.js';
import { scenarioActions, scenarioSetup } from './scenarios.js';
import { isSupportedRecordingSetup } from './construction.js';

export interface SessionPlaybackSource {
  readonly recording_sha256: string; readonly setup: SetupSpec;
  readonly commands: readonly CommandRecord[]; readonly provenance: ProvenanceView;
}
export interface PlaybackSourceBinding { readonly recording_sha256: string; readonly source_sha256: string }
export interface SessionRestoreOptions extends Pick<SessionOptions, 'now'> { readonly playbackSource?: SessionPlaybackSource }
interface PreparedPlayback { readonly source: SessionPlaybackSource; readonly commands: readonly CommandRecord[]; readonly binding: PlaybackSourceBinding }
const scriptedProvenance: ProvenanceView = immutable({ category: 'scripted', label: 'Scripted preview', model: null, date: null, replay_verified: true });
export interface SubmissionRecord {
  readonly candidate: FrozenCandidate; readonly corpus: ContinuationCorpus;
  readonly admitted_at_ms: number; readonly evaluation: EvaluationResult | null;
}
export interface ExtendedAttemptExport extends AttemptExport {
  readonly attempt_id: string; readonly terminal_reason: Phase;
  readonly playback_source: PlaybackSourceBinding | null; readonly provenance: ProvenanceView;
  readonly previous_attempts: readonly { readonly attempt_id: string; readonly disposition: Phase }[];
  readonly submissions: readonly SubmissionRecord[];
  readonly precommitments: readonly { readonly window: number; readonly response: string | null; readonly at_ms: number }[];
  readonly visibility: readonly { readonly hidden: boolean; readonly at_ms: number }[];
}
export type RunUntilEvent = 'delivery' | 'scene_change' | 'discard';
export interface RunStopStatus {
  readonly event: RunUntilEvent; readonly reason: 'running' | 'matched' | 'not_scheduled' | 'tick_limit' | 'hidden' | 'paused' | 'expired' | 'rejected' | 'interrupted';
  readonly tick: number; readonly ticks: number;
}
export interface ExtendedBoardSession extends BoardSession {
  runUntil(event: RunUntilEvent): void;
  getRunStop(): RunStopStatus | null;
  playbackStep(): void;
  playbackLength(): number;
  beginRecoveryAt(handover_at_ms: number): void;
  exportAttempt(): ExtendedAttemptExport;
}
export interface SavedCommand extends Omit<CommandRecord, 'result'> {
  readonly result_sha256: string;
}
export interface CompactAttemptExport extends Omit<ExtendedAttemptExport, 'schema_version' | 'commands'> {
  readonly schema_version: '1.2'; readonly commands: readonly SavedCommand[];
  readonly attempt_started_at_ms: number; readonly handover_at_ms: number | null; readonly deadline_at_ms: number | null;
}
export interface SavedSession {
  readonly schema_version: '1.2'; readonly scenario: SessionOptions['scenario'];
  readonly mode: 'public' | 'local_rehearsal'; readonly condition: 'observation' | 'precommitment';
  readonly attempt_id: string; readonly attempt_started_at_ms: number;
  readonly handover_at_ms: number | null; readonly deadline_at_ms: number | null;
  readonly phase: Phase; readonly playback_index: number; readonly request_sequence: number;
  readonly commands: readonly SavedCommand[]; readonly plant_sha256: string;
  readonly playback_source: PlaybackSourceBinding | null;
  readonly submissions: readonly SubmissionRecord[];
  readonly previous_attempts: ExtendedAttemptExport['previous_attempts'];
  readonly precommitments: ExtendedAttemptExport['precommitments']; readonly visibility: ExtendedAttemptExport['visibility'];
}
const saveFunctions = new WeakMap<BoardSession, () => SavedSession>();
const compactExportFunctions = new WeakMap<BoardSession, () => CompactAttemptExport>();
const compactCommands = new WeakMap<CommandRecord, SavedCommand>();
function compactCommand(command: CommandRecord): SavedCommand {
  const cached = compactCommands.get(command); if (cached) return cached;
  const { result, ...record } = command;
  const compact = immutable({ ...record, result_sha256: sha256Json(result) });
  compactCommands.set(command, compact); return compact;
}
let attemptSequence = 0;
const defaultNow = (): number => Math.floor(globalThis.performance.timeOrigin + globalThis.performance.now());
export function createSession(options: SessionOptions, evaluator: CandidateEvaluator, corpusFactory: CorpusFactory): ExtendedBoardSession {
  return makeSession(options, evaluator, corpusFactory);
}
function sourceRequestId(source: SessionPlaybackSource, prefix: string): string {
  const ids = new Set(source.commands.map(command => command.request.request_id));
  for (let index = 0; index <= ids.size; index++) { const id = `${prefix}.${index}`; if (!ids.has(id)) return id; }
  throw new TypeError('Recorded request identity capacity exhausted');
}
function replaySourceCommand(engine: ReturnType<typeof createEngine>, command: CommandRecord): BoardResult {
  const before = snapshot(engine).tick;
  if (before < 5 && !['setup', 'playback'].includes(command.actor.phase)) throw new TypeError('Recorded setup phase is invalid');
  setEnginePhase(engine, before >= 5 ? 'recovery' : command.actor.phase);
  const actual = dispatch(engine, command.request, command.actor), audit = engineAudit(engine).at(-1);
  if (snapshot(engine).tick > 5 || !audit || audit.seq !== command.seq || audit.tick !== command.tick || canonicalJson(audit.actor) !== canonicalJson(command.actor) || canonicalJson(actual) !== canonicalJson(command.result)) throw new TypeError('Recorded source command does not replay');
  return actual;
}
function preparePlayback(input: SessionPlaybackSource): PreparedPlayback {
  exactKeys(input, ['recording_sha256', 'setup', 'commands', 'provenance']);
  if (typeof input.recording_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(input.recording_sha256) || !isSupportedRecordingSetup(input.setup) || !Array.isArray(input.commands) || !input.commands.length || input.commands.length >= input.setup.task.max_audit_records) throw new TypeError('Recorded source is not the curated stale-queue setup');
  exactKeys(input.provenance, ['category', 'label', 'model', 'date', 'replay_verified']);
  const provenance = input.provenance;
  if (!['live_model', 'scripted', 'fixture'].includes(provenance.category) || provenance.replay_verified !== true || (provenance.category === 'live_model' ? provenance.label !== 'Recorded agent run' || typeof provenance.model !== 'string' || !provenance.model || typeof provenance.date !== 'string' || !provenance.date : provenance.label !== 'Scripted preview') || (provenance.model !== null && (typeof provenance.model !== 'string' || provenance.model.length > 256)) || (provenance.date !== null && (typeof provenance.date !== 'string' || provenance.date.length > 64))) throw new TypeError('Recorded source provenance is invalid');
  const source = immutable(input), engine = createEngine(source.setup); let elapsed = 0;
  for (const command of source.commands) {
    exactKeys(command, ['seq', 'request', 'actor', 'tick', 'elapsed_ms', 'result']); exactKeys(command.actor, ['actor_id', 'role', 'phase']); validateRequest(command.request);
    if (!integer(command.elapsed_ms, elapsed, Number.MAX_SAFE_INTEGER)) throw new TypeError('Recorded source timing is invalid'); elapsed = command.elapsed_ms;
    replaySourceCommand(engine, command);
  }
  const plant = snapshot(engine), job = plant.queue[0];
  if (plant.tick !== 5 || plant.config.gate_mode !== 'live' || !plant.config.epoch_guard || Number(plant.config.clocks.primary) + Number(plant.config.clocks.shadow) !== 1 || plant.queue.length !== 1 || !job || job.enqueue_tick !== 4 || job.due_tick !== 6 || job.enqueue_epoch !== 1 || job.lamp !== 'left') throw new TypeError('Recorded source does not preserve the intended handover state');
  setEnginePhase(engine, 'recovery');
  const request = { schema_version: '1.0' as const, request_id: sourceRequestId(source, 'controller.fault'), expected_revision: plant.revision, action: { type: 'set_epoch_guard' as const, enabled: false } };
  const result = dispatch(engine, request, { actor_id: 'recorded-stale-queue-fault', role: 'controller', phase: 'recovery' });
  if (result.outcome !== 'accepted') throw new TypeError('Recorded fault could not be applied');
  const fault = engineAudit(engine).at(-1)!;
  const binding = immutable({ recording_sha256: source.recording_sha256, source_sha256: sha256Json({ recording_sha256: source.recording_sha256, setup: source.setup, commands: source.commands.map(compactCommand), provenance: source.provenance }) });
  return { source, commands: immutable([...source.commands, fault]), binding };
}
export function createRecordedSession(source: SessionPlaybackSource, evaluator: CandidateEvaluator, corpusFactory: CorpusFactory, options: Pick<SessionOptions, 'now'> = {}): ExtendedBoardSession {
  return makeSession({ scenario: 'stale-queue', mode: 'public', ...options }, evaluator, corpusFactory, undefined, preparePlayback(source));
}
function makeSession(options: SessionOptions, evaluator: CandidateEvaluator, corpusFactory: CorpusFactory, restore?: SavedSession, preparedPlayback?: PreparedPlayback): ExtendedBoardSession {
  const now = options.now ?? defaultNow;
  const clock = (): number => { const value = Math.floor(now()); if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('Session clock must return nonnegative finite milliseconds'); return value; };
  const mode = options.mode ?? 'public', condition = options.condition ?? 'observation';
  if (!['public', 'local_rehearsal'].includes(mode) || !['observation', 'precommitment'].includes(condition)) throw new TypeError('Unknown session mode or condition');
  let playback = preparedPlayback;
  let scenario = options.scenario, setup = playback?.source.setup ?? scenarioSetup(scenario), engine = createEngine(setup);
  const playbackLength = (): number => playback?.commands.length ?? scenarioActions(scenario).length;
  const recoveryId = (sequence: number): string => playback ? sourceRequestId(playback.source, `recovery.${sequence}`) : `session.${sequence}`;
  if (restore) attemptSequence = Math.max(attemptSequence, Number(restore.attempt_id.split('.')[2]));
  let attemptStarted = restore?.attempt_started_at_ms ?? clock();
  let attemptId = restore?.attempt_id ?? `attempt.${attemptStarted}.${++attemptSequence}`;
  let phase: Phase = restore?.phase ?? 'setup', playbackIndex = restore?.playback_index ?? 0, requestSequence = restore?.request_sequence ?? 0;
  let handoverAt = restore?.handover_at_ms ?? null, deadlineAt = restore?.deadline_at_ms ?? null;
  let history: CommandRecord[] = [];
  const previous: { attempt_id: string; disposition: Phase }[] = structuredClone(restore?.previous_attempts ?? []) as { attempt_id: string; disposition: Phase }[];
  let submissions: SubmissionRecord[] = structuredClone(restore?.submissions ?? []) as SubmissionRecord[];
  let precommitments = structuredClone(restore?.precommitments ?? []) as { window: number; response: string | null; at_ms: number }[];
  let visibility = structuredClone(restore?.visibility ?? []) as { hidden: boolean; at_ms: number }[];
  let latest: BoardResult | null = null, evaluation: EvaluationResult | null = submissions.at(-1)?.evaluation ?? null;
  let capturedCandidate: FrozenCandidate | null = submissions.at(-1)?.candidate ?? null, capturedCorpus: ContinuationCorpus | null = submissions.at(-1)?.corpus ?? null;
  let runStop: RunStopStatus | null = null;
  let running = false, hidden = false, disposed = false, submitting = false;
  let runTimer: ReturnType<typeof setInterval> | null = null, wallTimer: ReturnType<typeof setInterval> | null = null;
  let pending: Promise<EvaluationResult> | null = null;
  const listeners = new Set<() => void>();
  if (restore) {
    for (const [index, command] of restore.commands.entries()) {
      let replayed: BoardResult;
      if (playback && index < restore.playback_index) replayed = replaySourceCommand(engine, playback.commands[index]!);
      else { setEnginePhase(engine, command.actor.phase); replayed = dispatch(engine, command.request, command.actor); }
      if (sha256Json(replayed) !== command.result_sha256 || command.tick !== snapshot(engine).tick || command.seq !== history.length + 1) throw new TypeError('Saved command history does not replay');
      const record = immutable({ seq: command.seq, request: command.request, actor: command.actor, tick: command.tick, elapsed_ms: command.elapsed_ms, result: replayed });
      compactCommands.set(record, immutable(command)); history.push(record); latest = replayed;
    }
    if (sha256Json(snapshot(engine)) !== restore.plant_sha256) throw new TypeError('Saved plant commitment does not replay');
    setEnginePhase(engine, playback && phase === 'playback' && snapshot(engine).tick >= 5 ? 'recovery' : phase);
  }
  const stopRun = (reason: RunStopStatus['reason'] = 'interrupted'): void => { if (runStop?.reason === 'running') runStop = immutable({ ...runStop, reason, tick: snapshot(engine).tick }); running = false; if (runTimer !== null) clearInterval(runTimer); runTimer = null; };
  const remaining = (): number => deadlineAt === null ? 300000 : Math.max(0, deadlineAt - clock());
  const buildView = (): SessionView => immutable({ schema_version: '1.0', attempt_id: attemptId, scenario, phase, mode, condition, plant: snapshot(engine), events: engineEvents(engine), history, running, remaining_ms: remaining(), original_handover_tick: 5, provenance: playback?.source.provenance ?? scriptedProvenance, latest_result: latest, evaluation, submitting, research_enabled: false });
  let view = buildView();
  const publish = (): void => { if (disposed) return; view = buildView(); for (const listener of listeners) listener(); };
  const expire = (): boolean => {
    if (phase === 'recovery' && deadlineAt !== null && clock() > deadlineAt) {
      phase = submissions.length ? 'submitted' : 'timed_out'; setEnginePhase(engine, phase); stopRun('expired'); publish(); return true;
    }
    return phase === 'timed_out';
  };
  const append = (result: BoardResult): BoardResult => {
    const record = engineAudit(engine).at(-1);
    if (record && record.seq > history.length) {
      const published = immutable({ ...record, elapsed_ms: Math.max(0, clock() - attemptStarted) }); compactCommand(published); history.push(published);
    }
    latest = result; publish(); return result;
  };
  const unavailable = (message: string): BoardResult => immutable({ request_id: `session.unavailable`, outcome: 'rejected', revision: snapshot(engine).revision, observation: { plant: snapshot(engine), events: engineEvents(engine).slice(-256) }, events: [], error: { code: 'PHASE_FORBIDDEN', message } });
  const executePlayback = (): void => {
    if (disposed || !['setup', 'playback'].includes(phase)) return;
    phase = 'playback'; setEnginePhase(engine, phase);
    if (playback) {
      const command = playback.commands[playbackIndex];
      if (command) { const result = replaySourceCommand(engine, command); playbackIndex++; append(result); } else publish();
    } else {
      const action = scenarioActions(scenario)[playbackIndex];
      if (action) {
        const result = dispatch(engine, { schema_version: '1.0', request_id: `setup.${playbackIndex + 1}`, expected_revision: snapshot(engine).revision, action }, { actor_id: 'scripted-preview', role: 'controller', phase });
        if (result.outcome !== 'accepted') throw new Error('Authored playback was rejected'); playbackIndex++; append(result);
      } else publish();
    }
  };
  const badEvaluation = (status: EvaluationResult['status'], reason: string, hash = ''): EvaluationResult => immutable({ status, candidate_sha256: hash, cases: [], observations: [], reason });
  const executeAction = (action: Action, eventRunTick = false): BoardResult => {
    expire();
    if (action.type === 'advance' && runStop?.reason === 'running' && !eventRunTick) stopRun('interrupted');
    if (disposed || phase === 'setup' || phase === 'playback') { latest = unavailable('Recovery has not started'); publish(); return latest; }
    const result = dispatch(engine, { schema_version: '1.0', request_id: recoveryId(++requestSequence), expected_revision: snapshot(engine).revision, action }, { actor_id: attemptId, role: 'human', phase });
    return append(result);
  };
  const session: ExtendedBoardSession = {
    getView() { expire(); return view; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    act(action) { return executeAction(action); },
    playbackStep: executePlayback,
    playbackLength,
    beginRecoveryAt(timestamp) {
      if (disposed || !['setup', 'playback'].includes(phase)) return;
      if (!Number.isSafeInteger(timestamp) || timestamp < attemptStarted || timestamp > clock() || timestamp > Number.MAX_SAFE_INTEGER - 300000) throw new TypeError('Invalid trusted handover time');
      while (playbackIndex < playbackLength()) executePlayback();
      phase = 'recovery'; setEnginePhase(engine, phase); handoverAt = timestamp; deadlineAt = handoverAt + 300000; expire(); publish();
    },
    start() {
      if (disposed || !['setup', 'playback'].includes(phase)) return;
      session.beginRecoveryAt(clock());
    },
    step() { return session.act({ type: 'advance', ticks: 1 }); },
    run() {
      expire(); if (disposed || hidden || running || phase !== 'recovery') return;
      runStop = null; running = true; runTimer = setInterval(() => { if (expire()) return; const result = session.step(); if (result.outcome === 'rejected') { stopRun(); publish(); } }, 500); publish();
    },
    runUntil(event) {
      if (!['delivery', 'scene_change', 'discard'].includes(event)) throw new TypeError('Unknown run stop event');
      expire(); if (mode !== 'public' || disposed || hidden || running || phase !== 'recovery') return;
      const plant = snapshot(engine);
      if (event === 'scene_change' && !setup.world.transitions.some(transition => transition.tick > plant.tick && transition.scene_id !== plant.world.scene_id)) {
        runStop = immutable({ event, reason: 'not_scheduled', tick: plant.tick, ticks: 0 }); publish(); return;
      }
      runStop = immutable({ event, reason: 'running', tick: plant.tick, ticks: 0 });
      running = true;
      runTimer = setInterval(() => {
        if (expire()) return;
        const before = snapshot(engine), result = executeAction({ type: 'advance', ticks: 1 }, true);
        runStop = immutable({ event, reason: 'running', tick: snapshot(engine).tick, ticks: (runStop?.ticks ?? 0) + (result.outcome === 'accepted' ? 1 : 0) });
        const matched = result.events.some(item => event === 'delivery' ? item.type === 'pulse' : event === 'discard' ? item.type === 'job_discarded' : item.type === 'world_changed' && item.world.scene_id !== before.world.scene_id);
        if (result.outcome === 'rejected' || matched || runStop.ticks >= 128) { stopRun(result.outcome === 'rejected' ? 'rejected' : matched ? 'matched' : 'tick_limit'); publish(); }
      }, 500);
      publish();
    },
    getRunStop() { expire(); return runStop; },
    pause() { stopRun('paused'); publish(); },
    submit() {
      expire();
      if (pending) return pending;
      if (disposed || phase !== 'recovery') return Promise.resolve(badEvaluation('invalid', 'Attempt does not admit a submission'));
      if (submissions.length >= 128) return Promise.resolve(badEvaluation('budget_limit', 'Submission capacity exhausted'));
      const admittedAt = clock();
      if (deadlineAt === null || admittedAt > deadlineAt) return Promise.resolve(badEvaluation('invalid', 'Recovery deadline expired'));
      stopRun();
      const plant = snapshot(engine);
      const candidate: FrozenCandidate = immutable({ schema_version: '1.0', plant, world_prefix: { initial_world: setup.world.initial_world, transitions: setup.world.transitions.filter(t => t.tick <= plant.tick) }, task: setup.task, candidate_sha256: sha256Json(plant), attempt_id: attemptId, capture_tick: plant.tick, original_handover_tick: 5, terminal_reason: 'submitted', reset_during_attempt: false });
      capturedCandidate = candidate; capturedCorpus = null; evaluation = null;
      if (mode === 'local_rehearsal') { phase = 'submitted'; setEnginePhase(engine, phase); }
      let corpus: ContinuationCorpus;
      try { corpus = immutable(corpusFactory(candidate)); } catch (error) { evaluation = badEvaluation('budget_limit', error instanceof Error ? error.message : 'Corpus generation failed', candidate.candidate_sha256); publish(); return Promise.resolve(evaluation); }
      if (corpus.candidate_sha256 !== candidate.candidate_sha256) { evaluation = badEvaluation('invalid', 'Corpus candidate commitment differs', candidate.candidate_sha256); publish(); return Promise.resolve(evaluation); }
      capturedCorpus = corpus;
      const index = submissions.length; submissions.push(immutable({ candidate, corpus, admitted_at_ms: admittedAt, evaluation: null }));
      const submittingAttempt = attemptId;
      submitting = true; publish();
      pending = Promise.resolve().then(() => evaluator(candidate, corpus)).then(result => {
        const verified = result.candidate_sha256 === candidate.candidate_sha256 ? immutable(result) : badEvaluation('invalid', 'Evaluator candidate commitment differs', candidate.candidate_sha256);
        if (attemptId === submittingAttempt && !disposed) { submissions[index] = immutable({ ...submissions[index]!, evaluation: verified }); evaluation = verified; submitting = false; pending = null; publish(); }
        return verified;
      }, error => {
        const failed = badEvaluation('worker_error', error instanceof Error ? error.message : 'Evaluation failed', candidate.candidate_sha256);
        if (attemptId === submittingAttempt && !disposed) { submissions[index] = immutable({ ...submissions[index]!, evaluation: failed }); evaluation = failed; submitting = false; pending = null; publish(); }
        return failed;
      });
      return pending;
    },
    restart(next = scenario) {
      if (disposed) return;
      scenarioSetup(next); expire(); if (previous.length >= 10000) throw new TypeError('Attempt history capacity exhausted'); stopRun(); previous.push({ attempt_id: attemptId, disposition: phase === 'submitted' || phase === 'timed_out' ? phase : 'abandoned_reset' });
      if (next !== 'stale-queue') playback = undefined;
      runStop = null; scenario = next; setup = playback?.source.setup ?? scenarioSetup(scenario); engine = createEngine(setup); phase = 'setup'; playbackIndex = 0; requestSequence = 0;
      attemptStarted = clock(); attemptId = `attempt.${attemptStarted}.${++attemptSequence}`; handoverAt = null; deadlineAt = null; history = []; submissions = []; precommitments = []; visibility = []; latest = null; evaluation = null; capturedCandidate = null; capturedCorpus = null; submitting = false; pending = null; publish();
    },
    setVisibility(value) {
      if (disposed || hidden === value) return;
      hidden = value; if (visibility.length < 10000) visibility.push({ hidden, at_ms: clock() }); if (hidden) stopRun('hidden'); expire(); publish();
    },
    recordPrecommitment(window, response) {
      if (disposed || !Number.isInteger(window) || window < 1 || window > 3 || (response !== null && (typeof response !== 'string' || response.length > 2000))) throw new TypeError('Invalid nonbinding precommitment');
      if (precommitments.length >= 3 || precommitments.some(item => item.window === window)) return;
      precommitments.push({ window, response, at_ms: clock() }); publish();
    },
    exportAttempt() {
      expire();
      return immutable({ schema_version: '1.0', mode, researchEligible: false, setup, commands: history, candidate: capturedCandidate, corpus: capturedCorpus, evaluation, attempt_id: attemptId, terminal_reason: phase, playback_source: playback?.binding ?? null, provenance: playback?.source.provenance ?? scriptedProvenance, previous_attempts: previous, submissions, precommitments, visibility });
    },
    dispose() { if (disposed) return; disposed = true; stopRun(); if (wallTimer !== null) clearInterval(wallTimer); wallTimer = null; listeners.clear(); },
  };
  saveFunctions.set(session, () => {
    expire(); return immutable({ schema_version: '1.2', scenario, mode, condition, attempt_id: attemptId, attempt_started_at_ms: attemptStarted, handover_at_ms: handoverAt, deadline_at_ms: deadlineAt, phase, playback_index: playbackIndex, request_sequence: requestSequence, commands: history.map(compactCommand), playback_source: playback?.binding ?? null, plant_sha256: sha256Json(snapshot(engine)), submissions, previous_attempts: previous, precommitments, visibility });
  });
  compactExportFunctions.set(session, () => {
    expire();
    return immutable({ schema_version: '1.2', mode, researchEligible: false, setup, commands: history.map(compactCommand), candidate: capturedCandidate, corpus: capturedCorpus, evaluation, attempt_id: attemptId, terminal_reason: phase, playback_source: playback?.binding ?? null, provenance: playback?.source.provenance ?? scriptedProvenance, previous_attempts: previous, submissions, precommitments, visibility, attempt_started_at_ms: attemptStarted, handover_at_ms: handoverAt, deadline_at_ms: deadlineAt });
  });
  expire(); wallTimer = setInterval(() => { if (phase !== 'recovery') return; if (!expire()) publish(); }, 250);
  if (restore && submissions.length) {
    submitting = true; publish(); const restoredAttempt = attemptId;
    pending = (async () => {
      let last: EvaluationResult | null = null;
      for (const [index, item] of [...submissions].entries()) {
        if (disposed || attemptId !== restoredAttempt) return badEvaluation('cancelled', 'Restored attempt is no longer active', item.candidate.candidate_sha256);
        let result: EvaluationResult;
        try {
          const computed = await evaluator(item.candidate, item.corpus);
          result = computed.candidate_sha256 === item.candidate.candidate_sha256 ? immutable(computed) : badEvaluation('invalid', 'Evaluator candidate commitment differs', item.candidate.candidate_sha256);
        } catch (error) { result = badEvaluation('worker_error', error instanceof Error ? error.message : 'Evaluation failed', item.candidate.candidate_sha256); }
        if (!disposed && attemptId === restoredAttempt) submissions[index] = immutable({ ...item, evaluation: result });
        last = result;
      }
      if (!disposed && attemptId === restoredAttempt) { evaluation = last; submitting = false; pending = null; publish(); }
      return last!;
    })();
  }
  return session;
}
export function saveSession(session: BoardSession): SavedSession {
  const save = saveFunctions.get(session); if (!save) throw new TypeError('Unknown session'); return save();
}
export function compactAttemptExport(session: BoardSession): CompactAttemptExport {
  const exportCompact = compactExportFunctions.get(session); if (!exportCompact) throw new TypeError('Unknown session'); return exportCompact();
}
function exactKeys(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) throw new TypeError('Invalid saved session shape');
}
function integer(value: unknown, min: number, max: number): boolean { return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max; }
function validateSaved(value: unknown, corpusFactory: CorpusFactory, options: SessionRestoreOptions): { saved: SavedSession; playback: PreparedPlayback | undefined } {
  exactKeys(value, ['schema_version', 'scenario', 'mode', 'condition', 'attempt_id', 'attempt_started_at_ms', 'handover_at_ms', 'deadline_at_ms', 'phase', 'playback_index', 'request_sequence', 'commands', 'plant_sha256', 'submissions', 'previous_attempts', 'precommitments', 'visibility', 'playback_source']);
  if (JSON.stringify(value).length > 8 * 1024 * 1024 || value.schema_version !== '1.2' || typeof value.attempt_id !== 'string' || !/^attempt\.\d+\.\d+$/.test(value.attempt_id) || !integer(value.attempt_started_at_ms, 0, Number.MAX_SAFE_INTEGER) || !integer(value.playback_index, 0, 10000) || !integer(value.request_sequence, 0, 10000) || typeof value.plant_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.plant_sha256) || !['setup', 'playback', 'recovery', 'submitted', 'timed_out', 'abandoned_reset'].includes(String(value.phase))) throw new TypeError('Invalid saved session metadata');
  const saved = value as unknown as SavedSession;
  if (Number(saved.attempt_id.split('.')[1]) !== saved.attempt_started_at_ms || !integer(Number(saved.attempt_id.split('.')[2]), 1, Number.MAX_SAFE_INTEGER - 10000)) throw new TypeError('Invalid saved attempt identity');
  let playback: PreparedPlayback | undefined;
  if (saved.playback_source !== null) {
    exactKeys(saved.playback_source, ['recording_sha256', 'source_sha256']);
    if (!options.playbackSource || saved.scenario !== 'stale-queue' || saved.mode !== 'public') throw new TypeError('Saved recorded source is unavailable');
    playback = preparePlayback(options.playbackSource);
    if (canonicalJson(playback.binding) !== canonicalJson(saved.playback_source)) throw new TypeError('Saved recorded source changed');
  }
  const actions = scenarioActions(saved.scenario); scenarioSetup(saved.scenario); const length = playback?.commands.length ?? actions.length;
  if (saved.playback_index > length || !['public', 'local_rehearsal'].includes(saved.mode) || !['observation', 'precommitment'].includes(saved.condition)) throw new TypeError('Invalid saved session mode or playback');
  for (const [items, max] of [[saved.commands, 10000], [saved.submissions, 128], [saved.previous_attempts, 10000], [saved.precommitments, 3], [saved.visibility, 10000]] as const) if (!Array.isArray(items) || items.length > max) throw new TypeError('Saved history exceeds bounds');
  const prehandover = saved.phase === 'setup' || saved.phase === 'playback';
  if (prehandover ? saved.handover_at_ms !== null || saved.deadline_at_ms !== null : !integer(saved.handover_at_ms, saved.attempt_started_at_ms, Number.MAX_SAFE_INTEGER - 300000) || saved.deadline_at_ms !== saved.handover_at_ms! + 300000 || saved.playback_index !== length) throw new TypeError('Saved original deadline is inconsistent');
  if ((saved.phase === 'setup' && saved.playback_index !== 0) || saved.commands.length < saved.playback_index) throw new TypeError('Saved playback index is inconsistent');
  let recoveryRequests = 0, elapsed = 0;
  for (const [index, command] of saved.commands.entries()) {
    canonicalJson(command); validateRequest(command.request);
    exactKeys(command, ['seq', 'request', 'actor', 'tick', 'elapsed_ms', 'result_sha256']);
    if (typeof command.result_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(command.result_sha256)) throw new TypeError('Invalid saved receipt commitment');
    if (!integer(command.elapsed_ms, elapsed, Number.MAX_SAFE_INTEGER) || !integer(command.tick, 0, 4096)) throw new TypeError('Invalid saved command timing'); elapsed = command.elapsed_ms;
    if (index < saved.playback_index) {
      if (playback) {
        const original = compactCommand(playback.commands[index]!);
        if (canonicalJson(command.request) !== canonicalJson(original.request) || canonicalJson(command.actor) !== canonicalJson(original.actor) || command.seq !== original.seq || command.tick !== original.tick || command.result_sha256 !== original.result_sha256) throw new TypeError('Saved exposure differs from recorded source');
      } else {
        const authored = { schema_version: '1.0', request_id: `setup.${index + 1}`, expected_revision: index, action: actions[index] };
        if (canonicalJson(command.request) !== canonicalJson(authored) || canonicalJson(command.actor) !== canonicalJson({ actor_id: 'scripted-preview', role: 'controller', phase: 'playback' })) throw new TypeError('Saved exposure differs from authored actions');
      }
    } else {
      exactKeys(command.actor, ['actor_id', 'role', 'phase']);
      if (prehandover || command.actor.actor_id !== saved.attempt_id || command.actor.role !== 'human' || !['recovery', 'submitted', 'timed_out'].includes(command.actor.phase) || command.request.request_id !== (playback ? sourceRequestId(playback.source, `recovery.${++recoveryRequests}`) : `session.${++recoveryRequests}`)) throw new TypeError('Saved recovery authority differs');
    }
  }
  if (saved.request_sequence !== recoveryRequests) throw new TypeError('Saved request sequence differs');
  for (const item of saved.previous_attempts) { exactKeys(item, ['attempt_id', 'disposition']); if (typeof item.attempt_id !== 'string' || item.attempt_id === saved.attempt_id || !['submitted', 'timed_out', 'abandoned_reset'].includes(item.disposition)) throw new TypeError('Invalid previous attempt disposition'); }
  for (const item of saved.precommitments) { exactKeys(item, ['window', 'response', 'at_ms']); if (!integer(item.window, 1, 3) || (item.response !== null && (typeof item.response !== 'string' || item.response.length > 2000)) || !integer(item.at_ms, saved.attempt_started_at_ms, Number.MAX_SAFE_INTEGER)) throw new TypeError('Invalid saved precommitment'); }
  for (const item of saved.visibility) { exactKeys(item, ['hidden', 'at_ms']); if (typeof item.hidden !== 'boolean' || !integer(item.at_ms, saved.attempt_started_at_ms, Number.MAX_SAFE_INTEGER)) throw new TypeError('Invalid saved visibility'); }
  // Submission verdicts are data, not authority. Resume only re-executed candidates and recompute scoring.
  const replay = createEngine(playback?.source.setup ?? scenarioSetup(saved.scenario));
  const reachable = new Map<string, ReturnType<typeof snapshot>>();
  for (const [index, command] of saved.commands.entries()) {
    let result: BoardResult;
    if (playback && index < saved.playback_index) result = replaySourceCommand(replay, playback.commands[index]!);
    else { setEnginePhase(replay, command.actor.phase); result = dispatch(replay, command.request, command.actor); }
    if (sha256Json(result) !== command.result_sha256 || command.tick !== snapshot(replay).tick || command.seq !== index + 1) throw new TypeError('Saved command history does not replay');
    const plant = snapshot(replay); reachable.set(sha256Json(plant), plant);
  }
  if (sha256Json(snapshot(replay)) !== saved.plant_sha256) throw new TypeError('Saved plant commitment does not replay');
  for (const item of saved.submissions) {
    exactKeys(item, ['candidate', 'corpus', 'admitted_at_ms', 'evaluation']); canonicalJson(item.candidate);
    exactKeys(item.candidate, ['schema_version', 'plant', 'world_prefix', 'task', 'candidate_sha256', 'attempt_id', 'capture_tick', 'original_handover_tick', 'terminal_reason', 'reset_during_attempt']);
    const candidate = item.candidate, plant = reachable.get(candidate.candidate_sha256);
    if (!plant || canonicalJson(plant) !== canonicalJson(candidate.plant) || candidate.attempt_id !== saved.attempt_id || candidate.capture_tick !== plant.tick || candidate.capture_tick < 5 || candidate.original_handover_tick !== 5 || candidate.schema_version !== '1.0' || candidate.terminal_reason !== 'submitted' || candidate.reset_during_attempt !== false || candidate.candidate_sha256 !== sha256Json(candidate.plant) || !integer(item.admitted_at_ms, saved.handover_at_ms!, saved.deadline_at_ms!) || canonicalJson(candidate.task) !== canonicalJson(scenarioSetup(saved.scenario).task) || canonicalJson(candidate.world_prefix) !== canonicalJson({ initial_world: scenarioSetup(saved.scenario).world.initial_world, transitions: scenarioSetup(saved.scenario).world.transitions.filter(t => t.tick <= plant.tick) }) || canonicalJson(item.corpus) !== canonicalJson(corpusFactory(candidate))) throw new TypeError('Saved submission does not reconstruct');
  }
  if ((saved.mode === 'local_rehearsal' && saved.submissions.length > 0 && (saved.phase !== 'submitted' || saved.plant_sha256 !== saved.submissions[0]!.candidate.candidate_sha256)) || (saved.mode === 'local_rehearsal' && saved.submissions.length > 1) || (saved.phase === 'timed_out' && saved.submissions.length > 0) || (saved.phase === 'submitted' && saved.submissions.length === 0)) throw new TypeError('Saved primary disposition is inconsistent');
  return { saved, playback };
}
/** Replay validation without timers, evaluation calls or a live session. Verdicts remain untrusted data. */
export function validateSavedSession(value: unknown, corpusFactory: CorpusFactory, options: SessionRestoreOptions = {}): SavedSession {
  return validateSaved(value, corpusFactory, options).saved;
}
export function restoreSession(value: unknown, evaluator: CandidateEvaluator, corpusFactory: CorpusFactory, options: SessionRestoreOptions = {}): ExtendedBoardSession {
  const { saved, playback } = validateSaved(value, corpusFactory, options);
  const cleared = immutable({ ...saved, submissions: saved.submissions.map(item => ({ ...item, evaluation: null })) });
  const session = makeSession({ scenario: saved.scenario, mode: saved.mode, condition: saved.condition, ...options }, evaluator, corpusFactory, cleared, playback);
  return session;
}
