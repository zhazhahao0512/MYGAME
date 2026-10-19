// UI regression: full equipment names, read-only quotes, and chest/shop transition.
import {chromium} from 'playwright-core';
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const port=5216,url=`http://127.0.0.1:${port}`,out='test-results/ui-theme';
const server=spawn(process.execPath,['scripts/server.mjs'],{env:{...process.env,PORT:String(port)},stdio:'pipe'});
let browser;const errors=[],metrics=[];
try{
 for(let n=0;n<100;n++){try{if((await fetch(url)).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 await mkdir(out,{recursive:true});browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 for(const [width,height] of [[1440,900],[2560,1440],[390,844]]){
  const touch=width<600,context=await browser.newContext({viewport:{width,height},hasTouch:touch,isMobile:touch}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  const click=async selector=>{const el=page.locator(selector).filter({visible:true}).first();if(touch)await el.tap();else await el.click();};
  const gear=(hero,slot)=>`[data-act="gear"][data-hero="${hero}"][data-slot="${slot}"]`;
  const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('squad-expedition.save.v1')));
  await page.goto(url);
  await page.evaluate(async()=>{
   const M=await import('/src/model.js'),{initializeProgression}=await import('/src/heroes/progression.js');
   const r=M.createRun(8801);r.level=5;r.floor=4;r.phase='ready';r.candidates=[];
   r.party=['lanya','stone','fire','wind','leaf'].map((hero,i)=>({hero,gear:[M.makeItem(r,'blue_balanced_amulet'),M.makeItem(r,'purple_clearwell_staff'),null,null]}));
   // Use actual catalog hero ids, keeping a fixed five-person state across runs.
   const {HEROES}=await import('/src/data.js');r.party.forEach((m,i)=>{m.hero=HEROES[i].id;initializeProgression(m,r.level,r.seed,{legacy:true});});
   M.finishRound(r,{won:true,gold:3000,kills:42});
   r.chest.options=['white_iron_sword','white_dagger','white_glimmer_wand'].map(id=>M.makeItem(r,id));
   r.shop=['blue_balanced_amulet','purple_flowing_codex','purple_clearwell_staff','white_dagger'].map(id=>M.makeItem(r,id));
   localStorage.setItem(M.SAVE_KEY,JSON.stringify(r));
  });
  await page.reload();await click('[data-act="continue"]');await page.evaluate(()=>document.fonts.ready);
  assert.equal(await page.locator('[data-act="next"]').isDisabled(),true);
  assert.equal(await page.locator('.chest-choices .offer').count(),3);
  const names=async()=>{
   const r=await saved();
   for(const [h,m]of r.party.entries())for(const [slot,item]of m.gear.entries())if(item)assert.equal((await page.locator(`${gear(h,slot)} .equipment-name`).innerText()).replace(/\s/g,''),item.name);
   const bad=await page.locator('.gear-slot.filled .equipment-name,.item-box .equipment-name').evaluateAll(es=>es.filter(e=>{const r=e.getBoundingClientRect(),p=e.parentElement.getBoundingClientRect();return e.scrollWidth>e.clientWidth+1||r.right>p.right+1||r.bottom>p.bottom+1;}).map(e=>e.textContent));assert.deepEqual(bad,[],'complete names fit their slots');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal page overflow');
  };
  await names();await page.screenshot({path:`${out}/${width}-chest.png`,fullPage:true,animations:'disabled'});
  const before=await saved();await click('[data-act="select-offer"][data-index="0"]');
  if(!touch){await page.locator(gear(2,2)).hover();assert.match(await page.locator('[data-gear-preview="2"]').innerText(),/攻击力/);assert.match(await page.locator('#selection-cost').innerText(),/免费领取/);}
  assert.deepEqual(await saved(),before,'reward selection and hover do not change the save');
  await click(gear(2,2));const reward=await saved();assert.equal(reward.chest.claimed,true);assert.equal(reward.gold,before.gold);assert.equal(reward.party[2].gear[2].base,'white_iron_sword');
  assert.equal(await page.locator('.shop-shell').getAttribute('data-reward-phase'),'shop');assert.equal(await page.locator('[data-act="next"]').isDisabled(),false);
  await click('[data-act="select-offer"][data-index="0"]');
  if(!touch){await page.locator(gear(1,2)).hover();assert.match(await page.locator('#selection-cost').innerText(),/2160/);assert.match(await page.locator('[data-gear-preview="1"]').innerText(),/物理抗性/);}
  assert.deepEqual(await saved(),reward,'purchase preview does not spend gold');
  if(!touch)assert.ok(await page.locator('[data-gear-preview="1"] .stat-changes b').evaluateAll(es=>es.length>0&&es.every(e=>{const r=e.getBoundingClientRect(),p=e.closest('.gear-preview').getBoundingClientRect();return r.bottom<=p.bottom+1&&r.right<=p.right+1;})),'numeric deltas fit the preview');
  await page.waitForTimeout(3500);await names();await page.screenshot({path:`${out}/${width}-shop-selected.png`,fullPage:true,animations:'disabled'});
  await click(gear(1,2));assert.equal((await saved()).gold,2160);
  await click('[data-act="select-offer"][data-index="3"]');const beforeReplace=await saved();await click(gear(0,0));assert.equal(await page.locator('.compare-popover').count(),1);assert.deepEqual(await saved(),beforeReplace);
  await page.screenshot({path:`${out}/${width}-replace.png`,animations:'disabled'});await click('[data-act="close-popover"]');await click('[data-act="cancel-selection"]');
  // No global style leak after leaving the themed page.
  await click('[data-act="home"]');assert.equal(await page.locator('.expedition-shop').count(),0);await click('[data-act="continue"]');await names();
  metrics.push({width,height,scrollHeight:await page.evaluate(()=>document.documentElement.scrollHeight),errors:[...errors]});
  await context.close();console.log(`${width}: full names, chest gate, no-mutation quote, free reward, paid acquisition and replacement cancel passed`);
 }
 assert.deepEqual(errors,[]);await writeFile(`${out}/report.json`,JSON.stringify(metrics,null,2));
}finally{await browser?.close();server.kill('SIGTERM');}
