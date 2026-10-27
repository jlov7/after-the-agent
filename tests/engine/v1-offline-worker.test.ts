import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createHash } from 'node:crypto';
const hash = (raw: string) => createHash('sha256').update(raw).digest('hex');
async function worker(options: { wrong?: boolean; oversized?: boolean; quota?: boolean; otherTab?: boolean; tabDuringFetch?: boolean } = {}) {
  const origin = 'http://localhost', base = '/instrument/', contents = new Map([['index.html', '<html>Instrument</html>'], ['assets/a.js', 'valid javascript'], ['assets/b.css', 'valid css']]);
  const release = { schema_version: '1.0', release_id: 'a'.repeat(64), assets: [...contents].map(([path, raw]) => ({ path, bytes: Buffer.byteLength(raw), sha256: hash(raw) })) };
  const retained = new Map([...contents].map(([path, raw]) => [origin + base + path, raw]));
  retained.set(origin + base + 'release-manifest.json', JSON.stringify(release));
  retained.delete(origin + base + 'assets/a.js'); retained.set(origin + base + 'assets/b.css', 'altered css');
  const fetched: string[] = [], handlers = new Map<string, (event: unknown) => void>(), messages: Record<string, unknown>[] = [];
  let other = options.otherTab;
  const cache = {
    match: async (url: string) => retained.has(url) ? new Response(retained.get(url)) : undefined,
    put: async (url: string, response: Response) => { if (options.quota) throw new Error('QuotaExceededError'); retained.set(url, await response.text()); },
  };
  runInNewContext(readFileSync('apps/web/service-worker.js', 'utf8').replace('/* OFFLINE_RELEASE */ null', JSON.stringify(release)).replace('/* OFFLINE_BASE */ null', JSON.stringify(base)), {
    self: { location: { origin }, addEventListener: (name: string, run: (event: unknown) => void) => handlers.set(name, run), clients: { matchAll: async () => [{ id: 'requester', url: origin + base }, ...(other ? [{ id: 'other', url: origin + base }] : [])] } },
    caches: { open: async () => cache, match: (url: string) => cache.match(url) }, crypto, URL, Response, TextEncoder, Uint8Array, AbortController, setTimeout, clearTimeout,
    fetch: async (url: string, init: RequestInit) => { expect(init.cache).toBe('no-store'); expect(init.credentials).toBe('omit'); fetched.push(url); if (options.tabDuringFetch) other = true; return new Response(options.oversized ? 'x'.repeat(1024) : options.wrong ? 'wrong' : contents.get(url.slice((origin + base).length))); },
  });
  let work: Promise<void> | undefined;
  handlers.get('message')!({ data: { type: 'repair-cache', id: crypto.randomUUID() }, source: { id: 'requester', url: origin + base }, ports: [{ postMessage: (message: Record<string, unknown>) => messages.push(message) }], waitUntil: (value: Promise<void>) => { work = value; } });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Repair stayed pending after oversized input')), 1000); })]); }
  finally { clearTimeout(timer); }
  return { retained, fetched, response: messages[0]!, contents, prefix: origin + base };
}
test('actual worker repairs only missing or altered files and audits the complete release', async () => {
  const result = await worker(); expect(result.response).toMatchObject({ status: 'complete', repaired: 2, reason: 'verified' });
  expect(result.fetched).toEqual([result.prefix + 'assets/a.js', result.prefix + 'assets/b.css']);
  for (const [path, raw] of result.contents) expect(result.retained.get(result.prefix + path)).toBe(raw);
});
test.each([{ wrong: true, reason: 'mismatch' }, { quota: true, reason: 'storage' }])('failed replacement preserves matching files: $reason', async options => {
  const result = await worker(options); expect(result.response).toMatchObject({ status: 'incomplete', repaired: 0, reason: options.reason });
  expect(result.retained.get(result.prefix + 'index.html')).toBe(result.contents.get('index.html'));
  expect(result.retained.has(result.prefix + 'assets/a.js')).toBe(false); expect(result.retained.get(result.prefix + 'assets/b.css')).toBe('altered css');
});
test('an oversized replacement terminates without a cloned-response cancellation deadlock', async () => {
  const result = await worker({ oversized: true }); expect(result.response).toMatchObject({ status: 'incomplete', repaired: 0, reason: 'mismatch' });
  expect(result.retained.has(result.prefix + 'assets/a.js')).toBe(false);
});
test.each([{ otherTab: true }, { tabDuringFetch: true }])('another application tab prevents further cache writes: %j', async options => {
  const result = await worker(options); expect(result.response).toMatchObject({ status: 'incomplete', repaired: 0, reason: 'other_tabs' });
  expect(result.retained.has(result.prefix + 'assets/a.js')).toBe(false);
  if (options.otherTab) expect(result.fetched).toEqual([]);
});
