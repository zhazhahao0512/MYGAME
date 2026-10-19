import {chromium} from 'playwright-core';
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const port=Number(process.env.CASTING_TEST_PORT||5198),url=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,['scripts/server.mjs'],{env:{...process.env,PORT:String(port)},stdio:'pipe'});
let browser,activePage;const errors=[],metrics=[];
try{
 let ready=false;for(let i=0;i<100;i++){try{if((await fetch(url)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(ready,'local server starts');
 await mkdir('test-results/casting',{recursive:true});
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 for(const [width,height] of [[2560,1440],[1440,900],[844,390],[740,360]]){
  console.log(`Checking casting at ${width}x${height}`);
  const touch=width<1000,ctx=await browser.newContext({viewport:{width,height},hasTouch:touch,isMobile:touch}),page=await ctx.newPage();activePage=page;page.on('pageerror',e=>errors.push(e.message));
  const click=async(selector)=>{const el=page.locator(selector).filter({visible:true}).first();if(touch)await el.tap();else await el.click();};
  const mode=n=>`[data-act="skill-mode"][data-hero="2"][data-skill="${n}"]`;
  const tick=()=>page.locator('#battle-canvas').getAttribute('data-tick');
  await page.goto(url);await page.clock.install();await click('[data-act="preview-menu"]');await click('[data-act="preview"][data-page="battle"]');await page.locator('#battle-canvas[data-engine]').waitFor();
  await page.clock.pauseAt(new Date((await page.evaluate(()=>Date.now()))+1000));await click('[data-act="select-unit"][data-hero="2"]');
  assert.equal(await page.locator('.skill-mode').count(),4);assert.deepEqual(await page.locator('.skill-mode').evaluateAll(es=>es.map(e=>e.dataset.mode)),Array(4).fill('managed'));
  assert.deepEqual(await page.locator('.skill-cell .skill b').allTextContents(),['1','2','3','4']);
  const start=await tick();
  for(const expected of ['auto','manual','managed']){await click(mode(0));assert.equal(await page.locator(mode(0)).getAttribute('data-mode'),expected);assert.equal(await page.locator(mode(1)).getAttribute('data-mode'),'managed');assert.equal(await page.locator('.inspection-card').count(),0);}
  assert.equal(await tick(),start,'mode settings do not directly advance the battle');
  // A pinned inspection must remain paused while switching a sibling mode button.
  await click('[data-act="skill"][data-hero="2"][data-skill="0"]');let paused=await tick();await click(mode(0));await page.clock.runFor(300);assert.equal(await tick(),paused);assert.equal(await page.locator('.inspection-card').count(),1);
  await click('[data-inspection-close]');
  // Set all four to manual, including each independent ordinary skill.
  for(let n=0;n<4;n++){for(let attempt=0;attempt<3&&await page.locator(mode(n)).getAttribute('data-mode')!=='manual';attempt++)await click(mode(n));assert.equal(await page.locator(mode(n)).getAttribute('data-mode'),'manual');}
  console.log('Independent modes ready');
  assert.equal(await page.locator('[data-act="cast-skill"]:visible').count(),4);
  await click('[data-act="select-unit"][data-hero="1"]');assert.deepEqual(await page.locator('.skill-mode').evaluateAll(es=>es.map(e=>e.dataset.mode)),Array(4).fill('managed'));
  await click('[data-act="select-unit"][data-hero="2"]');assert.deepEqual(await page.locator('.skill-mode').evaluateAll(es=>es.map(e=>e.dataset.mode)),Array(4).fill('manual'));
  console.log('Checking manual cast');await page.mouse.move(1,1);await page.clock.runFor(5400);
  const release=page.locator('[data-act="cast-skill"][data-hero="2"][data-skill="2"]');assert.equal(await release.isDisabled(),false,'ordinary shield can be clicked');
  await click('[data-act="skill"][data-hero="2"][data-skill="2"]');paused=await tick();await page.clock.runFor(100);assert.equal(await tick(),paused);
  await click('[data-act="cast-skill"][data-hero="2"][data-skill="2"]');assert.equal(await page.locator('.inspection-card').count(),0);assert.equal(await release.isDisabled(),true,'manual ordinary skill spends once');
  const resources=await page.locator('[data-resources="2"]').textContent();await release.evaluate(e=>e.dispatchEvent(new MouseEvent('click',{bubbles:true})));assert.equal(await page.locator('[data-resources="2"]').textContent(),resources);
  // A visibility pause is not released by a keyboard skill command.
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});paused=await tick();await page.keyboard.press('1');await page.clock.runFor(100);assert.equal(await tick(),paused);
  await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});await click('[data-act="close"]');
  console.log('Checking bounds');const layout=await page.evaluate(()=>{
   const selectors=['.skill-mode','.skill-cell>.skill','.skills>.passive','.manual-skills>.cast-skill:not([hidden])','.gear-slot'];
   const boxes=selectors.flatMap(s=>[...document.querySelectorAll('.hero-panel '+s)].map(e=>{const r=e.getBoundingClientRect();return {selector:s,x:r.x,y:r.y,w:r.width,h:r.height,label:e.getAttribute('aria-label')};}));
   return {width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight,boxes};
  });
  assert.equal(layout.overflow,false);
  for(const b of layout.boxes){assert.ok(b.x>=0&&b.y>=0&&b.x+b.w<=width+.5&&b.y+b.h<=height+.5,`visible ${b.label}`);assert.ok(b.w>=24&&b.h>=24,`target size ${b.label}`);}
  for(let i=0;i<layout.boxes.length;i++)for(let j=i+1;j<layout.boxes.length;j++){
   const a=layout.boxes[i],b=layout.boxes[j];assert.ok(Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)<=.5||Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)<=.5,`hit targets overlap: ${a.label}, ${b.label}`);
  }
  await page.screenshot({path:`test-results/casting/${width}x${height}-manual.png`});await page.locator('.squad-section').screenshot({path:`test-results/casting/${width}x${height}-skills.png`});
  for(let n=0;n<4;n++)await click(mode(n));await page.screenshot({path:`test-results/casting/${width}x${height}-managed.png`});
  metrics.push(layout);await ctx.close();
 }
 // Real saved run: changes in battle survive reload; it restarts the round by the existing save contract.
 const page=await browser.newPage({viewport:{width:1440,height:900}});activePage=page;await page.goto(url);
 await page.evaluate(async()=>{const M=await import('/src/model.js');const run=M.createRun(17);M.recruit(run,run.candidates[0]);M.recruit(run,run.candidates[0]);localStorage.setItem(M.SAVE_KEY,JSON.stringify(run));});
 await page.reload();await page.locator('[data-act="continue"]').click();await page.locator('[data-act="start-battle"]').click();await page.locator('#battle-canvas[data-engine]').waitFor();
 const first=page.locator('[data-act="skill-mode"][data-skill="0"]');await first.click();await first.click();
 const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('squad-expedition.save.v1')));assert.equal(stored.party[0].skillModes[0],'manual');
 await page.reload();await page.locator('[data-act="continue"]').click();await page.locator('[data-act="start-battle"]').click();await page.locator('#battle-canvas[data-engine]').waitFor();assert.equal(await page.locator('[data-act="skill-mode"][data-skill="0"]').getAttribute('data-mode'),'manual');
 assert.deepEqual(errors,[]);await writeFile('test-results/casting/layout.json',JSON.stringify(metrics,null,2));console.log('Casting UI passed: 4 sizes, native touch, independent cycle, no hit overlap, ordinary manual cast, pause boundaries, hero switching and saved-run reload.');
}catch(error){if(activePage&&!activePage.isClosed())await activePage.screenshot({path:'test-results/casting/failure.png'}).catch(()=>{});throw error;}finally{await browser?.close();server.kill('SIGTERM');}
