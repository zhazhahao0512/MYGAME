import {chromium} from 'playwright-core';
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import * as M from '../src/model.js';
import {HEROES} from '../src/data.js';
import {initializeProgression} from '../src/heroes/progression.js';
const port=5226,url=`http://127.0.0.1:${port}`,server=spawn(process.execPath,['scripts/server.mjs'],{env:{...process.env,PORT:String(port)},stdio:'pipe'});
let browser;const errors=[];
try{
 for(let i=0;i<100;i++){try{if((await fetch(url)).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});await mkdir('test-results/roster',{recursive:true});
 for(const [width,height] of [[1440,900],[844,390]]){
  const ctx=await browser.newContext({viewport:{width,height},hasTouch:width<1000,isMobile:width<1000}),page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
  const click=async selector=>{const el=page.locator(selector).filter({visible:true}).first();await el.scrollIntoViewIfNeeded();if(width<1000)await el.tap();else await el.click();};
  await page.goto(url);const text=await page.locator('body').innerText();for(const h of HEROES)assert.ok(text.includes(h.name));assert.doesNotMatch(text,/逐风|磐石|烬语|青禾|赤刃|夜隼|听潮/);
  const run=M.createRun(71);run.level=6;run.phase='ready';run.candidates=[];run.party=HEROES.map(h=>({hero:h.id,gear:[null,null,null,null]}));for(const m of run.party)initializeProgression(m,6,run.seed);
  await page.evaluate(([key,run])=>localStorage.setItem(key,JSON.stringify(run)),[M.SAVE_KEY,run]);await page.reload();await click('[data-act="continue"]');
  for(let i=0;i<5;i++){
   await click(`[data-act="hero-growth"][data-hero="${i}"]`);assert.match(await page.locator('.hero-growth').innerText(),/推荐顺序/);
   await click(`[data-act="upgrade-skill"][data-skill="0"]`);assert.match(await page.locator('.growth-next').first().innerText(),/升级后/);
   // 6th hero level unlocks fourth normal rank; ultimate still restricted to rank 1.
   await click('[data-act="upgrade-skill"][data-skill="3"]');assert.equal(await page.locator('[data-act="upgrade-skill"][data-skill="3"]').isDisabled(),true);
   if(i===4)await page.waitForTimeout(300);if(i===4)await page.screenshot({path:`test-results/roster/${width}-skill-up.png`});await click('[data-act="close"]');
  }
  await click('[data-act="start-battle"]');assert.match(await page.locator('#modal-root').innerText(),/还有技能点待分配/);
  await click('[data-act="battle-recommended"]');await page.locator('#battle-canvas[data-engine]').waitFor();
  const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),M.SAVE_KEY);assert.ok(saved.party.every(m=>m.progression.ranks.reduce((a,b)=>a+b)===6));
  await page.waitForTimeout(300);await page.screenshot({path:`test-results/roster/${width}-five-heroes.png`});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await ctx.close();console.log(`Five heroes, manual/recommended ranks and combat verified: ${width}x${height}`);
 }
 assert.deepEqual(errors,[]);await writeFile('test-results/roster/browser.json',JSON.stringify({errors,sizes:[[1440,900],[844,390]]},null,2));
}finally{await browser?.close();server.kill('SIGTERM');}
