/* global document, window, performance, MutationObserver, requestAnimationFrame, setTimeout */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpus } from 'node:os';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { measureRepairInBrowser } from './browser-measurement.mjs';

const args = process.argv.slice(2);
const option = name => { const at = args.indexOf(name); return at < 0 ? null : args[at + 1]; };
const baseline = args.includes('--baseline');
const output = option('--output') ?? 'evidence/quality/benchmark.json';
const suppliedUrl = option('--url');
const url = suppliedUrl ?? 'http://127.0.0.1:4175/after-the-agent/';
const address = new URL(url);
if (address.hostname !== '127.0.0.1' || address.protocol !== 'http:' || address.username || address.password) throw new Error('Benchmark accepts only a local preview.');
const rounds = 3;
const samplesPerRound = 5;
const scenarios = ['stale-queue', 'duplicate-clock', 'cached-gate'];
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
const summarize = values => ({ samples: values.length, median_ms: percentile(values, .5), p95_ms: percentile(values, .95), max_ms: Math.max(...values) });
const roundMs = value => Math.round(value * 100) / 100;
const gitCommit = await new Promise(resolveCommit => {
  const child = spawn('git', ['-c', 'core.fsmonitor=false', 'rev-parse', 'HEAD']);
  let value = ''; child.stdout.on('data', bytes => value += bytes);
  child.on('close', code => resolveCommit(code === 0 ? value.trim() : null));
});
let server;
let browser;
const started = new Date().toISOString();
const checks = [];
const errors = [];
const externalRequests = [];
try {
  if (!suppliedUrl) {
    server = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', '4175', '--strictPort'], { cwd: resolve('apps/web'), env: { ...process.env, BASE: '/after-the-agent/' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let failure = '';
    server.stderr.on('data', bytes => failure += bytes);
    for (let attempt = 0; attempt < 100; attempt++) {
      if (server.exitCode !== null) throw new Error(`Benchmark preview exited: ${failure}`);
      try { if ((await fetch(url)).ok) break; } catch { /* Local server is starting. */ }
      if (attempt === 99) throw new Error('Benchmark preview did not start within ten seconds.');
      await new Promise(done => setTimeout(done, 100));
    }
  }
  browser = await chromium.launch({ headless: true });
  for (let round = 1; round <= rounds; round++) {
    for (const scenario of scenarios) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => {
        const requestUrl = route.request().url();
        if (requestUrl.startsWith(address.origin + '/') || requestUrl.startsWith('blob:')) return route.continue();
        externalRequests.push(requestUrl); return route.abort();
      });
      await page.addInitScript(() => {
        const observer = new MutationObserver(() => {
          const start = [...document.querySelectorAll('button')].find(button => button.textContent.includes('Take over the lights') && !button.disabled);
          if (start) { window.__benchmarkReady = performance.now(); observer.disconnect(); }
        });
        observer.observe(document, { subtree: true, childList: true, attributes: true });
      });
      await page.goto(url);
      await page.getByRole('button', { name: 'Take over the lights' }).click();
      await page.getByRole('button', { name: 'Begin takeover' }).click();
      if (scenario !== 'stale-queue') {
        await page.getByRole('button', { name: 'Check repair', exact: true }).click();
        await page.getByRole('heading', { name: 'Repair did not hold' }).waitFor();
        await page.getByLabel('Try another fault').selectOption(scenario);
        const startFault = page.getByRole('button', { name: /Start selected fault|Start this fault/ });
        if (await startFault.count()) await startFault.click();
        else if (await page.getByRole('button', { name: 'New attempt', exact: true }).isVisible()) await page.getByRole('button', { name: 'New attempt', exact: true }).click();
        await page.getByRole('button', { name: 'Begin takeover' }).click();
      }
      const readyMs = await page.evaluate(() => window.__benchmarkReady);
      const interactions = [];
      const scoring = [];
      for (let sample = 0; sample < samplesPerRound; sample++) {
        if (sample) {
          await page.getByRole('button', { name: 'New attempt', exact: true }).click();
          await page.getByRole('button', { name: 'Begin takeover' }).click();
        }
        if (scenario === 'stale-queue') await page.getByLabel('Delivery guard').check();
        if (scenario === 'duplicate-clock') {
          await page.getByLabel('Standby clock', { exact: true }).uncheck();
          await page.getByLabel('Select shadow.4.left').check();
          await page.getByRole('button', { name: 'Drop selected', exact: true }).click();
        }
        if (scenario === 'cached-gate') await page.getByRole('radio', { name: 'Live', exact: true }).check();
        interactions.push(await page.evaluate(() => new Promise(done => {
          const input = document.querySelector('input[aria-label="Primary clock"]');
          const before = input.checked;
          const start = performance.now();
          input.click();
          requestAnimationFrame(() => requestAnimationFrame(() => done({ elapsed_ms: performance.now() - start, changed: input.checked !== before })));
        })));
        await page.getByLabel('Primary clock', { exact: true }).check();
        scoring.push(await page.evaluate(measureRepairInBrowser));
      }
      checks.push({ round, scenario, recipe: scenario === 'stale-queue' ? 'guard enabled, inherited stale job retained' : scenario === 'duplicate-clock' ? 'standby disabled, its inherited duplicate selected and dropped' : 'gate switched to live; inherited state retained', meaningful_ready_ms: roundMs(readyMs), interaction_samples: interactions.map(item => ({ ...item, elapsed_ms: roundMs(item.elapsed_ms) })), scoring_samples: scoring.map(item => ({ ...item, elapsed_ms: roundMs(item.elapsed_ms) })), interaction: summarize(interactions.map(item => item.elapsed_ms)), scoring: summarize(scoring.map(item => item.elapsed_ms)) });
      await page.close();
    }
  }
  const assets = (await import('node:fs')).readdirSync('apps/web/dist/assets').filter(name => name.endsWith('.js')).map(name => { const bytes = readFileSync(`apps/web/dist/assets/${name}`); return { name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }; });
  const measurementScripts = ['scripts/benchmark-product.mjs', 'scripts/browser-measurement.mjs'].map(path => ({ path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') }));
  const interaction = summarize(checks.flatMap(item => item.interaction_samples.map(sample => sample.elapsed_ms)));
  const scoring = summarize(checks.flatMap(item => item.scoring_samples.map(sample => sample.elapsed_ms)));
  const thresholds = baseline ? null : JSON.parse(readFileSync('fixtures/performance-targets.json', 'utf8'));
  const requests = checks.flatMap(item => item.scoring_samples.map(sample => sample.request_id));
  const functional = errors.length === 0 && externalRequests.length === 0 && new Set(requests).size === 45 && checks.every(item => item.interaction_samples.every(sample => sample.changed) && item.scoring_samples.every(sample => sample.verdict === 'Repair held' && sample.twelve_cases && sample.worker_status === 'pass' && typeof sample.request_id === 'string' && /^[a-f0-9]{64}$/.test(sample.candidate_sha256)));
  const passed = functional && (!thresholds || interaction.p95_ms <= thresholds.interaction_p95_ms && scoring.p95_ms <= thresholds.twelve_case_scoring_p95_ms);
  const report = { schema_version: '1.0', status: passed ? 'passed' : 'failed', historical_baseline: baseline, started_at: started, finished_at: new Date().toISOString(), source_commit: gitCommit, environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model, logical_cpus: cpus().length, browser: await browser.version(), playwright: JSON.parse(readFileSync('node_modules/playwright/package.json','utf8')).version, viewport: { width: 1440, height: 900 }, cpu_throttling: 'none', concurrency: 1 }, method: 'Browser performance.now. Toggle event to two rendering frames. Check event to matching new worker ID/candidate/twelve cases and rendered verdict, including cold worker in each round. Three rounds, five samples per named scenario per round. Local preview with external requests blocked.', checks, summary: { interaction, scoring }, thresholds, assets, measurement_scripts: measurementScripts, page_errors: errors, external_requests: externalRequests, artifact_sha256: createHash('sha256').update(JSON.stringify(checks)).digest('hex'), claim_ceiling: 'Local browser timing on the recorded machine, not user completion time or universal device performance.' };
  mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2));
  process.stdout.write(JSON.stringify({ event: 'product_benchmark', output, status: report.status, summary: report.summary }) + '\n');
  if (!passed) process.exitCode = 1;
} finally {
  await browser?.close();
  if (server && server.exitCode === null) { server.kill('SIGTERM'); await new Promise(done => server.once('close', done)); }
}
