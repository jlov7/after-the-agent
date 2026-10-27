/* Versioned static assets only. Attempts and notebook records never enter this cache. */
/* global AbortController, setTimeout, clearTimeout */
const release = /* OFFLINE_RELEASE */ null;
const base = /* OFFLINE_BASE */ null;
const prefix = `after-the-agent:${base}:`;
const cacheName = prefix + release.release_id;
const assetUrls = new Set(release.assets.map(asset => new URL(base + asset.path, self.location.origin).href));
const manifestUrl = new URL(base + 'release-manifest.json', self.location.origin).href;
assetUrls.add(manifestUrl);

const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
async function verifiedBytes(response, expected) {
  if (!response.ok || response.type === 'opaque' || !response.body) return null;
  const reader = response.body.getReader(), chunks = []; let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength; if (length > expected.bytes) return null;
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  if (length !== expected.bytes) return null;
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return await digest(bytes) === expected.sha256 ? bytes : null;
}
async function matchesCachedBytes(response, expected) {
  return await verifiedBytes(response, expected) !== null;
}
async function auditCache(id) {
  const manifestBytes = new TextEncoder().encode(JSON.stringify(release));
  const assets = [...release.assets, { path: 'release-manifest.json', bytes: manifestBytes.byteLength, sha256: await digest(manifestBytes) }];
  const result = { type: 'offline-cache-audit', id, release_id: release.release_id, checked: assets.length, matched: 0, missing: 0, altered: 0 };
  for (const asset of assets) {
    // CacheStorage.match does not create a cache and never falls through to fetch.
    const response = await caches.match(new URL(base + asset.path, self.location.origin).href, { cacheName });
    if (!response) result.missing++;
    else if (await matchesCachedBytes(response, asset)) result.matched++;
    else result.altered++;
  }
  return result;
}

let repairing = false;
async function repairCache(event) {
  const id = event.data.id, port = event.ports[0];
  if (repairing) { port.postMessage({ type: 'offline-cache-repair', id, status: 'refused', repaired: 0, reason: 'busy' }); return; }
  repairing = true;
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30000);
  let repaired = 0, reason = 'unavailable';
  const onlyRequester = async () => {
    const clients = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).filter(client => new URL(client.url).pathname.startsWith(base));
    if (controller.signal.aborted) throw new Error('timeout');
    if (clients.length !== 1 || clients[0].id !== event.source.id) { reason = 'other_tabs'; throw new Error('Other tabs'); }
  };
  try {
    await onlyRequester();
    const cache = await caches.open(cacheName);
    const manifest = new TextEncoder().encode(JSON.stringify(release));
    for (const asset of [...release.assets, { path: 'release-manifest.json', bytes: manifest.byteLength, sha256: await digest(manifest) }]) {
      await onlyRequester();
      const url = new URL(base + asset.path, self.location.origin).href, retained = await cache.match(url);
      if (retained && await matchesCachedBytes(retained, asset)) continue;
      const response = asset.path === 'release-manifest.json' ? new Response(manifest, { headers: { 'Content-Type': 'application/json' } }) : await fetch(url, { cache: 'no-store', credentials: 'omit', signal: controller.signal });
      const bytes = await verifiedBytes(response, asset);
      if (!bytes) { reason = 'mismatch'; throw new Error('Release bytes unavailable'); }
      await onlyRequester();
      try { await cache.put(url, new Response(bytes, { status: 200, headers: response.headers })); } catch { reason = 'storage'; throw new Error('Cache write failed'); }
      repaired++;
    }
    const audit = await auditCache(id); await onlyRequester();
    port.postMessage({ type: 'offline-cache-repair', id, status: audit.matched === audit.checked ? 'complete' : 'incomplete', repaired, reason: audit.matched === audit.checked ? 'verified' : 'unavailable' });
  } catch {
    port.postMessage({ type: 'offline-cache-repair', id, status: 'incomplete', repaired, reason: controller.signal.aborted ? 'timeout' : reason });
  } finally { clearTimeout(timer); repairing = false; }
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    try {
      // Sequential reads bound memory and reject partial or stale server deployments.
      for (const asset of release.assets) {
        const url = new URL(base + asset.path, self.location.origin).href;
        const response = await fetch(url, { cache: 'no-store', credentials: 'omit' });
        const bytes = await verifiedBytes(response, asset);
        if (!bytes) throw new Error('Offline asset commitment mismatch');
        await cache.put(url, new Response(bytes, { status: 200, headers: response.headers }));
      }
      await cache.put(manifestUrl, new Response(JSON.stringify(release), { headers: { 'Content-Type': 'application/json' } }));
    } catch (error) { await caches.delete(cacheName); throw error; }
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    await self.clients.claim();
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (clients.filter(client => new URL(client.url).pathname.startsWith(base)).length <= 1) {
      const older = (await caches.keys()).filter(name => name.startsWith(prefix) && name !== cacheName);
      for (const name of older.slice(0, -1)) await caches.delete(name);
    }
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'repair-cache' && /^[a-f0-9-]{36}$/.test(event.data.id) && event.source && event.ports[0]) {
    const source = new URL(event.source.url);
    if (source.origin !== self.location.origin || !source.pathname.startsWith(base)) return;
    event.waitUntil(repairCache(event)); return;
  }
  if (event.data?.type === 'audit-cache' && /^[a-f0-9-]{36}$/.test(event.data.id) && event.source && event.ports[0]) {
    const source = new URL(event.source.url);
    if (source.origin !== self.location.origin || !source.pathname.startsWith(base)) return;
    event.waitUntil(auditCache(event.data.id).then(result => event.ports[0].postMessage(result)).catch(() => event.ports[0].postMessage({ type: 'offline-cache-audit', id: event.data.id, error: 'Cache could not be read' })));
    return;
  }
  if (event.data?.type !== 'activate-between-attempts' || !event.source || !event.ports[0]) return;
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const matching = clients.filter(client => new URL(client.url).pathname.startsWith(base));
    // A second open tab may own an active attempt. Leave the update waiting.
    if (matching.length !== 1 || matching[0].id !== event.source.id) { event.ports[0].postMessage({ ok: false }); return; }
    event.ports[0].postMessage({ ok: true });
    await self.skipWaiting();
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(base)) return;
  const navigation = event.request.mode === 'navigate';
  const target = navigation && !assetUrls.has(url.href) ? new URL(base + 'index.html', self.location.origin).href : url.href;
  event.respondWith((async () => {
    const current = await caches.open(cacheName);
    if (assetUrls.has(target)) {
      const cached = await current.match(target);
      if (cached) return cached;
    }
    // An already open page may still request a hashed chunk from the previous release.
    if (/\/assets\/[^/]+-[A-Za-z0-9_-]+\.(?:js|css)$/.test(url.pathname)) {
      for (const name of (await caches.keys()).filter(name => name.startsWith(prefix))) {
        const cached = await (await caches.open(name)).match(target);
        if (cached) return cached;
      }
    }
    return fetch(event.request);
  })());
});
