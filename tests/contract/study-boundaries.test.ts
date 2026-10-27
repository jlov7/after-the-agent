import { expect, it } from 'vitest';
import { restoreRehearsalReceipt } from '../../apps/web/src/study/receipt.js';
import { factualManifest } from '../../apps/web/src/study/manifest.js';
import { createSession } from '../../packages/engine/src/index.js';
import { buildCorpus } from '../../packages/runner/src/continuations.js';
import { evaluateCandidate } from '../../packages/runner/src/evaluate-browser.js';
import { sha256Json } from '../../packages/contracts/src/index.js';
for (const scenario of ['stale-queue','duplicate-clock','cached-gate'] as const) {
  it(`${scenario}: pre-commitment, unsure and missing choices preserve the matched trace and handover`, () => {
    const manifest = factualManifest(scenario);
    expect(manifest.schedule).toEqual({ before_ms: 25000, after_ms: 20000, windows: 3 });
    expect(manifest.windows).toHaveLength(3);
    let now = 0;
    const sessions = [createSession({ scenario, mode: 'local_rehearsal', condition: 'observation', now: () => now }, evaluateCandidate, buildCorpus), createSession({ scenario, mode: 'local_rehearsal', condition: 'precommitment', now: () => now }, evaluateCandidate, buildCorpus)];
    try {
      for (let window = 0; window < 3; window++) {
        now = 25000 + window * 45000;
        const before = sessions.map(session => sha256Json(session.getView().plant));
        expect(sessions[0]!.getView().plant).toEqual(manifest.windows[window]!.before_plant);
        sessions[1]!.recordPrecommitment(window + 1, window === 0 ? 'Unsure' : window === 1 ? 'Leave the system unchanged' : null);
        expect(sessions.map(session => sha256Json(session.getView().plant))).toEqual(before);
        sessions.forEach(session => session.playbackStep());
        expect(sessions[0]!.getView().plant).toEqual(sessions[1]!.getView().plant);
        expect(sessions[0]!.getView().history).toEqual(sessions[1]!.getView().history);
      }
      now = 135000; sessions.forEach(session => session.start());
      expect(sha256Json(sessions[0]!.getView().plant)).toBe(manifest.handover_sha256);
      expect(sessions[0]!.getView().phase).toBe('recovery');
      expect(sessions[0]!.getView().plant.tick).toBe(5);
      expect(sessions[1]!.exportAttempt().researchEligible).toBe(false);
      const receipt = { schema_version:'1.0',synthetic:true,researchEligible:false,condition:'observation',scenario,exposure_started_at:0,scheduled_handover_at:135000,factual_payload_sha256:manifest.factual_payload_sha256,handover_sha256:manifest.handover_sha256,choices:[null,null,null],timings:[25000,70000,115000].map((time,window)=>({window,revealed_at:time,actual_elapsed_ms:time})),commands:sessions[0]!.getView().history };
      expect(restoreRehearsalReceipt(JSON.stringify(receipt),sessions[0]!,135000)).toEqual(receipt);
      expect(()=>restoreRehearsalReceipt(JSON.stringify({...receipt,handover_sha256:'f'.repeat(64)}),sessions[0]!,135000)).toThrow();
      expect(()=>restoreRehearsalReceipt(JSON.stringify({...receipt,commands:[]}),sessions[0]!,135000)).toThrow();
    } finally { sessions.forEach(session => session.dispose()); }
  });
}
