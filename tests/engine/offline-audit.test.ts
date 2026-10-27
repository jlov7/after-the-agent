import { expect, test } from 'vitest';
import { auditOfflineCache, repairOfflineCache } from '../../apps/web/src/offline/audit.js';
const scriptURL = 'http://localhost/after-the-agent/sw.js';
const reply = (id: string) => ({ type: 'offline-cache-audit', id, release_id: 'a'.repeat(64), checked: 4, matched: 4, missing: 0, altered: 0 });
test('offline audit rejects an unrelated worker before messaging it', async () => {
  let calls = 0;
  await expect(auditOfflineCache({ scriptURL: 'http://localhost/other.js', postMessage() { calls++; } }, scriptURL)).rejects.toThrow('does not belong');
  expect(calls).toBe(0);
});
test.each(['valid', 'wrong-id', 'bad-count'])('offline audit validates %s replies on its private message channel', async kind => {
  const worker = { scriptURL, postMessage(request: unknown, ports: Transferable[]) {
    const response = reply((request as { id: string }).id);
    if (kind === 'wrong-id') response.id = crypto.randomUUID(); if (kind === 'bad-count') response.matched = 3;
    (ports[0] as MessagePort).postMessage(response);
  } };
  if (kind === 'valid') expect((await auditOfflineCache(worker, scriptURL)).matched).toBe(4);
  else await expect(auditOfflineCache(worker, scriptURL)).rejects.toThrow('invalid response');
});
test('old or unresponsive offline workers report unknown at the bounded timeout', async () => {
  await expect(auditOfflineCache({ scriptURL, postMessage() {} }, scriptURL, undefined, 5)).rejects.toThrow('Completeness is unknown');
});
test('cancelled offline audit does not message or mutate a worker', async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  await expect(auditOfflineCache({ scriptURL, postMessage() { calls++; } }, scriptURL, controller.signal)).rejects.toThrow('cancelled'); expect(calls).toBe(0);
});
test.each(['wrong-id', 'false-complete'])('offline repair rejects a %s reply instead of claiming success', async kind => {
  const worker = { scriptURL, postMessage(request: unknown, ports: Transferable[]) {
    (ports[0] as MessagePort).postMessage({ type: 'offline-cache-repair', id: kind === 'wrong-id' ? crypto.randomUUID() : (request as { id: string }).id, status: 'complete', repaired: 1, reason: kind === 'false-complete' ? 'mismatch' : 'verified' });
  } };
  await expect(repairOfflineCache(worker, scriptURL)).rejects.toThrow('invalid response');
});
test('offline repair refuses unrelated workers and reports an unresponsive outcome as unknown', async () => {
  let calls = 0; const worker = { scriptURL: scriptURL + '.unrelated', postMessage() { calls++; } };
  await expect(repairOfflineCache(worker, scriptURL)).rejects.toThrow('does not belong'); expect(calls).toBe(0);
  await expect(repairOfflineCache({ ...worker, scriptURL }, scriptURL, 5)).rejects.toThrow('outcome is unknown');
});
