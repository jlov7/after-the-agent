import { openEvidenceExports } from './evidence-controls.js';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evaluateCandidate, runReference } from '../../packages/runner/src/evaluate.js';
import { createEngine, dispatch, setEnginePhase, snapshot, type CompactAttemptExport } from '../../packages/engine/src/index.js';
import { sha256Json } from '../../packages/contracts/src/index.js';
const savedAttempt = async (page: import('@playwright/test').Page) => {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save progress to a file', exact: true }).click();
  const value = JSON.parse(readFileSync((await (await pending).path())!, 'utf8')) as { session: import('../../packages/engine/src/session.js').SavedSession };
  await expect.poll(() => page.evaluate(id => localStorage.getItem(`after-the-agent.saved.v2.${id}`), value.session.attempt_id)).toBe(JSON.stringify(value.session));
  return value.session;
};
const reconstruct = (value: CompactAttemptExport) => {
  const engine = createEngine(value.setup);
  for (const command of value.commands) { setEnginePhase(engine, command.actor.phase); const result = dispatch(engine, command.request, command.actor); expect(sha256Json(result)).toBe(command.result_sha256); expect(snapshot(engine).tick).toBe(command.tick); }
  if (value.candidate) expect(sha256Json(snapshot(engine))).toBe(value.candidate.candidate_sha256);
  return { plant_sha256: sha256Json(snapshot(engine)), commands: value.commands.length };
};
const evidence = resolve(process.env.UI_EVIDENCE_DIR || 'evidence/ui-browser');
const screenshots = resolve(evidence, 'screenshots');
const receipts: unknown[] = [];
const base = process.env.BASE || '/';
const takeover = async (page: import('@playwright/test').Page) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Take over the lights' }).click();
  await page.getByRole('button', { name: 'Begin takeover' }).click();
};
const exported = async (page: import('@playwright/test').Page, name: string) => {
  const download = page.waitForEvent('download');
  await openEvidenceExports(page); await page.getByRole('button', { name: 'Download attempt evidence' }).click();
  const file = await download;
  const path = resolve(evidence, `${name}.json`); await file.saveAs(path);
  return JSON.parse(readFileSync(path,'utf8')) as CompactAttemptExport;
};
test.beforeAll(() => { mkdirSync(screenshots,{recursive:true}); });
// Retain coverage of the authored fallback. The genuine default has its own unmocked suite.
test.beforeEach(async ({ page }) => { await page.route('**/recordings/manifest.json', route => route.fulfill({ json: { schema_version: '1.0', selected: null } })); });
test.afterAll(() => { writeFileSync(resolve(process.env.UI_REPORT_PATH || 'evidence/ui-verification.json'),JSON.stringify({ schema_version:'1.0', base, checks:receipts, screenshots: ['desktop.png','narrow.png','reduced-motion.png','zoom-200.png','long-recording-label.png','curated-playback.png'].map(name=>`evidence/ui-browser/screenshots/${name}`), browser_to_python:'evidence/ui-browser/browser-to-python.json', claim_ceiling:'Synthetic software verification only. No human observations. Research disabled.' },null,2)); });

