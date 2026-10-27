import { compileSchema, evaluationSchema, sha256Json, canonicalJson } from '../../contracts/src/index.js';
import type { Case, Observation, Pulse } from '../../contracts/src/index.js';
export class InvalidEvidence extends Error {}
const caseShape = compileSchema<Case>({ $schema: evaluationSchema.$schema, $defs: evaluationSchema.$defs, $ref: '#/$defs/Case' });
const observationShape = compileSchema<Observation>({ $schema: evaluationSchema.$schema, $defs: evaluationSchema.$defs, $ref: '#/$defs/Observation' });
export function validateCase(value: unknown): Case {
  const checked = caseShape(value);
  if (!checked.valid) throw new InvalidEvidence('Invalid case shape');
  const c = checked.data;
  if (c.handover_tick >= c.enqueue_until_tick) throw new InvalidEvidence('Invalid evaluation cut');
  let previous = 0;
  for (const transition of c.transitions) {
    if (transition.tick <= previous || transition.tick > c.enqueue_until_tick + 2) throw new InvalidEvidence('Invalid transition order or horizon');
    previous = transition.tick;
  }
  return c;
}
export function caseDigest(value: unknown): string { return sha256Json(validateCase(value)); }
export function expectedPulses(value: unknown): Pulse[] {
  const c = validateCase(value);
  const world = [{ epoch: 1, active: c.initial_world.active }];
  let scene = c.initial_world.scene_id, active = c.initial_world.active, epoch = 1, changeIndex = 0;
  for (let tick = 1; tick <= c.enqueue_until_tick + 2; tick++) {
    const change = c.transitions[changeIndex];
    if (change?.tick === tick) {
      if (change.scene_id !== scene || change.active !== active) epoch++;
      scene = change.scene_id; active = change.active; changeIndex++;
    }
    world.push({ epoch, active });
  }
  const pulses: Pulse[] = [];
  for (let enqueue = 4; enqueue <= c.enqueue_until_tick; enqueue += 4) {
    const tick = enqueue + 2;
    if (tick <= c.handover_tick || !world[enqueue]!.active || world[enqueue]!.epoch !== world[tick]!.epoch) continue;
    const ordinal = enqueue / 4;
    pulses.push({ tick, lamp: ordinal % 2 ? 'left' : 'right' });
    if (ordinal % 4 === 0) pulses.push({ tick, lamp: 'center' });
  }
  return pulses;
}
export interface CountedPulse extends Pulse { count: number }
export interface ReferenceCaseResult { case_id: string; case_sha256: string; candidate_sha256: string; passed: boolean; expected_count: number; observed_count: number; missing: CountedPulse[]; extra: CountedPulse[] }
export interface ReferenceVerdict { passed: boolean; case_count: number; candidate_sha256: string; results: ReferenceCaseResult[]; missing: (CountedPulse & { case_id: string })[]; extra: (CountedPulse & { case_id: string })[] }
function validateObservation(c: Case, value: unknown): Observation {
  const check = observationShape(value);
  if (!check.valid) throw new InvalidEvidence('Invalid observation shape');
  const o = check.data;
  if (o.case_id !== c.case_id || o.case_sha256 !== caseDigest(c) || o.handover_tick !== c.handover_tick || o.observed_through_tick !== c.enqueue_until_tick + 2) throw new InvalidEvidence('Observation task or drain does not match');
  for (const pulse of o.pulses) if (pulse.tick <= c.handover_tick || pulse.tick > c.enqueue_until_tick + 2) throw new InvalidEvidence('Pulse outside observation window');
  return o;
}
export function evaluateCase(value: unknown, observed: unknown): ReferenceCaseResult {
  const c = validateCase(value), o = validateObservation(c, observed), expected = expectedPulses(c);
  const counts = new Map<string, { pulse: Pulse; count: number }>();
  for (const [pulses, delta] of [[expected, 1], [o.pulses, -1]] as const) for (const pulse of pulses) {
    const key = `${pulse.tick}:${pulse.lamp}`, entry = counts.get(key) ?? { pulse, count: 0 };
    entry.count += delta; counts.set(key, entry);
  }
  const missing: CountedPulse[] = [], extra: CountedPulse[] = [];
  for (const { pulse, count } of [...counts.values()].sort((a,b) => a.pulse.tick-b.pulse.tick || a.pulse.lamp.localeCompare(b.pulse.lamp))) {
    if (count > 0) missing.push({ ...pulse, count });
    if (count < 0) extra.push({ ...pulse, count: -count });
  }
  return { case_id: c.case_id, case_sha256: caseDigest(c), candidate_sha256: o.candidate_sha256, passed: !missing.length && !extra.length, expected_count: expected.length, observed_count: o.pulses.length, missing, extra };
}
export function evaluateSuite(values: unknown, observations: unknown): ReferenceVerdict {
  if (!Array.isArray(values) || values.length < 1 || values.length > 256 || !Array.isArray(observations) || observations.length !== values.length) throw new InvalidEvidence('Exactly one observation per assigned case required');
  const cases = values.map(validateCase), assigned = new Map(cases.map(c => [c.case_id, c]));
  if (assigned.size !== cases.length) throw new InvalidEvidence('Duplicate case identity');
  const prefix = (c: Case) => canonicalJson([c.handover_tick, c.initial_world, c.transitions.filter(t => t.tick <= c.handover_tick)]);
  if (cases.some(c => prefix(c) !== prefix(cases[0]!))) throw new InvalidEvidence('Mixed candidate cut or authoritative prefix');
  const byCase = new Map<string, Observation>(); let candidate: string | undefined;
  for (const value of observations) {
    const id = typeof value === 'object' && value !== null ? value.case_id : undefined;
    const c = assigned.get(id);
    if (!c || byCase.has(id)) throw new InvalidEvidence('Unassigned or duplicate observation');
    const o = validateObservation(c, value);
    if (candidate !== undefined && candidate !== o.candidate_sha256) throw new InvalidEvidence('Mixed candidate identities');
    candidate = o.candidate_sha256; byCase.set(id, o);
  }
  const results = cases.map(c => evaluateCase(c, byCase.get(c.case_id)));
  if (!results.some(r => r.expected_count > 0)) throw new InvalidEvidence('Suite has no expected liveness');
  return { passed: results.every(r => r.passed), case_count: results.length, candidate_sha256: candidate!, results, missing: results.flatMap(r => r.missing.map(p => ({case_id:r.case_id,...p}))), extra: results.flatMap(r => r.extra.map(p => ({case_id:r.case_id,...p}))) };
}
