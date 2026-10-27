import type { AfterTheAgentBoardRequest as BoardRequest, Action, CanonicalPlant, Configuration, GateCache, World, Job, Clock, Lamp } from './generated/board.js';
import type { Case, Observation, InitialWorld, Transition, Pulse } from './generated/evaluation.js';
export type { Action, CanonicalPlant, Configuration, GateCache, World, Job, Clock, Lamp, Case, Observation, InitialWorld, Transition, Pulse };
export type ScenarioFamily = 'valid-pending' | 'stale-queue' | 'duplicate-clock' | 'cached-gate';
export type Phase = 'setup' | 'playback' | 'recovery' | 'submitted' | 'timed_out' | 'abandoned_reset';
export interface ActorContext { readonly actor_id: string; readonly role: 'human' | 'assessed_agent' | 'controller'; readonly phase: Phase }
export interface WorldHistory { readonly initial_world: InitialWorld; readonly transitions: readonly Transition[] }
export interface TaskSpec {
  readonly schema_version: '1.0'; readonly task_id: 'alternating-lights-v1'; readonly scenario: ScenarioFamily;
  readonly period: 4; readonly delay: 2; readonly max_tick: 4096; readonly enqueue_until_tick: number;
  readonly max_queue: 128; readonly max_pulses: 16384; readonly max_audit_records: 10000; readonly recovery_seconds: 300;
}
export interface SetupSpec { readonly task: TaskSpec; readonly world: WorldHistory; readonly config: Configuration; readonly gate_cache?: GateCache }
declare const engineBrand: unique symbol;
export interface EngineHandle { readonly [engineBrand]: true }
export type DomainEvent = { readonly seq: number; readonly tick: number } & (
  | { readonly type: 'world_changed'; readonly world: World }
  | { readonly type: 'clock_fired'; readonly clock: Clock }
  | { readonly type: 'job_enqueued'; readonly job: Job }
  | { readonly type: 'pulse'; readonly job_id: string; readonly lamp: Lamp }
  | { readonly type: 'job_discarded'; readonly job_id: string; readonly reason: 'epoch_mismatch' }
  | { readonly type: 'settled_tick' }
  | { readonly type: 'config_changed'; readonly config: Configuration }
  | { readonly type: 'gate_refreshed'; readonly gate_cache: GateCache }
  | { readonly type: 'jobs_dropped'; readonly job_ids: readonly string[] }
);
export type BoardErrorCode = 'INVALID_REQUEST' | 'REQUEST_ID_CONFLICT' | 'REVISION_CONFLICT' | 'ACTOR_FORBIDDEN' | 'PHASE_FORBIDDEN' | 'UNKNOWN_JOB' | 'BUDGET_LIMIT' | 'HISTORY_CAPACITY' | 'NOT_IMPLEMENTED';
export interface BoardObservation { readonly plant: CanonicalPlant; readonly events: readonly DomainEvent[] }
export interface BoardResult { readonly request_id: string; readonly outcome: 'accepted' | 'rejected'; readonly revision: number; readonly observation: BoardObservation; readonly events: readonly DomainEvent[]; readonly error?: { readonly code: BoardErrorCode; readonly message: string }; readonly no_op?: boolean }
export interface EnginePort {
  createEngine(setup: SetupSpec): EngineHandle;
  dispatch(engine: EngineHandle, request: BoardRequest, actor: ActorContext): BoardResult;
  snapshot(engine: EngineHandle): CanonicalPlant;
  cloneEngine(plant: CanonicalPlant, world: WorldHistory): EngineHandle;
  setEnginePhase(engine: EngineHandle, phase: Phase): void;
  setInputHorizon(engine: EngineHandle, end: number): void;
  engineEvents(engine: EngineHandle): readonly DomainEvent[];
  engineAudit(engine: EngineHandle): readonly CommandRecord[];
}
export interface CommandRecord { readonly seq: number; readonly request: BoardRequest; readonly actor: ActorContext; readonly tick: number; readonly elapsed_ms: number; readonly result: BoardResult }
export interface FrozenCandidate { readonly schema_version: '1.0'; readonly plant: CanonicalPlant; readonly world_prefix: WorldHistory; readonly task: TaskSpec; readonly candidate_sha256: string; readonly attempt_id: string; readonly capture_tick: number; readonly original_handover_tick: number; readonly terminal_reason: 'submitted'; readonly reset_during_attempt: false }
export interface ContinuationCorpus { readonly schema_version: '1.0'; readonly policy_version: '1.0.0'; readonly candidate_sha256: string; readonly cases: readonly Case[] }
export interface CaseResult { readonly case_id: string; readonly status: 'pass' | 'mismatch' | 'invalid'; readonly missing: readonly Pulse[]; readonly extra: readonly Pulse[]; readonly reason?: string }
export interface EvaluationResult { readonly status: 'pass' | 'mismatch' | 'invalid' | 'budget_limit' | 'cancelled' | 'worker_error'; readonly candidate_sha256: string; readonly cases: readonly CaseResult[]; readonly observations: readonly Observation[]; readonly reason?: string }
export interface EvaluationPort { evaluateCandidate(candidate: FrozenCandidate, corpus: ContinuationCorpus): Promise<EvaluationResult> }
export interface HeadlessInput { readonly setup: SetupSpec; readonly actions: readonly BoardRequest[]; readonly actor: ActorContext }
export interface HeadlessResult { readonly plant: CanonicalPlant; readonly events: readonly DomainEvent[]; readonly results: readonly BoardResult[] }
export type RecordingCategory = 'live_model' | 'scripted' | 'fixture';
export interface RecordingManifest {
  readonly schema_version: '1.0'; readonly run_id: string; readonly category: RecordingCategory;
  readonly provider: string | null; readonly harness_version: string | null; readonly requested_model: string | null; readonly returned_model: string | null; readonly unavailable_reason: string | null;
  readonly started_at: string; readonly ended_at: string | null; readonly elapsed_ms: number;
  readonly completion: 'complete' | 'timeout' | 'cancelled' | 'budget_stop' | 'failed';
  readonly application_commit: string; readonly dirty: boolean; readonly node_version: string; readonly sdk_version: string; readonly protocol_version: string;
  readonly prompt_sha256: string; readonly tool_schema_sha256: string; readonly reference_manifest_sha256: string;
  readonly initial_plant_sha256: string; readonly world_sha256: string; readonly final_plant_sha256: string; readonly pulses_sha256: string;
  readonly model_requests: number | null; readonly tool_calls: number; readonly token_usage: { readonly input: number; readonly output: number } | null; readonly cost_usd: number | null;
  readonly replay_status: 'verified' | 'failed' | 'not_run'; readonly verification_commit: string | null;
}
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export interface RejectedRawCommandRecord { readonly seq: number; readonly request_encoding: 'rejected-json-v1'; readonly raw_request: JsonValue; readonly actor: ActorContext; readonly tick: number; readonly elapsed_ms: number; readonly result: BoardResult & { readonly outcome: 'rejected' } }
export type RecordingCommandRecord = CommandRecord | RejectedRawCommandRecord;
export interface Recording { readonly schema_version: '1.0'; readonly manifest: RecordingManifest; readonly setup: SetupSpec; readonly initial_plant: CanonicalPlant; readonly commands: readonly RecordingCommandRecord[]; readonly events: readonly DomainEvent[]; readonly final_plant: CanonicalPlant }
export interface ReplayResult { readonly status: 'verified' | 'mismatch' | 'invalid'; readonly plant?: CanonicalPlant; readonly events: readonly DomainEvent[]; readonly mismatches: readonly string[] }
export interface ReplayPort { replay(recording: Recording): ReplayResult }
export type StudyCondition = 'observation' | 'precommitment';
export type SessionMode = 'public' | 'local_rehearsal';
export interface ProvenanceView { readonly category: RecordingCategory; readonly label: 'Scripted preview' | 'Recorded agent run'; readonly model: string | null; readonly date: string | null; readonly replay_verified: boolean }
export interface SessionView {
  readonly schema_version: '1.0'; readonly attempt_id: string; readonly scenario: ScenarioFamily; readonly phase: Phase; readonly mode: SessionMode; readonly condition: StudyCondition;
  readonly plant: CanonicalPlant; readonly events: readonly DomainEvent[]; readonly history: readonly CommandRecord[];
  readonly running: boolean; readonly remaining_ms: number; readonly original_handover_tick: number; readonly provenance: ProvenanceView;
  readonly latest_result: BoardResult | null; readonly evaluation: EvaluationResult | null; readonly submitting: boolean; readonly research_enabled: false;
}
export interface SessionOptions { readonly scenario: ScenarioFamily; readonly mode?: SessionMode; readonly condition?: StudyCondition; readonly now?: () => number }
export interface BoardSession {
  getView(): SessionView;
  subscribe(listener: () => void): () => void;
  act(action: Action): BoardResult;
  start(): void; step(): BoardResult; run(): void; pause(): void;
  submit(): Promise<EvaluationResult>;
  restart(scenario?: ScenarioFamily): void;
  setVisibility(hidden: boolean): void;
  recordPrecommitment(window: number, response: string | null): void;
  exportAttempt(): AttemptExport;
  dispose(): void;
}
export interface AttemptExport { readonly schema_version: '1.0'; readonly mode: 'public' | 'local_rehearsal'; readonly researchEligible: false; readonly setup: SetupSpec; readonly commands: readonly CommandRecord[]; readonly candidate: FrozenCandidate | null; readonly corpus: ContinuationCorpus | null; readonly evaluation: EvaluationResult | null }
export type WorkerRequest = { readonly id: string; readonly type: 'evaluate'; readonly candidate: FrozenCandidate; readonly corpus: ContinuationCorpus } | { readonly id: string; readonly type: 'cancel' };
export interface WorkerResponse { readonly id: string; readonly result: EvaluationResult }
export interface CollectorSessionRequest { readonly protocol_version: string; readonly consent_receipt: string; readonly eligibility_receipt: string }
export interface CollectorSessionReceipt { readonly session_id: string; readonly condition: StudyCondition; readonly scenario: ScenarioFamily; readonly assignment_sha256: string; readonly started_at: string; readonly deadline_at: string; readonly receipt_seq: number }
export interface CollectorActionReceipt { readonly session_id: string; readonly request_id: string; readonly receipt_seq: number; readonly received_at: string; readonly previous_plant_sha256: string; readonly result: BoardResult }
export interface CollectorCandidateReceipt { readonly session_id: string; readonly receipt_seq: number; readonly received_at: string; readonly candidate_sha256: string; readonly closed: true }
export type CollectorResult<T> = { readonly status: 'accepted'; readonly receipt: T } | { readonly status: 'research_disabled' | 'rejected'; readonly reason: string };
export interface CollectorPort {
  start(request: CollectorSessionRequest): Promise<CollectorResult<CollectorSessionReceipt>>;
  action(session_id: string, request: BoardRequest): Promise<CollectorResult<CollectorActionReceipt>>;
  candidate(session_id: string, candidate: FrozenCandidate): Promise<CollectorResult<CollectorCandidateReceipt>>;
  closed(session_id: string): Promise<CollectorResult<{ readonly session_id: string; readonly closed: boolean }>>;
}

export type CandidateEvaluator = (candidate: FrozenCandidate, corpus: ContinuationCorpus) => Promise<EvaluationResult>;
export type CorpusFactory = (candidate: FrozenCandidate) => ContinuationCorpus;
export interface SessionFactory { createSession(options: SessionOptions, evaluator: CandidateEvaluator, corpusFactory: CorpusFactory): BoardSession }
