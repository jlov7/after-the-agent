import { readFileSync } from 'node:fs';
import { canonicalJson, sha256Json, sha256Text, validateRequest, type CanonicalPlant, type FrozenCandidate } from '../../contracts/src/index.js';
import { createEngine, dispatch, scenarioSetup, setEnginePhase, snapshot } from '../../engine/src/index.js';
import { createSession, createRecordedSession, type CompactAttemptExport, type SessionPlaybackSource } from '../../engine/src/session.js';
import { buildCorpus, validateCandidate, EvaluationBudgetLimit } from './continuations.js';
import { evaluateCandidate, referenceDirectory, REFERENCE_MANIFEST_SHA256 } from './evaluate.js';
import { packetJson } from './evidence-packet-json.js';
import { packetIdentifiers, packetInventory, parseCompactAttempt, parseEvidencePacket, attemptByteLimit, type EvidencePacket } from './evidence-packet.js';

export interface PacketSubmissionResult {
  index: number; status: 'reproduced' | 'incomplete' | 'invalid'; command_cut: number | null;
  retained_status: string | null; computed_status: string | null; candidate_sha256: string | null; code: string;
}
export interface PacketVerification {
  request_id: string; status: 'reproduced' | 'incomplete' | 'invalid';
  integrity: { status: 'consistent' | 'invalid'; code: string };
  commands: { status: 'consistent' | 'incomplete' | 'invalid'; count: number; code: string };
  submissions: PacketSubmissionResult[];
  current_attempt: { disposition: CompactAttemptExport['terminal_reason'] | null; status: 'not_checked' | 'consistent' | 'invalid'; primary_submission: number | null; repair_qualification: 'not_qualified' | 'incomplete' | 'pass' | 'mismatch' };
  provenance: { status: 'unverified'; category: string | null; note: string };
  declared: EvidencePacket['declared'] | null;
  loaded_identity: typeof packetIdentifiers & { implementation_sha256: string; implementation_files: { name: string; sha256: string }[]; reference_status: 'verified' | 'unavailable' };
  issues: string[];
}
class PacketFailure extends Error { constructor(readonly code: string) { super(code); } }
const requireEqual = (actual: unknown, expected: unknown, code: string) => { if (canonicalJson(actual) !== canonicalJson(expected)) throw new PacketFailure(code); };
function implementationFiles() {
  return ['../../engine/src/engine.js', '../../engine/src/session.js', '../../engine/src/scenarios.js', '../../engine/src/construction.js', '../../contracts/src/index.js', '../../contracts/src/canonical.js', './continuations.js', './evaluation-core.js', './evaluate.js', './verify-evidence-packet.js'].map(path => {
    let raw: string;
    try { raw = readFileSync(new URL(path, import.meta.url), 'utf8'); }
    catch { raw = readFileSync(new URL(path.replace(/\.js$/, '.ts'), import.meta.url), 'utf8'); }
    return { name: path.replaceAll('../', '').replace('./', ''), sha256: sha256Text(raw) };
  });
}
function expectedCandidate(attempt: CompactAttemptExport, plant: CanonicalPlant): FrozenCandidate {
  return { schema_version: '1.0', plant, world_prefix: { initial_world: attempt.setup.world.initial_world, transitions: attempt.setup.world.transitions.filter(change => change.tick <= plant.tick) }, task: attempt.setup.task, candidate_sha256: sha256Json(plant), attempt_id: attempt.attempt_id, capture_tick: plant.tick, original_handover_tick: 5, terminal_reason: 'submitted', reset_during_attempt: false };
}
function reconstruct(attempt: CompactAttemptExport, source: SessionPlaybackSource | undefined, checkTime: () => void) {
  const setup = scenarioSetup(attempt.setup.task.scenario);
  const identity = attempt.attempt_id.split('.');
  if (Number(identity[1]) !== attempt.attempt_started_at_ms || !Number.isSafeInteger(Number(identity[2])) || Number(identity[2]) < 1) throw new PacketFailure('ATTEMPT_ID_DIFFERS');
  const prehandover = ['setup', 'playback'].includes(attempt.terminal_reason);
  const captured = attempt.candidate !== null;
  // Reset creates a fresh attempt identity. Its disposition exists only in previous_attempts.
  if (attempt.terminal_reason === 'abandoned_reset' || prehandover && (captured || attempt.submissions.length > 0) || attempt.terminal_reason === 'playback' && attempt.commands.length === 0 || attempt.mode === 'local_rehearsal' && captured && attempt.terminal_reason !== 'submitted' || attempt.mode === 'public' && attempt.terminal_reason === 'submitted' && attempt.submissions.length === 0) throw new PacketFailure('DISPOSITION_DIFFERS');
  if (prehandover ? attempt.handover_at_ms !== null || attempt.deadline_at_ms !== null : attempt.handover_at_ms === null || attempt.handover_at_ms < attempt.attempt_started_at_ms || attempt.handover_at_ms > Number.MAX_SAFE_INTEGER - 300000 || attempt.deadline_at_ms !== attempt.handover_at_ms + 300000) throw new PacketFailure('DEADLINE_DIFFERS');
  if (attempt.playback_source !== null && (!source || attempt.mode !== 'public' || setup.task.scenario !== 'stale-queue')) throw new PacketFailure('SOURCE_CONTEXT_DIFFERS');
  if (attempt.playback_source === null && source) throw new PacketFailure('UNEXPECTED_SOURCE');
  const preview = source ? createRecordedSession(source, async () => { throw new Error('Not evaluated'); }, buildCorpus, { now: () => attempt.attempt_started_at_ms }) : createSession({ scenario: setup.task.scenario, now: () => attempt.attempt_started_at_ms }, async () => { throw new Error('Not evaluated'); }, buildCorpus);
  let expected;
  try { preview.start(); expected = preview.exportAttempt(); } finally { preview.dispose(); }
  requireEqual(attempt.setup, expected.setup, 'SETUP_DIFFERS');
  requireEqual(attempt.playback_source, expected.playback_source, 'SOURCE_COMMITMENT_DIFFERS');
  requireEqual(attempt.provenance, expected.provenance, 'SOURCE_METADATA_DIFFERS');
  const prefix = expected.commands, prefixLength = Math.min(attempt.commands.length, prefix.length);
  if (!prehandover && prefixLength !== prefix.length || attempt.terminal_reason === 'setup' && attempt.commands.length) throw new PacketFailure('EXPOSURE_INCOMPLETE');
  const engine = createEngine(expected.setup), cuts: { plant: CanonicalPlant; hash: string; lower: number; upper: number }[] = [];
  let elapsed = 0, recoveryIndex = 0, terminalPhase: 'submitted' | 'timed_out' | null = null;
  let lastRecoveryCut = prefix.length, firstTerminalCut = attempt.commands.length;
  const sourceIds = new Set(source?.commands.map(command => command.request.request_id) ?? []);
  const recoveryId = (sequence: number) => {
    if (!source) return `session.${sequence}`;
    for (let i = 0; i <= sourceIds.size; i++) { const id = `recovery.${sequence}.${i}`; if (!sourceIds.has(id)) return id; }
    throw new PacketFailure('REQUEST_ID_CAPACITY');
  };
  for (const [index, command] of attempt.commands.entries()) {
    checkTime(); validateRequest(command.request);
    if (command.seq !== index + 1 || command.elapsed_ms < elapsed) throw new PacketFailure('COMMAND_ORDER_DIFFERS');
    elapsed = command.elapsed_ms;
    const absoluteTime = attempt.attempt_started_at_ms + elapsed;
    if (!Number.isSafeInteger(absoluteTime)) throw new PacketFailure('COMMAND_TIME_INVALID');
    if (index < prefix.length) {
      const authored = prefix[index]!;
      requireEqual(command.request, authored.request, 'EXPOSURE_REQUEST_DIFFERS'); requireEqual(command.actor, authored.actor, 'EXPOSURE_AUTHORITY_DIFFERS');
    } else {
      if (prehandover || command.actor.actor_id !== attempt.attempt_id || command.actor.role !== 'human' || command.request.request_id !== recoveryId(++recoveryIndex)) throw new PacketFailure('RECOVERY_AUTHORITY_DIFFERS');
      if (command.actor.phase === 'recovery') {
        if (terminalPhase !== null) throw new PacketFailure('DISPOSITION_DIFFERS');
        lastRecoveryCut = index + 1;
      } else if (command.actor.phase === 'submitted' || command.actor.phase === 'timed_out') {
        if (terminalPhase !== null && terminalPhase !== command.actor.phase) throw new PacketFailure('DISPOSITION_DIFFERS');
        terminalPhase = command.actor.phase; firstTerminalCut = Math.min(firstTerminalCut, index);
      }
      if (absoluteTime < attempt.handover_at_ms! || !['recovery', 'submitted', 'timed_out'].includes(command.actor.phase)) throw new PacketFailure('RECOVERY_TIME_DIFFERS');
      if (command.actor.phase === 'recovery' && absoluteTime > attempt.deadline_at_ms!) throw new PacketFailure('LATE_RECOVERY_COMMAND');
      if (command.actor.phase === 'timed_out' && (absoluteTime <= attempt.deadline_at_ms! || attempt.submissions.length > 0)) throw new PacketFailure('TIMEOUT_AUTHORITY_DIFFERS');
      if (command.actor.phase === 'submitted') {
        const admitted = attempt.submissions.some(item => item.admitted_at_ms <= absoluteTime);
        // Corpus construction can fail before the session appends a submission record.
        if (!admitted && !(attempt.candidate !== null && attempt.corpus === null)) throw new PacketFailure('SUBMITTED_AUTHORITY_DIFFERS');
        if (attempt.mode === 'public' && absoluteTime <= attempt.deadline_at_ms!) throw new PacketFailure('EARLY_PUBLIC_TERMINAL_PHASE');
      }
    }
    setEnginePhase(engine, source && index < prefix.length && snapshot(engine).tick >= 5 ? 'recovery' : command.actor.phase);
    const result = dispatch(engine, command.request, command.actor), plant = snapshot(engine);
    if (command.result_sha256 !== sha256Json(result) || command.tick !== plant.tick) throw new PacketFailure('COMMAND_RECEIPT_DIFFERS');
    const upper = attempt.commands[index + 1]?.elapsed_ms;
    if (index + 1 >= prefix.length) cuts.push({ plant, hash: sha256Json(plant), lower: Math.max(absoluteTime, attempt.handover_at_ms ?? absoluteTime), upper: upper === undefined ? Number.MAX_SAFE_INTEGER : attempt.attempt_started_at_ms + upper });
  }
  if (terminalPhase !== null && attempt.terminal_reason !== terminalPhase || attempt.mode === 'local_rehearsal' && attempt.submissions.length > 1 || attempt.terminal_reason === 'timed_out' && attempt.submissions.length > 0 || attempt.terminal_reason === 'submitted' && attempt.candidate === null) throw new PacketFailure('DISPOSITION_DIFFERS');
  for (const item of [...attempt.precommitments, ...attempt.visibility]) if (item.at_ms < attempt.attempt_started_at_ms) throw new PacketFailure('METADATA_TIME_DIFFERS');
  for (const item of attempt.previous_attempts) if (item.attempt_id === attempt.attempt_id || !['submitted', 'timed_out', 'abandoned_reset'].includes(item.disposition)) throw new PacketFailure('PREVIOUS_DISPOSITION_DIFFERS');
  return { cuts, prefix: prefix.length, lastRecoveryCut, firstTerminalCut };
}
/** Full local reconstruction followed by the separately retained Python suite oracle. */
export async function verifyEvidencePacket(raw: string, requestId = 'evidence.verify'): Promise<PacketVerification> {
  const files = implementationFiles();
  const result: PacketVerification = { request_id: /^[A-Za-z0-9_.-]{1,64}$/.test(requestId) ? requestId : 'evidence.verify', status: 'invalid', integrity: { status: 'invalid', code: 'NOT_CHECKED' }, commands: { status: 'incomplete', count: 0, code: 'NOT_CHECKED' }, submissions: [], current_attempt: { disposition: null, status: 'not_checked', primary_submission: null, repair_qualification: 'not_qualified' }, provenance: { status: 'unverified', category: null, note: 'Imported category, source hashes, authorship and local timestamps are claims. Reconstruction cannot authenticate model provenance or real elapsed time. Same-millisecond ordering is bounded by the recorded full revision and adjacent command times.' }, declared: null, loaded_identity: { ...packetIdentifiers, implementation_sha256: sha256Json(files), implementation_files: files, reference_status: 'unavailable' }, issues: [] };
  let stage: 'integrity' | 'commands' | 'submissions' = 'integrity';
  const started = Date.now(), checkTime = () => { if (Date.now() - started > 30000) throw new PacketFailure('VERIFICATION_TIME_LIMIT'); };
  try {
    const packet = parseEvidencePacket(raw), attempt = parseCompactAttempt(packet.attempt);
    requireEqual(packet.inventory, packetInventory(packet.attempt, packet.playback_source), 'INVENTORY_DIFFERS');
    result.integrity = { status: 'consistent', code: 'INVENTORY_RECOMPUTED' }; result.declared = packet.declared; result.provenance.category = attempt.provenance.category; result.current_attempt.disposition = attempt.terminal_reason;
    let incomplete = false;
    for (const key of Object.keys(packetIdentifiers) as (keyof typeof packetIdentifiers)[]) if (packet.declared[key] !== packetIdentifiers[key]) { result.issues.push(`DECLARED_${key.toUpperCase()}_UNCONFIRMED`); incomplete = true; }
    try { referenceDirectory(); result.loaded_identity.reference_status = 'verified'; }
    catch { result.issues.push('INDEPENDENT_REFERENCE_UNAVAILABLE'); incomplete = true; }
    if (result.loaded_identity.reference_manifest_sha256 !== REFERENCE_MANIFEST_SHA256) throw new PacketFailure('LOADED_REFERENCE_ID_DIFFERS');
    stage = 'commands'; result.commands.count = attempt.commands.length;
    if (attempt.playback_source !== null && packet.playback_source === null) {
      result.commands = { status: 'incomplete', count: attempt.commands.length, code: 'PLAYBACK_SOURCE_UNAVAILABLE' }; result.status = 'incomplete'; result.issues.push('PLAYBACK_SOURCE_UNAVAILABLE'); return result;
    }
    const source = packet.playback_source === null ? undefined : packetJson(packet.playback_source, attemptByteLimit) as SessionPlaybackSource;
    const history = reconstruct(attempt, source, checkTime);
    result.current_attempt.status = 'consistent';
    if (attempt.mode === 'local_rehearsal' && attempt.terminal_reason === 'submitted') {
      result.current_attempt.primary_submission = attempt.submissions.length ? 0 : null; result.current_attempt.repair_qualification = 'incomplete';
    }
    result.commands = { status: 'consistent', count: attempt.commands.length, code: 'ALL_COMMANDS_RECONSTRUCTED' }; stage = 'submissions';
    let previousCut = history.prefix, previousAdmission = attempt.handover_at_ms ?? 0;
    for (const [index, submission] of attempt.submissions.entries()) {
      checkTime();
      const item: PacketSubmissionResult = { index, status: 'invalid', command_cut: null, retained_status: null, computed_status: null, candidate_sha256: null, code: 'NOT_CHECKED' }; result.submissions.push(item);
      const candidate = submission.candidate; validateCandidate(candidate);
      item.candidate_sha256 = candidate.candidate_sha256;
      if (attempt.handover_at_ms === null || attempt.deadline_at_ms === null || submission.admitted_at_ms < previousAdmission || submission.admitted_at_ms > attempt.deadline_at_ms) throw new PacketFailure('SUBMISSION_ADMISSION_DIFFERS');
      const cutIndex = history.cuts.findIndex((cut, offset) => {
        const position = offset + history.prefix;
        const primaryOrder = attempt.mode !== 'local_rehearsal' || position >= history.lastRecoveryCut && position <= history.firstTerminalCut;
        return primaryOrder && position >= previousCut && cut.hash === candidate.candidate_sha256 && submission.admitted_at_ms >= cut.lower && submission.admitted_at_ms <= cut.upper;
      });
      if (cutIndex < 0) throw new PacketFailure('SUBMISSION_HISTORICAL_CUT_DIFFERS');
      const cut = history.cuts[cutIndex]!; item.command_cut = cutIndex + history.prefix;
      requireEqual(candidate, expectedCandidate(attempt, cut.plant), 'SUBMISSION_STATE_DIFFERS');
      if (attempt.mode === 'local_rehearsal' && attempt.commands.slice(item.command_cut).some(command => command.actor.phase === 'recovery')) throw new PacketFailure('PRIMARY_CONTINUED_AFTER_SUBMISSION');
      previousCut = item.command_cut; previousAdmission = submission.admitted_at_ms;
      const corpus = buildCorpus(candidate); requireEqual(submission.corpus, corpus, 'SUBMISSION_CORPUS_DIFFERS');
      const retained = submission.evaluation;
      item.retained_status = retained && typeof retained === 'object' && 'status' in retained ? String(retained.status) : null;
      if (result.loaded_identity.reference_status !== 'verified') { item.status = 'incomplete'; item.code = 'INDEPENDENT_REFERENCE_UNAVAILABLE'; continue; }
      const computed = await evaluateCandidate(expectedCandidate(attempt, cut.plant), corpus); checkTime(); item.computed_status = computed.status;
      if (retained === null || !['pass', 'mismatch'].includes(item.retained_status ?? '')) {
        if (retained !== null && ['pass', 'mismatch'].includes(computed.status)) {
          for (const observation of retained.observations) requireEqual(observation, computed.observations.find(value => value.case_id === observation.case_id), 'PARTIAL_OBSERVATION_DIFFERS');
          for (const retainedCase of retained.cases) requireEqual(retainedCase, computed.cases.find(value => value.case_id === retainedCase.case_id), 'PARTIAL_CASE_DIFFERS');
        }
        item.status = 'incomplete'; item.code = retained === null ? 'RETAINED_EVALUATION_PENDING' : 'RETAINED_EVALUATION_INCOMPLETE'; incomplete = true; continue;
      }
      if (!['pass', 'mismatch'].includes(computed.status)) { item.status = 'incomplete'; item.code = 'INDEPENDENT_EVALUATION_INCOMPLETE'; incomplete = true; continue; }
      requireEqual(retained, computed, 'SUBMISSION_EVALUATION_DIFFERS'); item.status = 'reproduced'; item.code = 'FULL_EVALUATION_REPRODUCED';
    }
    const last = attempt.submissions.at(-1);
    if (last && canonicalJson(attempt.candidate) === canonicalJson(last.candidate)) {
      requireEqual(attempt.corpus, last.corpus, 'LATEST_CORPUS_DIFFERS'); requireEqual(attempt.evaluation, last.evaluation, 'LATEST_EVALUATION_DIFFERS');
    } else if (attempt.candidate !== null) {
      // A corpus failure captures a candidate before a submission record exists.
      if (attempt.corpus !== null || attempt.evaluation === null || !['budget_limit', 'invalid'].includes(attempt.evaluation.status)) throw new PacketFailure('UNRECORDED_CAPTURE_RESULT_DIFFERS');
      try { validateCandidate(attempt.candidate); } catch (error) { if (!(error instanceof EvaluationBudgetLimit)) throw error; }
      const reachable = history.cuts.some((cut, offset) => offset + history.prefix >= previousCut && canonicalJson(expectedCandidate(attempt, cut.plant)) === canonicalJson(attempt.candidate));
      if (!reachable || attempt.evaluation.candidate_sha256 !== attempt.candidate.candidate_sha256) throw new PacketFailure('UNRECORDED_CAPTURE_STATE_DIFFERS');
      incomplete = true; result.issues.push('UNRECORDED_OR_INCOMPLETE_CAPTURE');
    } else {
      if (last || attempt.corpus !== null || attempt.evaluation !== null) throw new PacketFailure('ORPHANED_EVALUATION');
      incomplete = true; result.issues.push('NO_RETAINED_SUBMISSION');
    }
    result.status = incomplete ? 'incomplete' : 'reproduced';
    // Public checks retain their individual verdicts. Only a closed rehearsal has a primary attempt result.
    const primary = result.submissions[0];
    if (result.status === 'reproduced' && attempt.mode === 'local_rehearsal' && attempt.terminal_reason === 'submitted' && primary?.status === 'reproduced' && (primary.computed_status === 'pass' || primary.computed_status === 'mismatch')) result.current_attempt.repair_qualification = primary.computed_status;
    return result;
  } catch (error) {
    const code = error instanceof PacketFailure ? error.code : stage === 'integrity' ? 'PACKET_FORMAT_INVALID' : stage === 'commands' ? 'COMMAND_RECONSTRUCTION_FAILED' : 'SUBMISSION_FORMAT_INVALID';
    if (code === 'DISPOSITION_DIFFERS') result.current_attempt.status = 'invalid';
    if (stage === 'integrity') result.integrity = { status: 'invalid', code };
    if (stage === 'commands') result.commands = { ...result.commands, status: 'invalid', code };
    if (stage === 'submissions') { const item = result.submissions.at(-1); if (item?.status === 'invalid') item.code = code; }
    if (code === 'VERIFICATION_TIME_LIMIT') { result.status = 'incomplete'; if (stage === 'commands') result.commands.status = 'incomplete'; }
    result.issues.push(code); return result;
  }
}
