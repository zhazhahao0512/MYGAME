import {chromium} from 'playwright-core';
import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const port=Number(process.env.V2_TEST_PORT||5196),url=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,['scripts/server.mjs'],{env:{...process.env,PORT:String(port)},stdio:'pipe'});
let browser;const errors=[];
try{
 let ready=false;for(let n=0;n<100;n++){try{if((await fetch(url)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(ready);
 await mkdir('test-results/battle-v2',{recursive:true});
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 for(const touch of [false,true]){
  const context=await browser.newContext({viewport:touch?{width:844,height:390}:{width:2560,height:1440},hasTouch:touch,isMobile:touch,deviceScaleFactor:1});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  const click=async(action,extra='')=>{const el=page.locator(`[data-act="${action}"]${extra}`).filter({visible:true}).first();if(touch)await el.tap();else await el.click();};
  await page.goto(url);await page.clock.install();await click('preview-menu');await click('preview','[data-page="battle"]');await page.locator('#battle-canvas[data-engine]').waitFor();
  await page.clock.pauseAt(new Date((await page.evaluate(()=>Date.now()))+1000));
  assert.equal(await page.locator('.hero-panel:visible').count(),1);assert.equal(await page.locator('.challenge-card').count(),3);
  const canvas=await page.locator('canvas').elementHandle();
  await click('select-unit','[data-hero="2"]');
  // Native canvas interaction: select rightmost enemy. It must set hero 3's intent.
  const bounds=await page.locator('canvas').boundingBox();
  const x=bounds.x+bounds.width-(touch?2:10)-bounds.width*(touch?.47:.435)/10;
  const y=bounds.y+(touch?50:Math.max(Math.max(130,Math.min(bounds.height*.68,520,bounds.height-150))/2+40,(bounds.height-85)/2));
  if(touch)await page.touchscreen.tap(x,y);else await page.mouse.click(x,y);
  if(touch)await click('detail-tactics');
  assert.match(await page.locator('#target-preference').textContent(),/优先位置 5/);
  assert.match(await page.locator('#actual-target').textContent(),/5/);
  for(const mode of ['ratio','health','near','far','hit']){
   await click('target-mode',`[data-mode="${mode}"]`);assert.equal(await page.locator(`[data-mode="${mode}"]`).getAttribute('aria-pressed'),'true');
  }
  await click('select-unit','[data-hero="1"]');if(touch)await click('detail-tactics');
  assert.match(await page.locator('#target-preference').textContent(),/全场/);
  await click('select-unit','[data-hero="2"]');if(touch)await click('detail-tactics');
  assert.match(await page.locator('#target-preference').textContent(),/优先位置 5/);
  if(!touch){
   await click('inspect-enemy');await click('select-enemy','[data-index="1"]');assert.match(await page.locator('#target-preference').textContent(),/优先位置 5/,'inspection never changes stored intent');
  }
  await click('accept-challenge');assert.equal(await page.locator('.queued-challenge').count(),1);assert.match(await page.locator('#queue-count').textContent(),/1\/3/);
  const countdown=await page.locator('#spawn-countdown').textContent();await click('pause');await page.clock.runFor(1000);assert.equal(await page.locator('#spawn-countdown').textContent(),countdown);await click('close');
  await click('cancel-challenge');assert.equal(await page.locator('.queued-challenge').count(),0);
  await click('accept-challenge');
  if(touch)await click('detail-tactics');
  await click('clear-target');assert.match(await page.locator('#target-preference').textContent(),/全场/);
  await page.screenshot({path:`test-results/battle-v2/${touch?'phone-tactics':'desktop-tactics'}.png`});
  if(touch)await click('detail-loadout');
  await page.clock.runFor(6200);
  assert.equal(await canvas.evaluate(el=>el.isConnected),true);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight),'fits viewport');
  await page.screenshot({path:`test-results/battle-v2/${touch?'phone':'desktop'}-battle.png`});
  if(!touch){await page.setViewportSize({width:1440,height:900});await page.clock.runFor(100);await page.screenshot({path:'test-results/battle-v2/desktop-1440.png'});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight));}
  await context.close();console.log(`${touch?'Touch':'Desktop'}: canvas commands, five modes, independent intent, challenge queue/pause/cancel and viewport passed.`);
 }
 // Real run uses normal storage; reopening resumes at pre-battle checkpoint with intent retained.
 const page=await browser.newPage({viewport:{width:1440,height:900}});page.on('pageerror',e=>errors.push(e.message));await page.goto(url);
 const click=a=>page.locator(`[data-act="${a}"]`).filter({visible:true}).first().click();
 await click('new');await click('confirm-hero');await click('confirm-hero');await click('start-battle');await page.locator('#battle-canvas[data-engine]').waitFor();
 await click('select-unit');await page.locator('[data-act="select-enemy"][data-index="3"]').click();await page.locator('[data-mode="health"]').click();
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('squad-expedition.save.v1')));
 assert.ok(saved.party.some(m=>m.tactics?.preferredSlot===3&&m.tactics.mode==='health'));
 await page.reload();await click('continue');await click('start-battle');await page.locator('#battle-canvas[data-engine]').waitFor();
 const idx=saved.party.findIndex(m=>m.tactics?.preferredSlot===3);await page.locator(`[data-act="select-unit"][data-hero="${idx}"]`).first().click();
 assert.match(await page.locator('#target-preference').textContent(),/优先位置 4/);assert.equal(await page.locator('[data-mode="health"]').getAttribute('aria-pressed'),'true');
 assert.deepEqual(errors,[]);console.log('Checkpoint tactics survive reload; no browser errors.');
}finally{if(browser)await browser.close();server.kill('SIGTERM');}
