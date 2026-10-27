import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { afterEach, expect, test } from 'vitest';
import { compactAttemptExport, createRecordedSession, createSession, type ExtendedBoardSession, type CompactAttemptExport, type SessionPlaybackSource } from '../../packages/engine/src/session.js';
import { type Action, sha256Json, validateRequest } from '../../packages/contracts/src/index.js';
import { buildCorpus } from '../../packages/runner/src/continuations.js';
import { evaluateCandidate } from '../../packages/runner/src/evaluate-browser.js';
import { createEvidencePacket, parseEvidencePacket } from '../../packages/runner/src/evidence-packet.js';
import { verifyEvidencePacket } from '../../packages/runner/src/verify-evidence-packet.js';
import { constructionSetup, createEngine, dispatch, engineAudit, scenarioSetup, setEnginePhase, snapshot } from '../../packages/engine/src/index.js';
const sessions: ExtendedBoardSession[] = [];
afterEach(() => { for (const session of sessions) session.dispose(); sessions.length = 0; });
async function attempt() {
  let time = 1000;
  const session = createSession({ scenario: 'stale-queue', now: () => time }, evaluateCandidate, buildCorpus); sessions.push(session); session.start();
  time += 10; await session.submit();
  time += 10; session.act({ type: 'set_epoch_guard', enabled: true });
  time += 10; await session.submit();
  return { raw: JSON.stringify(compactAttemptExport(session)), session, setTime: (value: number) => { time = value; } };
}
type Mutable<T> = T extends readonly (infer V)[] ? Mutable<V>[] : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
function mutateAttempt(raw: string, change: (value: Mutable<CompactAttemptExport>) => void) { const value = JSON.parse(raw); change(value); return createEvidencePacket(JSON.stringify(value)); }
test('every retained check reconstructs its historical full revision and independently reproduces failed and valid repairs', async () => {
  const { raw } = await attempt(), packet = createEvidencePacket(raw);
  expect(parseEvidencePacket(packet).attempt).toBe(raw);
  const result = await verifyEvidencePacket(packet);
  expect(result.status).toBe('reproduced'); expect(result.commands.status).toBe('consistent');
  expect(result.submissions.map(item => item.retained_status)).toEqual(['mismatch', 'pass']);
  expect(result.submissions.map(item => item.status)).toEqual(['reproduced', 'reproduced']);
  expect(result.submissions[0]!.command_cut).toBe(3); expect(result.submissions[1]!.command_cut).toBe(4);
  expect(result.provenance.status).toBe('unverified'); expect(result.loaded_identity.reference_manifest_sha256).toHaveLength(64);
});
test.each(['queue', 'verdict', 'corpus', 'admission', 'identity', 'world', 'observation'])('rejects a later submission %s forgery even with a recomputed inventory', async kind => {
  const { raw } = await attempt();
  const packet = mutateAttempt(raw, value => {
    const submission = value.submissions[1]!;
    if (kind === 'queue') { submission.candidate.plant.queue = []; submission.candidate.candidate_sha256 = sha256Json(submission.candidate.plant); }
    if (kind === 'verdict') submission.evaluation!.status = 'mismatch';
    if (kind === 'corpus') submission.corpus.cases.pop();
    if (kind === 'admission') submission.admitted_at_ms = value.deadline_at_ms! + 1;
    if (kind === 'identity') submission.candidate.attempt_id = 'attempt.1000.999';
    if (kind === 'world') submission.candidate.world_prefix.transitions = [];
    if (kind === 'observation') submission.evaluation!.observations[0]!.pulses = [];
  });
  expect((await verifyEvidencePacket(packet)).status).toBe('invalid');
});
test('the candidate may not borrow a later command state before its recorded admission', async () => {
  const { raw } = await attempt();
  const packet = mutateAttempt(raw, value => { value.submissions[1]!.admitted_at_ms = 1015; });
  expect((await verifyEvidencePacket(packet)).status).toBe('invalid');
});
test('altered command commitment and inventory fail independently', async () => {
  const { raw } = await attempt();
  const changedCommand = mutateAttempt(raw, value => { const action = value.commands[3]!.request.action; if (action.type === 'set_epoch_guard') action.enabled = false; });
  expect((await verifyEvidencePacket(changedCommand)).commands.status).toBe('invalid');
  const changedBytes = JSON.parse(createEvidencePacket(raw)); changedBytes.attempt += ' ';
  expect((await verifyEvidencePacket(JSON.stringify(changedBytes))).integrity.status).toBe('invalid');
});
test('pending evaluation stays incomplete, never promoted to independently retained success', async () => {
  const { raw } = await attempt();
  const packet = mutateAttempt(raw, value => { value.submissions[1]!.evaluation = null; value.evaluation = null; });
  const result = await verifyEvidencePacket(packet);
  expect(result.status).toBe('incomplete'); expect(result.submissions[1]!.status).toBe('incomplete');
});
test('expired capture has no invented submission or success', async () => {
  let time = 1000;
  const session = createSession({ scenario: 'stale-queue', now: () => time }, evaluateCandidate, buildCorpus); sessions.push(session); session.start(); time = 301001;
  await session.submit(); const result = await verifyEvidencePacket(createEvidencePacket(JSON.stringify(compactAttemptExport(session))));
  expect(result.status).toBe('incomplete'); expect(result.submissions).toEqual([]);
});
function source(construction = false): SessionPlaybackSource {
  const setup = construction ? constructionSetup() : scenarioSetup('stale-queue'), engine = createEngine(setup), actor = { actor_id: 'fixture', role: 'assessed_agent', phase: 'setup' } as const;
  const actions: Action[] = construction ? [{ type: 'set_clock', clock: 'primary', enabled: true }, { type: 'set_gate_mode', mode: 'live' }, { type: 'set_epoch_guard', enabled: true }, { type: 'advance', ticks: 5 }] : [{ type: 'advance', ticks: 4 }, { type: 'advance', ticks: 1 }];
  for (const [index, action] of actions.entries()) dispatch(engine, { schema_version: '1.0', request_id: `fixture.${index}`, expected_revision: snapshot(engine).revision, action }, actor);
  return { recording_sha256: '1'.repeat(64), setup, commands: engineAudit(engine), provenance: { category: 'fixture', label: 'Scripted preview', model: null, date: null, replay_verified: true } };
}
test('construction packets independently reproduce retained failed and passing checks without admitting unbound settings', async () => {
  const playback = source(true), session = createRecordedSession(playback, evaluateCandidate, buildCorpus, { now: () => 1000 }); sessions.push(session);
  session.start(); await session.submit(); session.act({ type: 'set_epoch_guard', enabled: true }); await session.submit();
  const attempt = compactAttemptExport(session), raw = JSON.stringify(attempt);
  const result = await verifyEvidencePacket(createEvidencePacket(raw, playback));
  expect(result.status).toBe('reproduced'); expect(result.commands.status).toBe('consistent');
  expect(result.submissions.map(item => item.computed_status)).toEqual(['mismatch', 'pass']);
  expect(result.provenance.status).toBe('unverified');
  const unbound = { ...attempt, playback_source: null };
  expect((await verifyEvidencePacket(createEvidencePacket(JSON.stringify(unbound)))).status).toBe('invalid');
  const arbitrary = { ...playback, setup: { ...playback.setup, config: { ...playback.setup.config, epoch_guard: true } } };
  expect((await verifyEvidencePacket(createEvidencePacket(raw, arbitrary))).status).toBe('invalid');
});
test('recording-bound replay requires exact actual source and retains fixture provenance', async () => {
  const playback = source(), session = createRecordedSession(playback, evaluateCandidate, buildCorpus, { now: () => 1000 }); sessions.push(session); session.start(); await session.submit();
  const raw = JSON.stringify(compactAttemptExport(session));
  expect((await verifyEvidencePacket(createEvidencePacket(raw))).status).toBe('incomplete');
  const changed = { ...playback, recording_sha256: '2'.repeat(64) };
  expect((await verifyEvidencePacket(createEvidencePacket(raw, changed))).status).toBe('invalid');
  const result = await verifyEvidencePacket(createEvidencePacket(raw, playback));
  expect(result.status).toBe('reproduced'); expect(result.provenance.category).toBe('fixture'); expect(result.provenance.status).toBe('unverified');
});
test('unknown declared version remains incomplete and identifiers are separate from loaded identity', async () => {
  const { raw } = await attempt(), packet = JSON.parse(createEvidencePacket(raw)); packet.declared.engine = null;
  const result = await verifyEvidencePacket(JSON.stringify(packet)); expect(result.status).toBe('incomplete'); expect(result.loaded_identity.engine).toBeTruthy();
});
test('packet bounds and duplicate envelope keys reject before command execution', async () => {
  const { raw } = await attempt();
  expect(() => createEvidencePacket(' '.repeat(8 * 1024 * 1024 + 1))).toThrow();
  const packet = createEvidencePacket(raw);
  expect((await verifyEvidencePacket(packet.replace('{', '{"version":"1.0",'))).status).toBe('invalid');
  expect(() => mutateAttempt(raw, value => { value.commands = Array(10001).fill(value.commands[0]); })).toThrow();
  expect(() => mutateAttempt(raw, value => { value.submissions = Array(129).fill(value.submissions[0]); })).toThrow();
});

