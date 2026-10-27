import { expect, test } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { openEvidenceExports } from './evidence-controls.js';
const harness=process.env.ATA_EVIDENCE_HARNESS==='1';
const open=async(page:import('@playwright/test').Page)=>{
 await page.goto('./');
 if(!harness){await page.getByRole('button',{name:'Take over the lights'}).click();await page.getByRole('button',{name:'Begin takeover'}).click();for(let i=0;i<32;i++)await page.getByRole('button',{name:'Step',exact:true}).click();}
};
test('complete history pages each match once and combines accessible filters without losing older events',async({page})=>{
 await open(page);
 const history=page.getByRole('region',{name:'Complete event history',exact:true});
 const status=history.getByRole('status');await expect(status).toContainText('matches.');
 const count=Number((await status.textContent())!.split(' ')[0]),keys:string[]=[];
 do{const rows=history.locator('[data-history-key]');expect(await rows.count()).toBeLessThanOrEqual(50);keys.push(...await rows.evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-history-key')!)));const next=history.getByRole('button',{name:'Next history page'});if(await next.isDisabled())break;await next.click();}while(keys.length<=count);
 expect(keys).toHaveLength(count);expect(new Set(keys).size).toBe(count);expect(count).toBeGreaterThan(50);
 await history.screenshot({path:'evidence/ui-browser/screenshots/history.png'});
 await history.getByLabel('From tick').fill('6');await history.getByLabel('Through tick').fill('10');await history.getByLabel('Event type').selectOption('pulse');await history.getByLabel('Job ID').fill('primary');
 await expect(status).toContainText('Page 1 of');
 for(const row of await history.locator('[data-history-key]').all()){const text=await row.textContent();expect(text).toMatch(/Tick (6|7|8|9|10) /);expect(text).toContain('pulse');expect(text).toContain('primary');}
 await history.getByLabel('Request ID').fill('no-such-request');await expect(status).toContainText('0 matches.');
 await page.setViewportSize({width:390,height:844});await expect(history.getByLabel('Search history')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
test('downloaded HTML renders locally with no executable markup or network and prints its claim boundaries',async({page,context})=>{
 await open(page);await openEvidenceExports(page);const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download HTML evidence report'}).click();const file=await download;
 const directory=resolve(process.env.UI_EVIDENCE_DIR??'work/full-evidence');mkdirSync(directory,{recursive:true});const path=resolve(directory,'evidence-report.html');await file.saveAs(path);const html=readFileSync(path,'utf8');
 const report=await context.newPage(),requests:string[]=[];await report.route('**/*',route=>{requests.push(route.request().url());return route.abort();});await report.setContent(html);await report.emulateMedia({media:'print'});
 await expect(report.getByRole('heading',{name:'Initial state',exact:true})).toBeVisible();await expect(report.getByRole('heading',{name:'Source commitments',exact:true})).toBeVisible();await expect(report.getByText(/not a study result/)).toBeVisible();
 expect(await report.locator('script,iframe,img,link').count()).toBe(0);expect(await report.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')).toContain("default-src 'none'");expect(requests).toEqual([]);await report.screenshot({path:'evidence/ui-browser/screenshots/html-report.png'});await report.close();
});
