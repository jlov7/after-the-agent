import { test,expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

test('capture inspection keeps selected artifact claims local, rejects unknown files and reflows at390px/200%',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('./');await page.getByRole('button',{name:'Take over the lights'}).click();await page.getByRole('button',{name:'Begin takeover'}).click();
  await page.getByRole('button',{name:'Inspect capture run',exact:true}).click();
  const section=page.locator('.capture-inspection');await expect(section.getByRole('heading',{name:'Inspect a local capture run'})).toBeVisible();
  const picker=section.getByLabel('Capture artifact files');
  const external:string[]=[];const origin=new URL(page.url()).origin;page.on('request',request=>{if(!request.url().startsWith(origin))external.push(request.url());});
  await page.context().setOffline(true);
  await picker.setInputFiles([{name:'status.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({status:'failed',reason:'budget_stop',category:'fixture'}))}]);
  await expect(section.getByRole('status')).toHaveText('Budget boundary reached');await expect(section.getByText('Unknown',{exact:true})).toBeVisible();
  await expect(section).toContainText('Authorship, run binding and live model provenance remain unverified.');
  await picker.setInputFiles([{name:'status.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({status:'failed',reason:'<img src=x onerror=alert(1)>'}))}]);
  await expect(section.getByText('<img src=x onerror=alert(1)>',{exact:true})).toBeVisible();await expect(section.locator('img')).toHaveCount(0);
  await picker.setInputFiles([{name:'config.json',mimeType:'application/json',buffer:Buffer.from('{}')}]);await expect(section.getByRole('status')).toHaveText('Choose only the listed nonsecret artifact filenames.');
  await picker.setInputFiles([{name:'status.json',mimeType:'application/json',buffer:Buffer.from('{}')},{name:'status.json',mimeType:'application/json',buffer:Buffer.from('{}')}]);await expect(section.getByRole('status')).toHaveText('Duplicate artifact filename');
  await picker.setInputFiles([{name:'status.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({status:'failed',reason:'budget_stop'}))}]);await expect(section.getByRole('status')).toHaveText('Budget boundary reached');
  const accessibility=await new AxeBuilder({page}).include('.capture-inspection').analyze();expect(accessibility.violations).toEqual([]);
  await page.evaluate(()=>{document.documentElement.style.fontSize='200%';});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await picker.focus();await expect(picker).toBeFocused();expect(external).toEqual([]);
  const directory=resolve(process.env.UI_EVIDENCE_DIR||'evidence/ui-browser','screenshots');mkdirSync(directory,{recursive:true});await page.screenshot({path:resolve(directory,'capture-inspector-390-200.png'),fullPage:true});
});