test('zero-demand cases retain their complete empty observations while the whole twelve-case suite is verified', async () => {
  const session = createSession({ scenario: 'cached-gate', now: () => 1000 }, evaluateCandidate, buildCorpus); sessions.push(session); session.start(); session.act({ type: 'set_gate_mode', mode: 'live' }); await session.submit();
  const raw = JSON.stringify(compactAttemptExport(session)), attempt = JSON.parse(raw);
  expect(attempt.submissions[0].evaluation.observations.find((item: { case_id: string }) => item.case_id === 'quiet-prefix').pulses).toEqual([]);
  const result = await verifyEvidencePacket(createEvidencePacket(raw)); expect(result.status).toBe('reproduced'); expect(result.submissions[0]!.retained_status).toBe('pass');
});
test('a late state capture that cannot fit continuation budgets remains incomplete', async () => {
  const session = createSession({ scenario: 'stale-queue', now: () => 1000 }, evaluateCandidate, buildCorpus); sessions.push(session); session.start();
  while (session.getView().plant.tick < 4031) session.act({ type: 'advance', ticks: Math.min(64, 4031 - session.getView().plant.tick) });
  expect((await session.submit()).status).toBe('budget_limit');
  const result = await verifyEvidencePacket(createEvidencePacket(JSON.stringify(compactAttemptExport(session)))); expect(result.status).toBe('incomplete'); expect(result.issues).toContain('UNRECORDED_OR_INCOMPLETE_CAPTURE');
});

