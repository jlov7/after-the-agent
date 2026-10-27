import { expect, it, vi } from 'vitest';
import { createSession } from '../../packages/engine/src/session.js';
import { canonicalJson } from '../../packages/contracts/src/index.js';
import { buildCorpus } from '../../packages/runner/src/continuations.js';
import { evaluateCandidate } from '../../packages/runner/src/evaluate-browser.js';
import { prepareRepairBranch, runRepairLab } from '../../packages/runner/src/repair-lab.js';

async function retained(scenario: 'valid-pending' | 'duplicate-clock' = 'valid-pending') {
  const session = createSession({ scenario, now: () => 1000 }, evaluateCandidate, buildCorpus); session.start(); await session.submit();
  return { session, base: session.exportAttempt().submissions[0]!.candidate };
}
it('same-base alternatives preserve pending work, clock alignment, counters, task and the live session', async () => {
  const { session, base } = await retained();
  try {
    const before = canonicalJson(session.exportAttempt()), view = session.getView();
    const standby = [{ type: 'set_clock', clock: 'primary', enabled: false }, { type: 'set_clock', clock: 'shadow', enabled: true }] as const;
    const prepared = prepareRepairBranch(base, standby);
    expect(prepared.candidate.plant.queue).toEqual(base.plant.queue);
    expect(prepared.candidate).toMatchObject({ capture_tick: base.capture_tick, task: base.task, world_prefix: base.world_prefix });
    expect(prepared.candidate.plant).toMatchObject({ tick: base.plant.tick, world: base.plant.world, revision: base.plant.revision + 2, event_seq: base.plant.event_seq + 2 });
    const result = await runRepairLab(base, [[], standby], 'quiet-prefix');
    expect(result.branches.map(b => b.evaluation.status)).toEqual(['pass', 'pass']);
    expect(result.branches.every(b => b.inspection.frames[0]!.plant.queue.length === base.plant.queue.length)).toBe(true);
    expect(result.branches[0].inspection.frames.map(f => f.expected)).toEqual(result.branches[1].inspection.frames.map(f => f.expected));
    expect(canonicalJson(session.exportAttempt())).toBe(before); expect(session.getView()).toBe(view); expect(session.getView().remaining_ms).toBe(300000);
  } finally { session.dispose(); }
});
it('duplicate-clock alternative remains a mismatch while explicit repair succeeds, tied to base and edits', async () => {
  const { session, base } = await retained('duplicate-clock');
  try {
    const edits = [{ type: 'set_clock', clock: 'shadow', enabled: false }, { type: 'drop_jobs', job_ids: base.plant.queue.filter(j => j.clock === 'shadow').map(j => j.id) }] as const;
    const result = await runRepairLab(base, [[], edits], 'quiet-prefix');
    expect(result.base_candidate_sha256).toBe(base.candidate_sha256);
    expect(result.branches[0].evaluation.status).toBe('mismatch'); expect(result.branches[1].evaluation.status).toBe('pass');
    expect(result.branches[1].edits).toEqual(edits); expect(result.branches[1].inspection.candidate_sha256).toBe(result.branches[1].candidate.candidate_sha256);
    expect(result.branches[0].candidate.plant.queue).toEqual(base.plant.queue);
  } finally { session.dispose(); }
});
it('rejects untrusted identity, time/world edits, unbounded actions, forged candidates and unknown drops before evaluation', async () => {
  const { session, base } = await retained();
  try {
    for (const edit of [{ type: 'advance', ticks: 1 }, { type: 'set_world', active: false }, { type: 'set_clock', clock: 'primary', enabled: false, phase: 'recovery' }, { type: 'drop_jobs', job_ids: ['invented'] }]) expect(() => prepareRepairBranch(base, [edit])).toThrow();
    expect(() => prepareRepairBranch(base, Array.from({ length: 33 }, () => ({ type: 'refresh_gate' })))).toThrow();
    expect(() => prepareRepairBranch({ ...base, candidate_sha256: '0'.repeat(64) }, [])).toThrow();
    await expect(runRepairLab(base, [[], []], 'invented')).rejects.toThrow();
    await expect(runRepairLab(base, [[], [], []], 'quiet-prefix')).rejects.toThrow();
  } finally { session.dispose(); }
});
it('worker cancellation, stale replies and deadline terminate bounded exploration', async () => {
  const { startRepairLab } = await import('../../apps/web/src/lab/client.js');
  const { session, base } = await retained();
  const port = { onmessage: null as ((event: MessageEvent) => void) | null, onerror: null, onmessageerror: null, postMessage: vi.fn(), terminate: vi.fn() };
  try {
    const task = startRepairLab(base, [[], []], 'quiet-prefix', () => port, 10);
    const rejected = expect(task.promise).rejects.toThrow(/cancelled/); port.onmessage?.({ data: { id: crypto.randomUUID() } } as MessageEvent); task.cancel(); await rejected; expect(port.terminate).toHaveBeenCalledTimes(1);
    await expect(startRepairLab(base, [[], []], 'quiet-prefix', () => port, 5).promise).rejects.toThrow(/15-second|timed out/); expect(port.terminate).toHaveBeenCalledTimes(2);
  } finally { session.dispose(); }
});
it('worker results are checked against the requested edits and regenerated corpus before display', async () => {
  const { startRepairLab } = await import('../../apps/web/src/lab/client.js'); const { session, base } = await retained();
  let request: { id: string } | null = null;
  const port = { onmessage: null as ((event: MessageEvent) => void) | null, onerror: null, onmessageerror: null, postMessage: (value: unknown) => { request = value as { id: string }; }, terminate: vi.fn() };
  try {
    const result = await runRepairLab(base, [[], []], 'quiet-prefix');
    const task = startRepairLab(base, [[], []], 'quiet-prefix', () => port);
    port.onmessage?.({ data: { id: request!.id, error: null, result } } as MessageEvent); await expect(task.promise).resolves.toEqual(result);
    const bad = startRepairLab(base, [[], []], 'quiet-prefix', () => port), rejected = expect(bad.promise).rejects.toThrow(/Lab/);
    port.onmessage?.({ data: { id: request!.id, error: null, result: { ...result, base_candidate_sha256: '0'.repeat(64) } } } as MessageEvent); await rejected;
    const forged = startRepairLab(base, [[], []], 'quiet-prefix', () => port), forgedRejection = expect(forged.promise).rejects.toThrow();
    const mutable = structuredClone(result); Object.assign(mutable.branches[0].evaluation, { status: 'mismatch' });
    port.onmessage?.({ data: { id: request!.id, error: null, result: mutable } } as MessageEvent); await forgedRejection;
    expect(port.terminate).toHaveBeenCalledTimes(3);
  } finally { session.dispose(); }
});
