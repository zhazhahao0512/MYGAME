import {chromium} from 'playwright-core';
import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const port=Number(process.env.BATTLE_TEST_PORT||5194),url=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,['scripts/server.mjs'],{env:{...process.env,PORT:String(port)},stdio:'pipe'});
let browser,activePage;const errors=[];
try{
  let ready=false;for(let n=0;n<100;n++){try{if((await fetch(url)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(ready);
  await mkdir('test-results/battle-interaction',{recursive:true});
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  for(const touch of (process.env.BATTLE_INPUT==='touch'?[true]:[false,true])){
    const context=await browser.newContext({viewport:touch?{width:844,height:390}:{width:2560,height:1440},deviceScaleFactor:1,hasTouch:touch,isMobile:touch});
    const page=await context.newPage();activePage=page;const cdp=touch?await context.newCDPSession(page):null;page.on('pageerror',e=>errors.push(e.message));
    const click=async(action,extra='')=>{const el=page.locator(`[data-act="${action}"]${extra}`).filter({visible:true}).first();if(touch)await el.tap();else await el.click();};
    const closeInfo=async()=>{const el=page.locator('[data-inspection-close]');if(touch)await el.tap();else await el.click();};
    const tick=()=>page.locator('#battle-canvas').getAttribute('data-tick');
    const screenshot=name=>page.screenshot({path:`test-results/battle-interaction/${touch?'phone':'desktop'}-${name}.png`});
    const noOverflow=async()=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight),'battle fits viewport');
    await page.goto(url);await page.clock.install();await click('preview-menu');await click('preview','[data-page="battle"]');await page.locator('#battle-canvas[data-engine]').waitFor();await page.clock.runFor(100);
    await click('select-unit','[data-hero="2"]');await click('auto','[data-hero="2"]');
    // Advance only explicitly from here: machine load must not alter 400ms hover assertions.
    await page.clock.pauseAt(new Date((await page.evaluate(()=>Date.now()))+1000));
    const canvas=await page.locator('canvas').elementHandle();await noOverflow();
    const q=page.locator('.hero-panel.selected [data-act="skill"][data-skill="0"]');
    if(!touch){
      await page.mouse.move(2,2);await q.hover();await page.clock.runFor(300);assert.equal(await page.locator('.inspection-card').count(),0,'passing over icons does not pause');
      await page.clock.runFor(150);assert.equal(await page.locator('.inspection-card').count(),1);
      const paused=await tick();await page.clock.runFor(600);assert.equal(await tick(),paused);
      await page.locator('.inspection-card header').hover();await page.clock.runFor(250);assert.equal(await page.locator('.inspection-card').count(),1,'pointer can enter card');
      await page.mouse.move(2,2);await page.clock.runFor(200);assert.equal(await page.locator('.inspection-card').count(),0);assert.notEqual(await tick(),paused);
      // Keyboard inspection closes with Escape without also opening the pause menu.
      await page.keyboard.press('Tab');await q.focus();assert.equal(await page.locator('.inspection-card').count(),1);await page.keyboard.press('Escape');assert.equal(await page.locator('.inspection-card,.modal-backdrop').count(),0);
    }
    await click('skill','[data-hero="2"][data-skill="0"]');assert.match(await page.locator('.inspection-copy').textContent(),/盾击|目标|法力消耗/);
    let paused=await tick();const particles=await page.locator('#battle-canvas').getAttribute('data-particles');await page.clock.runFor(800);assert.equal(await tick(),paused);assert.equal(await page.locator('#battle-canvas').getAttribute('data-particles'),particles);
    await screenshot('inspection');
    assert.equal(await page.locator('#app').evaluate(el=>el.inert),false);
    assert.ok(await page.locator('.inspection-card').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;}));
    if(touch){
      const bounds=await page.locator('.inspection-copy').boundingBox(),x=bounds.x+bounds.width/2;
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y:bounds.y+bounds.height-20,id:1}]});
      for(let n=1;n<=6;n++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:bounds.y+bounds.height-20-(bounds.height-40)*n/6,id:1}]});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.clock.runFor(150);
      assert.ok(await page.locator('.inspection-copy').evaluate(el=>el.scrollTop>0),'touch scroll reads the full local card');assert.equal(await tick(),paused);assert.equal(await page.locator('[data-inspection-close]').isVisible(),true);
    }
    // Switching cards stays paused; it cannot select a new random target or advance time.
    await click('skill','[data-hero="2"][data-skill="1"]');assert.equal(await tick(),paused);await page.clock.runFor(500);assert.equal(await tick(),paused);
    await closeInfo();await page.mouse.move(1,1);await page.clock.runFor(500);assert.notEqual(await tick(),paused);
    // An explicit manual pause takes over from inspection; closing it resumes deliberately.
    await click('gear','[data-hero="2"][data-slot="0"]');await click('pause');assert.equal(await page.locator('.inspection-card').count(),0);paused=await tick();await page.clock.runFor(500);assert.equal(await tick(),paused);await click('close');
    // Browser visibility pauses even if another modal already owns a pause reason.
    await click('skill','[data-hero="2"][data-skill="0"]');
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
    paused=await tick();await page.clock.runFor(500);assert.equal(await tick(),paused);
    await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
    assert.equal(await page.locator('.modal-backdrop').count(),1);await page.clock.runFor(500);assert.equal(await tick(),paused);await click('close');
    await click('augment-info');
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
    await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
    paused=await tick();await click('close');assert.match(await page.locator('#modal-title').textContent(),/稍作休整/);await page.clock.runFor(200);assert.equal(await tick(),paused,'closing an unrelated modal cannot release background pause');await click('close');
    await page.mouse.move(1,1);await page.clock.runFor(5400);
    const cast=page.locator('[data-act="cast-ultimate"][data-hero="2"]');
    // A six-second spawn gap can be followed by a 0.25s Q cast; wait through both, without fabricating targets.
    for(let n=0;n<80&&await cast.isDisabled();n++)await page.clock.runFor(100);
    assert.equal(await cast.isDisabled(),false,'manual R becomes available with a live target');
    await click('skill','[data-hero="2"][data-skill="3"]');assert.equal(await cast.isDisabled(),false,'viewing R never spends it');paused=await tick();await page.clock.runFor(300);assert.equal(await tick(),paused);
    await click('cast-ultimate','[data-hero="2"]');assert.equal(await page.locator('.inspection-card').count(),0);assert.equal(await cast.isDisabled(),true,'manual R spends cooldown once');
    const repeat=await cast.evaluate(el=>{const label=document.querySelector('[data-resources="2"]'),before=label.textContent;el.dispatchEvent(new MouseEvent('click',{bubbles:true}));return {before,after:label.textContent};});assert.equal(repeat.after,repeat.before,'disabled repeat does not spend resources');
    await page.clock.runFor(700);await screenshot('battle');await noOverflow();
    if(touch){
      assert.equal(await page.locator('.hero-panel:visible').count(),1);assert.equal(await page.locator('.hero-selector button').count(),5);
      const hitSizes=await page.locator('.hero-panel.selected .skill,.hero-panel.selected .gear-slot,.hero-selector button').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return [r.width,r.height];}));assert.ok(hitSizes.every(([w,h])=>w>=44&&h>=44));
      await click('detail-stats');await click('detail-stats');await screenshot('attributes');await click('detail-loadout');
      await page.setViewportSize({width:740,height:360});await page.clock.runFor(100);await noOverflow();assert.ok(await page.locator('.hero-panel.selected .skill,.hero-panel.selected .gear-slot').evaluateAll(els=>els.every(el=>{const r=el.getBoundingClientRect();return r.bottom<=innerHeight&&r.top>=0;})),'all skill and gear controls fit short landscape');await screenshot('740');
      await click('skill','[data-hero="2"][data-skill="0"]');
      await page.setViewportSize({width:390,height:844});await page.clock.runFor(100);assert.equal(await page.locator('.portrait-battle').isVisible(),true);assert.equal(await page.locator('.inspection-card').count(),0);paused=await tick();await page.clock.runFor(500);assert.equal(await tick(),paused);await screenshot('portrait');
      await page.setViewportSize({width:844,height:390});await page.clock.runFor(100);assert.equal(await tick(),paused,'rotation back needs explicit continue');await click('resume-orientation');await page.clock.runFor(500);assert.notEqual(await tick(),paused);
      // Native touch can select a battlefield card, not only the DOM selector.
      const bounds=await page.locator('canvas').boundingBox();await page.touchscreen.tap(bounds.x+bounds.width*.47/10+2,bounds.y+60);assert.equal(await page.locator('.hero-panel.selected').getAttribute('data-unit'),'4');
    }else{
      await page.setViewportSize({width:1440,height:900});await page.clock.runFor(100);await noOverflow();await screenshot('1440');
    }
    assert.equal(await canvas.evaluate(el=>el.isConnected),true,'inspection, controls and resize retain the scene');
    await click('pause');await click('leave-battle');await page.clock.resume();await click('preview-menu');await click('preview','[data-page="shop"]');
    await click('inspect-offer','[data-index="0"]');assert.equal(await page.locator('.inspection-card').count(),1);await closeInfo();
    await click('gear','[data-hero="2"][data-slot="0"]');assert.equal(await page.locator('.shop-popover').count(),1);assert.equal(await page.locator('.inspection-card').count(),0,'sale and description do not overlap');await click('close-popover');
    console.log(`${touch?'Touch landscape':'Desktop'}: inspection, pauses, R, responsive layout and shop integration passed.`);
    await context.close();
  }
  // Real renderer feedback fixture, kept entirely outside the production application.
  const page=await browser.newPage({viewport:{width:1440,height:900}});page.on('pageerror',e=>errors.push(e.message));await page.goto(url);
  await page.evaluate(async()=>{
    const [{Battle},{createRun},{HEROES},{PhaserBattleRenderer}]=await Promise.all([import('/src/battle.js'),import('/src/model.js'),import('/src/data.js'),import('/src/renderer/PhaserBattleRenderer.ts')]);
    document.body.innerHTML='<div id="feedback-stage" style="height:650px;width:1400px"></div>';
    const run=createRun(100);run.party=HEROES.slice(0,5).map(h=>({hero:h.id,gear:[null,null,null,null],auto:false}));const b=new Battle(run);const u=b.party[0];u.hp=30;u.stats.attack=50;u.stats.crit=0;u.stats.lifeSteal=.2;u.stats.omni=.2;u.stats.healing=0;
    for(const e of b.enemies){e.hp=100;e.stats.hp=100;e.stats.armor=0;}b.enemies[0].shield=30;b.settle(b.fire(u,b.enemies[0]));
    b.enemies[1].shield=100;const crit=b.fire(u,b.enemies[1]);crit.crit=true;b.settle(crit);
    b.party[1].hp=30;b.applyEffect(b.party[2],b.party[1],{type:'heal',amount:20},{origin:'skill',originId:'W',skillKey:'W'});
    b.applyEffect(b.party[2],b.party[2],{type:'shield',amount:40},{origin:'skill',originId:'E',skillKey:'E'});
    window.feedbackRenderer=new PhaserBattleRenderer(document.querySelector('#feedback-stage'),b,{advance(){},selected:()=>0,select(){},motion:()=>false,paused:()=>false});
  });
  await page.waitForFunction(()=>JSON.parse(document.querySelector('#feedback-stage').dataset.feedback||'[]').length>=5);
  const feedback=await page.locator('#feedback-stage').evaluate(el=>JSON.parse(el.dataset.feedback));
  assert.ok(feedback.some(g=>g.kind==='absorb'&&g.color==='#70c9ff'));assert.ok(feedback.some(g=>g.kind==='damage'&&g.color==='#e6dfca'));assert.ok(feedback.some(g=>g.healingKind==='vamp'&&g.color==='#9fe08b'));assert.ok(feedback.some(g=>/暴击 盾/.test(g.text)&&g.color==='#70c9ff'));
  await page.screenshot({path:'test-results/battle-interaction/shield-vamp-feedback.png'});await page.evaluate(()=>window.feedbackRenderer.destroy());
  assert.deepEqual(errors,[]);console.log('Battle interaction checks passed, including actual shield/vamp renderer colors.');
}catch(error){if(activePage&&!activePage.isClosed())await activePage.screenshot({path:'test-results/battle-interaction/failure.png'}).catch(()=>{});throw error;}finally{if(browser)await browser.close();server.kill('SIGTERM');}

// Keep V2 commands and queue coverage in the existing CI battle check.
await import('./battle-v2-check.mjs');