test('CLI invokes the offline oracle, separates invalid and incomplete exits and emits no machine paths', async () => {
  const { raw } = await attempt(); mkdirSync('work/twelve-packet', { recursive: true });
  const file = 'work/twelve-packet/cli.json';
  const run = () => spawnSync(process.execPath, ['dist/packages/runner/src/evidence-packet-cli.js', file], { encoding: 'utf8', timeout: 35000 });
  writeFileSync(file, createEvidencePacket(raw)); const valid = run(); expect(valid.status).toBe(0); expect(JSON.parse(valid.stdout).status).toBe('reproduced'); expect(valid.stdout).not.toContain('/Users/');
  writeFileSync(file, mutateAttempt(raw, value => { value.submissions[1]!.evaluation!.status = 'mismatch'; })); const invalid = run(); expect(invalid.status).toBe(2); expect(JSON.parse(invalid.stdout).status).toBe('invalid');
  const unconfirmed = JSON.parse(createEvidencePacket(raw)); unconfirmed.declared.build = null; writeFileSync(file, JSON.stringify(unconfirmed)); const incomplete = run(); expect(incomplete.status).toBe(3); expect(JSON.parse(incomplete.stdout).status).toBe('incomplete');
});
test('partial worker failure cannot smuggle changed complete observations', async () => {
  const { raw } = await attempt();
  const changed = mutateAttempt(raw, value => { value.submissions[1]!.evaluation!.status = 'worker_error'; value.submissions[1]!.evaluation!.observations[0]!.pulses = []; value.evaluation = value.submissions[1]!.evaluation; });
  expect((await verifyEvidencePacket(changed)).status).toBe('invalid');
});