test('stale-queue repair preserves tick-five work and browser exports agree with Python reconstruction', async ({ page }) => {
  const external: string[]=[];
  const localOrigin = new URL(test.info().project.use.baseURL!).origin;
  page.on('request',request => { if (!request.url().startsWith(localOrigin) && !request.url().startsWith('blob:')) external.push(request.url()); });
  await page.goto('./');
  await expect(page.getByRole('heading',{name:'A working system. An unfamiliar fault. Your move.'})).toBeVisible();
  await page.getByRole('button',{name:'Take over the lights'}).click();
  await page.getByRole('button',{name:'Begin takeover'}).click();
  await expect(page.getByText('Tick 5 / Paused',{exact:true})).toBeVisible();
  await expect(page.getByText('primary.4.left',{exact:true})).toBeVisible();
  await expect(page.getByLabel('Left pulse count')).toHaveText('0');
  await page.screenshot({path:resolve(screenshots,'desktop.png'),fullPage:true});
  await page.getByLabel('Delivery guard').check();
  await page.getByRole('button',{name:'Check repair',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Repair held'})).toBeVisible();
  await expect(page.getByText('All 12 future scenarios passed',{exact:true})).toBeVisible();
  const valid = await exported(page,'valid-browser-export');
  expect(valid.candidate!.capture_tick).toBe(5); expect(valid.candidate!.plant.queue[0]!.id).toBe('primary.4.left');
  const validReplay = reconstruct(valid);
  const reconstructedValid = await evaluateCandidate(valid.candidate!,valid.corpus!);
  expect(reconstructedValid).toEqual(valid.evaluation);
  const observedValid = runReference(valid.corpus!.cases,valid.evaluation!.observations); expect(observedValid.exit_code).toBe(0);
  await page.context().setOffline(true);
  await page.getByRole('button',{name:'New attempt',exact:true}).click(); await page.getByRole('button',{name:'Begin takeover'}).click();
  await page.getByRole('button',{name:'Check repair',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Repair did not hold'})).toBeVisible();
  const broken = await exported(page,'broken-browser-export');
  const brokenReplay = reconstruct(broken);
  const reconstructedBroken = await evaluateCandidate(broken.candidate!,broken.corpus!);
  expect(reconstructedBroken).toEqual(broken.evaluation);
  const observedBroken=runReference(broken.corpus!.cases,broken.evaluation!.observations); expect(observedBroken.exit_code).toBe(1);
  expect(broken.evaluation!.cases.some(item=>item.extra.length>0)).toBe(true);
  expect(external).toEqual([]); await page.context().setOffline(false);
  const inventoryResponse = await page.request.get(`${base}worker-dependency-inventory.json`); const inventory = await inventoryResponse.json(); expect(inventory.forbidden).toEqual([]); expect(inventory.modules.some((id:string)=>id.includes('evaluate-browser'))).toBe(true);
  const mainInventory = await (await page.request.get(`${base}dependency-inventory.json`)).json(); expect(mainInventory.forbidden).toEqual([]);
  for (const path of ['docs/product-spec.txt','docs/engine-and-contracts.txt','docs/research-protocol.txt','docs/source-map.html','source/App.tsx.txt','source/engine.ts.txt','source/session.ts.txt','source/curated.ts.txt']) { const response = await page.request.get(`${base}${path}`); expect(response.ok()).toBe(true); expect((await response.text()).length).toBeGreaterThan(100); }
  writeFileSync(resolve(evidence,'browser-to-python.json'),JSON.stringify({valid:{replay:validReplay,browser:valid.evaluation,reconstructed:reconstructedValid,oracle:observedValid},broken:{replay:brokenReplay,browser:broken.evaluation,reconstructed:reconstructedBroken,oracle:observedBroken},external_requests:external,offline_worker:true,base,dependency_inventory:inventory,main_dependency_inventory:mainInventory},null,2));
  receipts.push({name:'actual browser worker vs independent Python',valid:reconstructedValid.status,broken:reconstructedBroken.status,external_requests:external,offline_worker:true,base});
});

test('keyboard repair and accessible narrow reduced-motion layout', async ({page}) => {
  let releaseSource!: () => void;
  const sourcePending = new Promise<void>(resolve => { releaseSource = resolve; });
  await page.route('**/recordings/manifest.json', async route => { await sourcePending; await route.fulfill({ json: { schema_version: '1.0', selected: null } }); });
  await page.emulateMedia({reducedMotion:'reduce'}); await page.setViewportSize({width:390,height:844});
  await page.goto('./');
  const takeoverButton = page.getByRole('button', { name: 'Take over the lights' });
  await expect(takeoverButton).toBeDisabled(); releaseSource();
  // Native focus does not wait for enabled state. Exercise the real loading boundary before typing.
  await expect(takeoverButton).toBeEnabled(); await takeoverButton.focus(); await page.keyboard.press('Enter');
  await page.getByRole('button',{name:'Begin takeover'}).focus(); await page.keyboard.press('Enter');
  await page.getByLabel('Delivery guard').focus(); await page.keyboard.press('Space');
  await expect(page.getByLabel('Delivery guard')).toBeChecked();
  const result=await new AxeBuilder({page}).analyze(); expect(result.violations).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({path:resolve(screenshots,'narrow.png'),fullPage:true});
  await page.getByRole('button',{name:'Check repair',exact:true}).focus(); await page.keyboard.press('Enter'); await expect(page.getByRole('heading',{name:'Repair held'})).toBeVisible();
  await page.setViewportSize({width:1440,height:900}); await page.screenshot({path:resolve(screenshots,'reduced-motion.png'),fullPage:true});
  await page.evaluate(()=>{document.documentElement.style.zoom='2';}); await page.screenshot({path:resolve(screenshots,'zoom-200.png'),fullPage:true}); expect(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  for (const button of await page.getByRole('button').all()) { const box=await button.boundingBox(); if(box) { expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x+box.width).toBeLessThanOrEqual(1440); } }
  receipts.push({name:'keyboard, axe, narrow, reduced motion, 200 percent zoom',violations:result.violations.length});
});

test('pause, hidden-tab and reload retain the original wall deadline', async ({page}) => {
  await page.clock.install(); await takeover(page);
  await page.getByRole('button',{name:'Run',exact:true}).click();
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
  await expect(page.getByText('Tick 5 / Paused',{exact:true})).toBeVisible();
  await page.clock.fastForward(200000); await page.reload();
  await page.getByRole('button',{name:'Resume saved attempt'}).click();
  await page.clock.fastForward(100001);
  await expect(page.getByRole('heading',{name:'Recovery time ended.'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Check repair',exact:true})).toBeDisabled();
  receipts.push({name:'pause/hidden/reload deadline',phase:'timed_out'});
});

test('reset records abandonment and cannot resurrect success; corrupt resume is rejected', async ({page}) => {
  await takeover(page); await page.getByLabel('Delivery guard').check(); await page.getByRole('button',{name:'Check repair',exact:true}).click(); await expect(page.getByRole('heading',{name:'Repair held'})).toBeVisible();
  const old=await exported(page,'before-reset');
  await page.getByRole('button',{name:'New attempt',exact:true}).click(); await page.getByRole('button',{name:'Begin takeover'}).click();
  const fresh=await exported(page,'after-reset') as CompactAttemptExport & {attempt_id:string;previous_attempts:{attempt_id:string;disposition:string}[]};
  expect(fresh.evaluation).toBeNull(); expect(fresh.attempt_id).not.toBe((old as typeof fresh).attempt_id); expect(fresh.previous_attempts).toContainEqual({attempt_id:(old as typeof fresh).attempt_id,disposition:'abandoned_reset'});
  await page.addInitScript(()=>localStorage.setItem('after-the-agent.saved.v1',JSON.stringify({schema_version:'forged',phase:'submitted',evaluation:{status:'pass'}}))); await page.reload(); await page.getByLabel('Saved attempt', { exact: true }).selectOption('legacy'); await page.getByRole('button',{name:'Resume saved attempt'}).click(); await expect(page.locator('.notice')).toContainText('Cannot resume');
  receipts.push({name:'reset and corrupt resume',new_attempt:true,forged_success_rejected:true});
});

test('malformed recording and forged live labels never enable research or genuine provenance', async ({page}) => {
  await page.goto('./?researchEnabled=true&category=live_model&model=genuine');
  await expect(page.getByText('Scripted preview',{exact:true})).toBeVisible();
  for (const raw of ['{"schema_version":"9"}', '{"schema_version":"1.0","schema_version":"1.0"}', JSON.stringify({schema_version:'1.0',manifest:{category:'live_model',requested_model:'<script>window.forged=true</script>'}})]) {
    await page.getByLabel('Import recording').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from(raw)}); await expect(page.getByText(/^Recording rejected:/)).toBeVisible();
  }
  await page.getByLabel('Import recording').setInputFiles({name:'huge.json',mimeType:'application/json',buffer:Buffer.alloc(2_000_001,32)}); await expect(page.getByText('Recording rejected: file exceeds 2 MB.')).toBeVisible();
  await expect(page.getByText('Scripted preview',{exact:true})).toBeVisible();
  receipts.push({name:'import bounds/provenance/research query',research_enabled:false});
});

test('a failed worker never renders completed success', async ({page}) => {
  await page.route(/evaluation\.worker.*\.js/,route=>route.abort());
  await takeover(page); await page.getByLabel('Delivery guard').check(); await page.getByRole('button',{name:'Check repair',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Check incomplete'})).toBeVisible(); await expect(page.getByRole('heading',{name:'Repair held'})).toHaveCount(0);
  const value=await exported(page,'worker-error'); expect(value.evaluation!.status).toBe('worker_error');
  receipts.push({name:'worker failure',status:value.evaluation!.status});
});

test('duplicate counts stay visible and either single-clock repair is accepted; cached gate needs live state', async ({page}) => {
  await takeover(page); await page.getByRole('button',{name:'Check repair',exact:true}).click(); await expect(page.getByRole('heading',{name:'Repair did not hold'})).toBeVisible();
  await page.getByLabel('Try another fault').selectOption('duplicate-clock'); await page.getByRole('button',{name:'New attempt',exact:true}).click(); await page.getByRole('button',{name:'Begin takeover'}).click();
  await expect(page.getByText('primary.4.left',{exact:true})).toBeVisible(); await expect(page.getByText('shadow.4.left',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Step',exact:true}).click(); await expect(page.getByLabel('Left pulse count')).toHaveText('2');
  await page.getByRole('button',{name:'Check repair',exact:true}).click(); await expect(page.getByRole('heading',{name:'Repair did not hold'})).toBeVisible();
  await page.getByRole('button',{name:'New attempt',exact:true}).click(); await page.getByRole('button',{name:'Begin takeover'}).click();
  await page.getByLabel('Primary clock',{exact:true}).uncheck(); await page.getByLabel('Select primary.4.left').check(); await page.getByRole('button',{name:'Drop selected'}).click();
  await expect(page.getByText('shadow.4.left',{exact:true})).toBeVisible(); await page.getByRole('button',{name:'Check repair',exact:true}).click(); await expect(page.getByRole('heading',{name:'Repair held'})).toBeVisible();
  await page.getByLabel('Try another fault').selectOption('cached-gate'); await page.getByRole('button',{name:'New attempt',exact:true}).click(); await page.getByRole('button',{name:'Begin takeover'}).click();
  await expect(page.getByText('Cached: active, version 1',{exact:false})).toBeVisible(); await page.getByRole('radio',{name:'Live',exact:true}).check(); await page.getByRole('button',{name:'Check repair',exact:true}).click(); await expect(page.getByRole('heading',{name:'Repair held'})).toBeVisible();
  receipts.push({name:'duplicate visible counts, standby-only repair, cached-gate repair',duplicate_count:2});
});

test('both synthetic rehearsal arms consume identical facts, actions, exposure timing and handover', async ({page}) => {
  await page.clock.install({time:new Date('2026-10-11T10:00:00Z')}); await page.clock.pauseAt(new Date('2026-10-11T10:00:01Z')); const arms: Record<string,unknown>[]=[];
  for (const arm of ['Observation','Pre-commitment']) {
    await page.goto('./'); await page.getByRole('button',{name:'Open local rehearsal'}).click(); await page.getByRole('radio',{name:arm,exact:true}).check(); await page.getByRole('button',{name:'Begin synthetic rehearsal'}).click();
    for (let index=0;index<3;index++) {
      if(arm==='Pre-commitment') await page.getByRole('radio',{name:index===0?'Unsure':'Leave the system unchanged',exact:true}).check();
      await page.clock.fastForward(25000); await expect(page.getByRole('heading',{name:/^Executed:/})).toBeVisible(); await page.clock.fastForward(20000);
    }
    await expect(page.getByText('Tick 5 / Paused',{exact:true})).toBeVisible();
    arms.push(await page.evaluate(()=>JSON.parse(localStorage.getItem('after-the-agent.rehearsal-evidence.v1')!)));
    await page.getByLabel('Delivery guard').check(); await page.getByRole('button',{name:'Check repair',exact:true}).click(); await expect(page.getByRole('heading',{name:'Repair held'})).toBeVisible();
    await expect(page.getByRole('button',{name:'Check repair',exact:true})).toBeDisabled();
    const result=await exported(page,`rehearsal-${arm.toLowerCase()}`); expect(result.researchEligible).toBe(false); expect(result.mode).toBe('local_rehearsal');
    await page.reload(); await page.getByRole('button',{name:'Resume saved attempt'}).click(); await expect(page.getByRole('heading',{name:'Repair held'})).toBeVisible(); const resumed=await exported(page,`rehearsal-${arm.toLowerCase()}-resumed`) as CompactAttemptExport & {rehearsal_evidence:unknown}; expect(resumed.rehearsal_evidence).toEqual((result as typeof resumed).rehearsal_evidence);
  }
  expect(arms[0]!.factual_payload_sha256).toBe(arms[1]!.factual_payload_sha256); expect(arms[0]!.handover_sha256).toBe(arms[1]!.handover_sha256); expect(arms[0]!.commands).toEqual(arms[1]!.commands);
  for(const arm of arms) expect((arm.timings as {actual_elapsed_ms:number}[]).map(item=>item.actual_elapsed_ms)).toEqual([25000,70000,115000]);
  writeFileSync(resolve(evidence,'study-equivalence.json'),JSON.stringify({arms,synthetic:true,researchEligible:false},null,2)); receipts.push({name:'synthetic matched arms',factual_payload_sha256:arms[0]!.factual_payload_sha256,handover_sha256:arms[0]!.handover_sha256,windows:[25000,70000,115000]});
});

for (const failure of [{arm:'Observation',operation:'setItem'}, {arm:'Pre-commitment',operation:'setItem'}, {arm:'Observation',operation:'removeItem'}] as const) {
  test(`${failure.arm}: rehearsal survives ${failure.operation} storage failure at handover`, async ({page}) => {
    const errors: string[]=[]; page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(operation=>{ Storage.prototype[operation]=()=>{throw new DOMException('Storage unavailable','QuotaExceededError');}; },failure.operation);
    await page.clock.install({time:new Date('2026-10-11T10:00:00Z')}); await page.clock.pauseAt(new Date('2026-10-11T10:00:01Z'));
    await page.goto('./'); await page.getByRole('button',{name:'Open local rehearsal'}).click(); await page.getByRole('radio',{name:failure.arm,exact:true}).check(); await page.getByRole('button',{name:'Begin synthetic rehearsal'}).click();
    await page.clock.fastForward(135000);
    await expect(page.getByText('Tick 5 / Paused',{exact:true})).toBeVisible();
    await expect(page.getByText('Local rehearsal saving and resume are unavailable. Download retains the synthetic exposure receipt.',{exact:true})).toBeVisible();
    await expect(page.getByText('primary.4.left',{exact:true})).toBeVisible();
    await page.getByLabel('Delivery guard').check(); await page.getByRole('button',{name:'Check repair',exact:true}).click(); await expect(page.getByRole('heading',{name:'Repair held'})).toBeVisible();
    await expect(page.getByText('All 12 future scenarios passed',{exact:true})).toBeVisible();
    await expect(page.getByText('Local rehearsal saving and resume are unavailable. Download retains the synthetic exposure receipt.',{exact:true})).toBeVisible();
    const result=await exported(page,`rehearsal-storage-${failure.arm.toLowerCase()}-${failure.operation}`) as CompactAttemptExport & {rehearsal_evidence:{synthetic:boolean;researchEligible:boolean;condition:string;commands:unknown[];scheduled_handover_at:number}};
    expect(result.mode).toBe('local_rehearsal'); expect(result.researchEligible).toBe(false); expect(result.evaluation!.status).toBe('pass');
    expect(result.rehearsal_evidence.synthetic).toBe(true); expect(result.rehearsal_evidence.researchEligible).toBe(false); expect(result.rehearsal_evidence.condition).toBe(failure.arm==='Observation'?'observation':'precommitment'); expect(result.rehearsal_evidence.commands).toHaveLength(3);
    expect(result.handover_at_ms).toBe(result.rehearsal_evidence.scheduled_handover_at); expect(result.deadline_at_ms! - result.handover_at_ms!).toBe(300000); reconstruct(result); expect(errors).toEqual([]);
    receipts.push({name:`${failure.arm} rehearsal ${failure.operation} storage failure`,handover:true,repair:result.evaluation!.status,in_memory_receipt:true,researchEligible:false,page_errors:errors});
  });
}

test('duplicate submission and cancellation cannot produce a completed success', async ({page}) => {
  let release: (()=>void)|undefined;
  await page.route(/evaluation\.worker.*\.js/,async route=>{await new Promise<void>(resolve=>{release=resolve;}); await route.abort();});
  await takeover(page); await page.getByLabel('Delivery guard').check();
  await page.getByRole('button',{name:'Check repair',exact:true}).click();
  await expect(page.getByRole('button',{name:'Checking…'})).toBeDisabled();
  await page.getByRole('button',{name:'Cancel check'}).click(); release?.();
  await expect(page.getByRole('heading',{name:'Check incomplete'})).toBeVisible();
  const value=await exported(page,'cancelled-browser-export'); expect(value.evaluation!.status).toBe('cancelled');
  await expect(page.getByRole('heading',{name:'Repair held'})).toHaveCount(0);
  receipts.push({name:'submission lock/cancel',status:value.evaluation!.status});
});

test('a long valid authored recording label is visible without changing provenance', async ({page}) => {
  const {authoredRecording}=await import('../replay/fixture.js');
  const original=authoredRecording(); const recording={...original,manifest:{...original.manifest,run_id:'authored.'.padEnd(64,'a')}};
  await page.setViewportSize({width:390,height:844}); await page.goto('./');
  await page.getByLabel('Import recording').setInputFiles({name:'authored-long.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(recording))});
  await expect(page.getByText(new RegExp(`Imported fixture recording ${recording.manifest.run_id}: replay verified`))).toBeVisible();
  await expect(page.getByText('Scripted preview',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:resolve(screenshots,'long-recording-label.png'),fullPage:true});
  receipts.push({name:'long authored recording label',category:'fixture',provenance:'Scripted preview'});
});

test('a near-full recovery run fits local storage and refresh retains state and deadline', async ({page}) => {
  test.setTimeout(60000); await page.clock.install(); await takeover(page);
  await page.getByRole('button',{name:'Run',exact:true}).click();
  await page.clock.runFor(262500);
  await page.getByRole('button',{name:'Pause',exact:true}).click();
  const data=await savedAttempt(page), before={bytes:Buffer.byteLength(JSON.stringify(data)),data};
  expect(before.data.schema_version).toBe('1.2'); expect(before.data.commands.length).toBeGreaterThan(500); expect(before.bytes).toBeLessThan(5_000_000);
  const tick=await page.getByText(/^Tick \d+ \/ Paused$/).innerText();
  await page.reload(); await page.getByRole('button',{name:'Resume saved attempt'}).click(); await expect(page.getByText(tick,{exact:true})).toBeVisible();
  const after=await savedAttempt(page); expect(after.attempt_id).toBe(before.data.attempt_id); expect(after.deadline_at_ms).toBe(before.data.deadline_at_ms);
  const value=await exported(page,'long-run-compact'); expect(value.schema_version).toBe('1.2');
  await page.clock.fastForward(37501); await expect(page.getByRole('heading',{name:'Recovery time ended.'})).toBeVisible();
  receipts.push({name:'long run storage/refresh deadline',saved_bytes:before.bytes,commands:before.data.commands.length,schema_version:'1.2'});
});

test('successful resume recomputes two saved submissions without cancelling the replacement worker', async ({page}) => {
  await takeover(page);
  await page.getByRole('button',{name:'Check repair',exact:true}).click(); await expect(page.getByRole('heading',{name:'Repair did not hold'})).toBeVisible();
  await page.getByLabel('Delivery guard').check(); await page.getByRole('button',{name:'Check repair',exact:true}).click(); await expect(page.getByRole('heading',{name:'Repair held'})).toBeVisible();
  const original=await exported(page,'two-submissions-before-resume'); expect(original.submissions).toHaveLength(2);
  await page.reload(); await page.getByRole('button',{name:'Resume saved attempt'}).click(); await expect(page.getByRole('heading',{name:'Repair held'})).toBeVisible();
  const resumed=await exported(page,'two-submissions-after-resume'); expect(resumed.attempt_id).toBe(original.attempt_id); expect(resumed.submissions).toHaveLength(2); expect(resumed.submissions.map(item=>item.evaluation!.status)).toEqual(['mismatch','pass']);
  expect(resumed.submissions.map(item=>item.candidate)).toEqual(original.submissions.map(item=>item.candidate)); reconstruct(resumed);
  receipts.push({name:'successful multiple-submission resume',recomputed:['mismatch','pass'],preserved_submissions:2});
});


test('guided setup exposes real authored actions before takeover', async ({page}) => {
  await page.goto('./'); await page.getByRole('button',{name:'Take over the lights'}).click();
  const replayNext = page.getByRole('button',{name:'Replay next setup action'});
  await replayNext.click(); await expect(page.getByText('Executed: Set delivery guard off',{exact:true})).toBeVisible();
  await replayNext.click(); await expect(page.getByRole('region',{name:'Actual setup state'}).getByText('Guard off · settled tick 4',{exact:true})).toBeVisible();
  await replayNext.click(); await expect(page.getByRole('region',{name:'Actual setup state'}).getByText('Guard off · settled tick 5',{exact:true})).toBeVisible(); await expect(replayNext).toBeDisabled();
  await page.getByRole('button',{name:'Begin takeover'}).click(); await expect(page.getByText('Tick 5 / Paused',{exact:true})).toBeVisible(); await expect(page.getByText('primary.4.left',{exact:true})).toBeVisible();
  receipts.push({name:'actual visible setup playback',actions:3,handover_tick:5});
});


test('unavailable curated assets leave a recoverable scripted preview', async ({page}) => {
  await page.route('**/recordings/manifest.json',route=>route.abort()); await page.goto('./');
  await expect(page.locator('.notice')).toContainText('Curated recording unavailable');
  await page.getByRole('button',{name:'Take over the lights'}).click(); await page.getByRole('button',{name:'Begin takeover'}).click();
  await expect(page.getByText('Scripted preview',{exact:true})).toBeVisible(); await expect(page.getByText('Tick 5 / Paused',{exact:true})).toBeVisible();
  await page.getByLabel('Delivery guard').check(); await page.getByRole('button',{name:'Check repair',exact:true}).click(); await expect(page.getByRole('heading',{name:'Repair held'})).toBeVisible();
  receipts.push({name:'curated asset unavailable',fallback:'Scripted preview',repair:'pass'});
});


test('build-curated fixture replays actual assessed actions, preserves its queue and binds resume to the source', async ({page}) => {
  const manifest=readFileSync(resolve('apps/web/public/recordings/fixtures/manifest-fixture.json'),'utf8');
  const recording=JSON.parse(readFileSync(resolve('apps/web/public/recordings/fixtures/recording-fixture.json'),'utf8')) as {commands: {request:unknown;actor:unknown;tick:number}[]};
  await page.route('**/recordings/manifest.json',route=>route.fulfill({contentType:'application/json',body:manifest}));
  await page.goto('./?category=live_model'); await page.getByRole('button',{name:'Take over the lights'}).click();
  for(let index=0;index<recording.commands.length+1;index++) await page.getByRole('button',{name:'Replay next setup action'}).click();
  await expect(page.getByText('Executed: Set delivery guard off',{exact:true})).toBeVisible(); await expect(page.getByRole('region',{name:'Actual setup state'}).getByText('Guard off · settled tick 5',{exact:true})).toBeVisible();
  await expect(page.getByText('Scripted preview',{exact:true})).toBeVisible(); await page.screenshot({path:resolve(screenshots,'curated-playback.png'),fullPage:true});
  await page.getByRole('button',{name:'Begin takeover'}).click(); await expect(page.getByText('primary.4.left',{exact:true})).toBeVisible(); await expect(page.getByLabel('Left pulse count')).toHaveText('0');
  const inherited=await exported(page,'curated-fixture-handover');
  expect(inherited.commands.slice(0,recording.commands.length).map(({request,actor,tick})=>({request,actor,tick}))).toEqual(recording.commands.map(({request,actor,tick})=>({request,actor,tick})));
  expect(inherited.commands.at(-1)!.request.action).toEqual({type:'set_epoch_guard',enabled:false}); expect(inherited.commands.at(-1)!.actor.role).toBe('controller');
  await page.getByLabel('Delivery guard').check(); await page.getByRole('button',{name:'Check repair',exact:true}).click(); await expect(page.getByRole('heading',{name:'Repair held'})).toBeVisible();
  const repaired=await exported(page,'curated-fixture-repaired'); reconstruct(repaired);
  await page.reload(); await page.getByRole('button',{name:'Resume saved attempt'}).click(); await expect(page.getByRole('heading',{name:'Repair held'})).toBeVisible();
  const resumed=await exported(page,'curated-fixture-resumed'); expect(resumed.attempt_id).toBe(repaired.attempt_id); expect(resumed.candidate).toEqual(repaired.candidate); expect(resumed.commands).toEqual(repaired.commands);
  await page.unroute('**/recordings/manifest.json'); await page.route('**/recordings/gallery.json',route=>route.fulfill({json:{schema_version:'1.0',entries:[]}})); await page.reload(); await page.getByRole('button',{name:'Resume saved attempt'}).click(); await expect(page.locator('.notice')).toContainText('Cannot resume'); await expect(page.getByRole('heading',{name:'Repair held'})).toHaveCount(0);
  receipts.push({name:'trusted curated fixture playback and source-bound resume',category:'fixture',assessed_commands:recording.commands.length,controller_fault:'set_epoch_guard',recomputed:'pass',unavailable_source_rejected:true});
});


test('changing the curated fault switches to authored provenance and clears the source binding', async ({page}) => {
  const manifest=readFileSync(resolve('apps/web/public/recordings/fixtures/manifest-fixture.json'),'utf8'); await page.route('**/recordings/manifest.json',route=>route.fulfill({contentType:'application/json',body:manifest}));
  await takeover(page); await page.getByLabel('Delivery guard').check(); await page.getByRole('button',{name:'Check repair',exact:true}).click(); await expect(page.getByRole('heading',{name:'Repair held'})).toBeVisible();
  const original=await exported(page,'curated-before-source-switch'); expect(original.playback_source).not.toBeNull();
  await page.getByLabel('Try another fault').selectOption('duplicate-clock'); await page.getByRole('button',{name:'New attempt',exact:true}).click(); await page.getByRole('button',{name:'Begin takeover'}).click(); const changed=await exported(page,'authored-after-source-switch');
  expect(changed.playback_source).toBeNull(); expect(changed.provenance).toMatchObject({category:'scripted',label:'Scripted preview',model:null,date:null}); await expect(page.getByText('Scripted preview',{exact:true})).toBeVisible();
  expect(changed.commands.every(command=>command.actor.role==='controller')).toBe(true);
  receipts.push({name:'curated source change restores authored labels',source_binding:null,provenance:'Scripted preview'});
});


for (const source of ['scripted','curated fixture'] as const) {
  test(`${source}: partial playback resume returns to setup and preserves the handover deadline`, async ({page}) => {
    let playbackLength=3;
    if (source === 'curated fixture') {
      const manifest=readFileSync(resolve('apps/web/public/recordings/fixtures/manifest-fixture.json'),'utf8');
      const recording=JSON.parse(readFileSync(resolve('apps/web/public/recordings/fixtures/recording-fixture.json'),'utf8'));
      playbackLength=recording.commands.length+1;
      await page.route('**/recordings/manifest.json',route=>route.fulfill({contentType:'application/json',body:manifest}));
    }
    await page.clock.install({time:new Date('2026-10-11T12:00:00Z')}); await page.clock.pauseAt(new Date('2026-10-11T12:00:01Z'));
    await page.goto('./'); await page.getByRole('button',{name:'Take over the lights'}).click(); await page.getByRole('button',{name:'Replay next setup action'}).click();
    await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('after-the-agent.saved.v2.')).length)).toBe(1);
    const before=await page.evaluate(()=>{const key=Object.keys(localStorage).find(key=>key.startsWith('after-the-agent.saved.v2.'))!;return JSON.parse(localStorage.getItem(key)!);});
    expect(before.phase).toBe('playback'); expect(before.playback_index).toBe(1); expect(before.commands).toHaveLength(1); expect(before.handover_at_ms).toBeNull(); expect(before.deadline_at_ms).toBeNull();
    if (source === 'curated fixture') expect(before.playback_source).not.toBeNull(); else expect(before.playback_source).toBeNull();
    await page.clock.fastForward(120000); await page.reload(); await page.getByRole('button',{name:'Resume saved attempt'}).click();
    await expect(page.getByRole('button',{name:'Replay next setup action'})).toBeEnabled(); await expect(page.getByText(`1 of ${playbackLength} actions replayed.`,{exact:true})).toBeVisible();
    await expect.poll(() => page.evaluate(id => JSON.parse(localStorage.getItem(`after-the-agent.saved.v2.${id}`)!).playback_index, before.attempt_id)).toBe(before.playback_index);
    const resumed=await page.evaluate(id=>JSON.parse(localStorage.getItem(`after-the-agent.saved.v2.${id}`)!),before.attempt_id); expect(resumed.attempt_id).toBe(before.attempt_id); expect(resumed.attempt_started_at_ms).toBe(before.attempt_started_at_ms); expect(resumed.commands).toEqual(before.commands); expect(resumed.playback_source).toEqual(before.playback_source); expect(resumed.deadline_at_ms).toBeNull();
    for(let index=1;index<playbackLength;index++) await page.getByRole('button',{name:'Replay next setup action'}).click();
    await expect(page.getByRole('button',{name:'Replay next setup action'})).toBeDisabled(); await page.clock.fastForward(7000); await page.getByRole('button',{name:'Begin takeover'}).click();
    await expect(page.getByText('Tick 5 / Paused',{exact:true})).toBeVisible(); await expect(page.getByRole('button',{name:'Step',exact:true})).toBeEnabled();
    const takeover=await exported(page,`${source.replace(' ','-')}-partial-playback-takeover`); expect(takeover.attempt_id).toBe(before.attempt_id); expect(takeover.commands).toHaveLength(playbackLength); expect(takeover.commands.slice(0,1)).toEqual(before.commands); expect(takeover.playback_source).toEqual(before.playback_source); expect(takeover.deadline_at_ms! - takeover.handover_at_ms!).toBe(300000);
    await page.clock.fastForward(1000); await page.reload(); await page.getByRole('button',{name:'Resume saved attempt'}).click(); await expect(page.getByText('Tick 5 / Paused',{exact:true})).toBeVisible(); await expect(page.getByRole('button',{name:'Replay next setup action'})).toHaveCount(0);
    const recovery=await exported(page,`${source.replace(' ','-')}-partial-playback-recovery-resume`); expect(recovery.handover_at_ms).toBe(takeover.handover_at_ms); expect(recovery.deadline_at_ms).toBe(takeover.deadline_at_ms); expect(recovery.playback_source).toEqual(takeover.playback_source); expect(recovery.commands).toEqual(takeover.commands);
    await page.clock.fastForward(300001); await expect(page.getByRole('heading',{name:'Recovery time ended.'})).toBeVisible();
    receipts.push({name:`${source} partial playback resume`,playback_actions:playbackLength,source_preserved:true,original_deadline_preserved:true});
  });
}
