import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const port=Number(process.env.SHOP_TEST_PORT||5193),url=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,['scripts/server.mjs'],{env:{...process.env,PORT:String(port)},stdio:'pipe'});
let browser;
const errors=[];
try {
  let ready=false;for(let n=0;n<100;n++){try{if((await fetch(url)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(ready);
  await mkdir('test-results/shop-interaction',{recursive:true});
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  for(const touch of (process.env.SHOP_INPUT==='touch'?[true]:[false,true])){
    const context=await browser.newContext({viewport:touch?{width:390,height:844}:{width:2560,height:1440},deviceScaleFactor:1,hasTouch:touch,isMobile:touch});
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    const cdp=touch?await context.newCDPSession(page):null;
    const click=(act,extra='')=>page.locator(`[data-act="${act}"]${extra}`).first().click();
    const gear=(h,s)=>page.locator(`[data-act="gear"][data-hero="${h}"][data-slot="${s}"]`);
    const hero=h=>page.locator(`[data-drag="hero"][data-hero="${h}"]`);
    const save=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('squad-expedition.save.v1')));
    const fixture=async(claimed=false,gold=3000)=>{
      await page.goto(url);
      await page.evaluate(async({claimed,gold})=>{
        const M=await import('/src/model.js'),{HEROES}=await import('/src/data.js');
        const run=M.createRun(77101);run.party=HEROES.slice(0,5).map(h=>({hero:h.id,gear:[null,null,null,null],auto:true}));
        run.phase='battle';run.floor=4;M.finishRound(run,{won:true,gold,kills:42,seconds:25});
        run.party.forEach((h,i)=>h.gear[0]=M.makeItem(run,i===1?5:0,'armor'));
        run.chest.options=[M.makeItem(run,1,'clock'),M.makeItem(run,2,'rune'),M.makeItem(run,5,'rune')];run.chest.claimed=claimed;
        run.shop=[M.makeItem(run,2,'clock'),M.makeItem(run,2,'rune'),M.makeItem(run,5,'rune'),M.makeItem(run,1,'armor')];
        localStorage.setItem(M.SAVE_KEY,JSON.stringify(run));
      },{claimed,gold});
      await page.reload();await click('continue');
      if(process.env.SHOP_DEBUG)await page.evaluate(()=>{window.trace=[];for(const type of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture'])document.addEventListener(type,e=>window.trace.push({type,x:e.clientX,y:e.clientY,hit:document.elementFromPoint(e.clientX,e.clientY)?.outerHTML.slice(0,240),scrollY}),true);});
    };
    const center=async el=>{const r=await el.boundingBox();assert.ok(r);return {x:r.x+r.width/2,y:r.y+r.height/2};};
    const press=async p=>touch?cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...p,id:1}]}):(await page.mouse.move(p.x,p.y),page.mouse.down());
    const move=async p=>touch?cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...p,id:1}]}):page.mouse.move(p.x,p.y,{steps:5});
    const release=async()=>touch?cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}):page.mouse.up();
    const drag=async(source,target,{cancel=false,blank=false}={})=>{
      await source.scrollIntoViewIfNeeded();const p=await center(source);await press(p);await move({x:p.x+12,y:p.y});
      assert.equal(await page.locator('.drag-ghost').count(),1,'native pointer drag starts');
      if(cancel){if(touch)await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});else{await page.keyboard.press('Escape');await release();}return;}
      if(blank){await move({x:3,y:100});await release();return;}
      const height=page.viewportSize().height;
      for(let i=0;i<70;i++){
        const pos=await center(target);
        if(pos.y>80&&pos.y<height-80)break;
        await move({x:Math.min(p.x,page.viewportSize().width-10),y:pos.y<80?10:height-10});
        await page.waitForTimeout(100);
      }
      const dest=await center(target);assert.ok(dest.y>0&&dest.y<height,'edge scrolling brings destination into view');
      // After edge scrolling, follow the visible slot rather than a stale pre-scroll coordinate.
      let aligned=false;
      for(let n=0;n<6;n++){
        const point=await center(target);await move(point);await page.waitForTimeout(60);
        aligned=await target.evaluate((el,p)=>el.contains(document.elementFromPoint(p.x,p.y)),point);
        if(aligned)break;
      }
      assert.ok(aligned,'pointer reaches the visible destination');await release();await page.waitForTimeout(50);
      assert.equal(await page.locator('.drag-ghost').count(),0);
    };
    const assertViewport=async()=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal page overflow');
    const screenshot=async name=>{await page.mouse.move(2,2);await page.screenshot({path:`test-results/shop-interaction/${touch?'phone':'desktop'}-${name}.png`,fullPage:false});};
    await fixture();await assertViewport();await screenshot('chest');
    let before=await save();
    const offer=()=>page.locator('[data-drag="offer"][data-source="chest"][data-index="0"]');
    await drag(offer(),gear(4,2),{cancel:true});assert.deepEqual(await save(),before,'cancellation leaves reward and money unchanged');
    await drag(offer(),gear(4,2),{blank:true});assert.deepEqual(await save(),before,'blank drop does not consume item');
    await drag(offer(),gear(4,2));
    let after=await save();if(!after.chest.claimed&&process.env.SHOP_DEBUG){console.log(JSON.stringify(await page.evaluate(()=>window.trace)));await page.screenshot({path:'test-results/shop-interaction/touch-failure.png'});console.log(await page.locator('#toast').textContent());}assert.equal(after.chest.claimed,true);assert.equal(after.party[4].gear[2].uid,before.chest.options[0].uid);assert.equal(after.gold,before.gold);
    assert.equal(await page.locator('.compare-popover').count(),0,'empty-slot drop equips directly');
    await assertViewport();await screenshot('shop');
    before=after;await drag(gear(4,0),gear(3,2));after=await save();
    assert.equal(after.party[4].gear[0],null);assert.equal(after.party[3].gear[2].uid,before.party[4].gear[0].uid);
    before=after;await drag(gear(3,0),gear(2,0));
    assert.equal(await page.locator('.compare-popover').count(),1);assert.deepEqual(await save(),before,'occupied transfer awaits confirmation');
    await assertViewport();await screenshot('comparison');
    await click('close-popover');assert.deepEqual(await save(),before);await click('cancel-selection');
    await drag(gear(3,0),gear(2,0));await click('confirm-acquire');after=await save();
    assert.equal(after.party[3].gear[0].uid,before.party[2].gear[0].uid);assert.equal(after.party[2].gear[0].uid,before.party[3].gear[0].uid);assert.equal(after.gold,before.gold);
    before=after;await drag(hero(4),hero(3));after=await save();assert.deepEqual(after.party[4],before.party[3]);assert.deepEqual(after.party[3],before.party[4]);
    const order=await page.locator('.hero-panel[data-unit]').evaluateAll(els=>els.map(el=>Number(el.dataset.unit)));assert.deepEqual(order,[4,3,2,1,0]);
    await gear(4,0).scrollIntoViewIfNeeded();await click('gear','[data-hero="4"][data-slot="0"]');
    assert.equal(await page.locator('.shop-popover').count(),1);assert.equal(await page.locator('.modal-backdrop').count(),0);assert.equal(await page.locator('#app').evaluate(el=>el.inert),false);
    await assertViewport();await screenshot('sale');before=await save();await click('sell-gear');after=await save();assert.equal(after.gold,before.gold+Math.floor(before.party[4].gear[0].price/2));assert.equal(after.party[4].gear[0],null);
    await page.reload();await click('continue');assert.deepEqual(await save(),after,'transactions and swapped formation persist');
    await fixture();before=await save();
    await drag(page.locator('[data-drag="offer"][data-source="chest"][data-index="2"]'),gear(1,2));assert.deepEqual(await save(),before,'second orange is rejected');assert.match(await page.locator('#toast').textContent(),/橙装/);
    await click('cancel-selection');
    await drag(page.locator('[data-drag="offer"][data-source="chest"][data-index="0"]'),gear(4,0));assert.deepEqual(await save(),before);assert.equal(await page.locator('.compare-popover').count(),1);
    await click('confirm-acquire');after=await save();assert.equal(after.party[4].gear[0].uid,before.chest.options[0].uid);assert.equal(after.gold,before.gold+Math.floor(before.party[4].gear[0].price/2));
    await fixture(true,0);before=await save();
    await drag(page.locator('[data-drag="offer"][data-source="shop"][data-index="0"]'),gear(4,2));assert.deepEqual(await save(),before,'insufficient gold does not consume stock');assert.match(await page.locator('#toast').textContent(),/金币/);
    await fixture(true);before=await save();
    await drag(page.locator('[data-drag="offer"][data-source="shop"][data-index="0"]'),gear(4,2));after=await save();assert.equal(after.gold,before.gold-before.shop[0].price);assert.equal(after.shop[0],null);assert.equal(after.party[4].gear[2].uid,before.shop[0].uid);
    await assertViewport();await context.close();console.log(`${touch?'Touch 390x844':'Mouse 2560x1440'}: reward/shop drag, empty/occupied slots, swap confirmation, hero positions, sale, persistence, cancellation, invalid orange/gold and viewport passed.`);
  }
  assert.deepEqual(errors,[]);console.log('Shop interaction checks passed with real mouse and CDP touch input.');
}finally{if(browser)await browser.close();server.kill('SIGTERM');}