test('review regression: same-millisecond inspect before a rehearsal submission selects its reachable primary cut', async () => {
  const session = createSession({ scenario: 'stale-queue', mode: 'local_rehearsal', now: () => 1000 }, evaluateCandidate, buildCorpus); sessions.push(session);
  session.start(); session.act({ type: 'inspect', target: 'board' }); await session.submit();
  const result = await verifyEvidencePacket(createEvidencePacket(JSON.stringify(compactAttemptExport(session))));
  expect(result.status).toBe('reproduced'); expect(result.submissions[0]!.command_cut).toBe(4);
  expect(result.current_attempt).toEqual({ disposition: 'submitted', status: 'consistent', primary_submission: 0, repair_qualification: 'mismatch' });
});
test('review regression: repeated same-millisecond inspections straddle a closed passing primary without moving its cut', async () => {
  const session = createSession({ scenario: 'stale-queue', mode: 'local_rehearsal', now: () => 1000 }, evaluateCandidate, buildCorpus); sessions.push(session);
  session.start(); session.act({ type: 'inspect', target: 'board' }); session.act({ type: 'inspect', target: 'board' }); session.act({ type: 'set_epoch_guard', enabled: true }); session.act({ type: 'inspect', target: 'board' }); await session.submit(); session.act({ type: 'inspect', target: 'board' });
  const result = await verifyEvidencePacket(createEvidencePacket(JSON.stringify(compactAttemptExport(session))));
  expect(result.status).toBe('reproduced'); expect(result.submissions[0]!.command_cut).toBe(7); expect(result.current_attempt.repair_qualification).toBe('pass');
});
test('review regression: repeated public same-millisecond checks and inspections remain independently reproducible', async () => {
  const session = createSession({ scenario: 'stale-queue', now: () => 1000 }, evaluateCandidate, buildCorpus); sessions.push(session);
  session.start(); session.act({ type: 'inspect', target: 'board' }); await session.submit(); session.act({ type: 'inspect', target: 'board' }); await session.submit(); session.act({ type: 'set_epoch_guard', enabled: true }); session.act({ type: 'inspect', target: 'board' }); await session.submit();
  const result = await verifyEvidencePacket(createEvidencePacket(JSON.stringify(compactAttemptExport(session))));
  expect(result.status).toBe('reproduced'); expect(result.submissions.map(item => item.computed_status)).toEqual(['mismatch', 'mismatch', 'pass']); expect(result.current_attempt.repair_qualification).toBe('not_qualified');
});
test('review regression: recomputed packet inventory cannot turn a current attempt into abandoned reset', async () => {
  const { raw } = await attempt();
  const result = await verifyEvidencePacket(mutateAttempt(raw, value => { value.terminal_reason = 'abandoned_reset'; }));
  expect(result.status).toBe('invalid');
});
test.each(['recovery', 'timed_out', 'abandoned_reset'] as const)('review regression: a closed rehearsal cannot claim %s disposition', async phase => {
  const session = createSession({ scenario: 'stale-queue', mode: 'local_rehearsal', now: () => 1000 }, evaluateCandidate, buildCorpus); sessions.push(session); session.start(); session.act({ type: 'set_epoch_guard', enabled: true }); await session.submit();
  const result = await verifyEvidencePacket(mutateAttempt(JSON.stringify(compactAttemptExport(session)), value => { value.terminal_reason = phase; }));
  expect(result.status).toBe('invalid');
});
test('review regression: fixture source does not authorize an unreachable reset disposition', async () => {
  const playback = source(), session = createRecordedSession(playback, evaluateCandidate, buildCorpus, { now: () => 1000 }); sessions.push(session); session.start(); await session.submit();
  const value = JSON.parse(JSON.stringify(compactAttemptExport(session))); value.terminal_reason = 'abandoned_reset';
  const result = await verifyEvidencePacket(createEvidencePacket(JSON.stringify(value), playback)); expect(result.status).toBe('invalid'); expect(result.provenance.status).toBe('unverified');
});

test.each(['mutation', 'phase_regression'] as const)('review regression: a primary cannot be followed by forged recovery %s', async kind => {
  const session = createSession({ scenario: 'stale-queue', mode: 'local_rehearsal', now: () => 1000 }, evaluateCandidate, buildCorpus); sessions.push(session);
  session.start(); session.act({ type: 'set_epoch_guard', enabled: true }); await session.submit();
  if (kind === 'phase_regression') session.act({ type: 'inspect', target: 'board' });
  const raw = JSON.stringify(compactAttemptExport(session));
  const packet = mutateAttempt(raw, value => {
    const engine = createEngine(value.setup);
    for (const command of value.commands) { setEnginePhase(engine, command.actor.phase); dispatch(engine, validateRequest(command.request), command.actor); }
    const actor = { actor_id: value.attempt_id, role: 'human', phase: 'recovery' } as const;
    const request = validateRequest({ schema_version: '1.0', request_id: kind === 'mutation' ? 'session.2' : 'session.3', expected_revision: snapshot(engine).revision, action: kind === 'mutation' ? { type: 'set_epoch_guard', enabled: false } : { type: 'inspect', target: 'board' } });
    setEnginePhase(engine, 'recovery'); const result = dispatch(engine, request, actor);
    value.commands.push({ seq: value.commands.length + 1, actor, request, elapsed_ms: 0, tick: snapshot(engine).tick, result_sha256: sha256Json(result) });
  });
  const result = await verifyEvidencePacket(packet); expect(result.status).toBe('invalid'); expect(result.current_attempt.repair_qualification).not.toBe('pass');
});
test('review regression: restart retains only prior disposition and never inherits a successful repair into the new attempt', async () => {
  const session = createSession({ scenario: 'stale-queue', now: () => 1000 }, evaluateCandidate, buildCorpus); sessions.push(session); session.start(); session.act({ type: 'set_epoch_guard', enabled: true }); await session.submit();
  const old = session.getView().attempt_id; session.restart(); const attempt = compactAttemptExport(session);
  expect(attempt.previous_attempts).toContainEqual({ attempt_id: old, disposition: 'abandoned_reset' });
  const result = await verifyEvidencePacket(createEvidencePacket(JSON.stringify(attempt)));
  expect(result.status).toBe('incomplete'); expect(result.submissions).toEqual([]); expect(result.current_attempt).toEqual({ disposition: 'setup', status: 'consistent', primary_submission: null, repair_qualification: 'not_qualified' });
});
