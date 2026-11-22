import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateReplays } from './incident-replay.mjs';

const generate = fileURLToPath(new URL('./incident-replay.mjs', import.meta.url));

test('the same agent trace can hide either a commit or a rollback', () => {
  const [committed, rolledBack] = generateReplays();
  assert.deepEqual(committed.trace, rolledBack.trace);
  assert.deepEqual(committed.call, rolledBack.call);
  assert.deepEqual(committed.before, [{ id: 'stock-041', amount: 2 }]);
  assert.deepEqual(rolledBack.before, []);
  assert.equal(committed.observation.status, 'committed');
  assert.equal(rolledBack.observation.status, 'rolled-back');
  assert.deepEqual(committed.afterRetry, [{ id: 'stock-041', amount: 2 }, { id: 'stock-041-retry', amount: 2 }]);
  assert.deepEqual(rolledBack.afterRetry, [{ id: 'stock-041-retry', amount: 2 }]);
});

test('missing provider access leaves a committed write unknown to the caller', () => {
  const [,, unavailable] = generateReplays();
  assert.deepEqual(unavailable.observation, { status: 'unavailable' });
  assert.equal(unavailable.before.length, 1);
  assert.equal(unavailable.afterRetry.length, 2);
});

test('a receipt for the original quantity does not cover a revised request', () => {
  const [,,, revised] = generateReplays();
  assert.equal(revised.observation.amount, 2);
  assert.equal(revised.call.currentQuantity, 3);
  assert.equal(revised.afterRetry.reduce((amount, row) => amount + row.amount, 0), 4);
});

test('scores require evidence and current authority before crediting a resolution', () => {
  const [committed, rolledBack, unavailable, revised] = generateReplays();
  assert.equal(committed.decisions.retry.checked[0], 'unsafe');
  assert.equal(committed.decisions.reconcile.unchecked[0], 'unsafe');
  assert.equal(committed.decisions.reconcile.checked[0], 'resolved');
  assert.equal(rolledBack.decisions.retry.unchecked[0], 'unsafe');
  assert.equal(rolledBack.decisions.retry.checked[0], 'resolved');
  assert.equal(unavailable.decisions.reconcile.checked[0], 'unsafe');
  assert.equal(unavailable.decisions.hold.checked[0], 'hold');
  assert.equal(revised.decisions.reconcile.checked[0], 'hold');
  assert.equal(revised.decisions.retry.checked[0], 'unsafe');
});

test('a missing receipt from a separate write cannot establish rollback', () => {
  const [,,,, gap] = generateReplays();
  assert.deepEqual(gap.observation, { status: 'missing-receipt' });
  assert.equal(gap.before.length, 1);
  assert.equal(gap.decisions.hold.checked[0], 'hold');
  assert.equal(gap.decisions.retry.checked[0], 'unsafe');
});

test('the JSON, portable HTML, and site build embed the same deterministic replays', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ata-replay-test-'));
  try {
    const run = (...args) => execFileSync(process.execPath, [generate, ...args], { encoding: 'utf8' });
    const json = run();
    const portable = join(directory, 'portable.html');
    const second = join(directory, 'second.html');
    const site = join(directory, 'site');
    run('--html', portable);
    run('--html', second);
    run('--site', site);
    const html = readFileSync(portable, 'utf8');
    const siteIndex = readFileSync(join(site, 'index.html'), 'utf8');
    const embedded = source => source.match(/id="replay-data">([^<]+)/u)[1];
    assert.equal(html, readFileSync(second, 'utf8'));
    assert.deepEqual(JSON.parse(embedded(html)), JSON.parse(json));
    assert.equal(embedded(html), embedded(siteIndex));
    assert.match(siteIndex, /<script src="\.\/player\.js" defer>/u);
    assert.doesNotMatch(siteIndex, /<script>/u);
  } finally {
    rmSync(directory, { recursive: true });
  }
});
