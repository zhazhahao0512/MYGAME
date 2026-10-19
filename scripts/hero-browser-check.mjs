import {chromium} from 'playwright-core';
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import * as M from '../src/model.js';
import {initializeProgression} from '../src/heroes/progression.js';
const port=5206,url=`http://127.0.0.1:${port}`,server=spawn(process.execPath,['scripts/server.mjs'],{env:{...process.env,PORT:String(port)},stdio:'pipe'});
let browser;const errors=[];
function state(level){const r=M.createRun(7);r.level=level;r.phase='ready';r.candidates=[];r.party=[{hero:'lanya',gear:[null,null,null,null],skillModes:Array(4).fill('manual')}];initializeProgression(r.party[0],level,r.seed);return r;}
try{
 for(let i=0;i<100;i++){try{if((await fetch(url)).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});await mkdir('test-results/heroes',{recursive:true});
 for(const [width,height] of [[1440,900],[740,360]]){
  const ctx=await browser.newContext({viewport:{width,height},hasTouch:width<1000,isMobile:width<1000}),page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
  const click=async s=>{const el=page.locator(s).filter({visible:true}).first();if(width<1000)await el.tap();else await el.click();};
  await page.goto(url);
  const load=async r=>{await page.evaluate(([key,r])=>localStorage.setItem(key,JSON.stringify(r)),[M.SAVE_KEY,r]);await page.reload();await click('[data-act="continue"]');};
  await load(state(2));await click('[data-act="hero-growth"]');await click('[data-act="upgrade-skill"][data-skill="0"]');assert.equal(await page.locator('[data-act="upgrade-skill"][data-skill="0"]').isDisabled(),true);await click('[data-act="upgrade-skill"][data-skill="1"]');
  let saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),M.SAVE_KEY);assert.deepEqual(saved.party[0].progression.ranks,[1,1,0,0]);await click('[data-act="close"]');
  const high=state(16);await load(high);await click('[data-act="hero-growth"]');await click('[data-act="recommend-skills"]');assert.equal(await page.locator('.growth-skills h3').count(),4);
  const offers=await page.locator('[data-act="choose-growth"]').evaluateAll(es=>es.map(e=>e.dataset.id));assert.equal(new Set(offers).size,3);await page.waitForTimeout(200);await page.screenshot({path:`test-results/heroes/${width}-growth.png`});
  await click('[data-act="close"]');await page.reload();await click('[data-act="continue"]');await click('[data-act="hero-growth"]');assert.deepEqual(await page.locator('[data-act="choose-growth"]').evaluateAll(es=>es.map(e=>e.dataset.id)),offers);
  await click('[data-act="choose-growth"]');assert.equal(await page.locator('[data-act="choose-growth"]').count(),0);await click('[data-act="close"]');
  saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),M.SAVE_KEY);assert.deepEqual(saved.party[0].progression.ranks,[4,4,4,3]);assert.equal(saved.party[0].progression.choices.length,1);
  await page.clock.install();await click('[data-act="start-battle"]');await page.locator('#battle-canvas[data-engine]').waitFor();await page.clock.pauseAt(new Date((await page.evaluate(()=>Date.now()))+1000));
  assert.equal(await page.locator('.skill-mode').count(),4);await click('[data-act="cast-skill"][data-skill="3"]');assert.equal(await page.locator('[data-act="cast-skill"][data-skill="0"]').isDisabled(),true);assert.equal(await page.locator('[data-act="cast-skill"][data-skill="1"]').isDisabled(),true);
  await click('[data-act="skill"][data-skill="3"]');assert.match(await page.locator('.inspection-card').textContent(),/真伤×4/);await click('[data-inspection-close]');await page.clock.runFor(100);await page.screenshot({path:`test-results/heroes/${width}-battle.png`});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  console.log(`Hero growth and actual casting verified ${width}x${height}`);await ctx.close();
 }
 assert.deepEqual(errors,[]);await writeFile('test-results/heroes/browser.json',JSON.stringify({sizes:[[1440,900],[740,360]],errors,checks:['level2 restriction','manual upgrade','recommended fill','persistent choices','ultimate takeover','inspector','no horizontal overflow']},null,2));
}finally{await browser?.close();server.kill('SIGTERM');}
