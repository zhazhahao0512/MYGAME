import {chromium} from 'playwright-core';
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const port=Number(process.env.VISUAL_TEST_PORT||5197),url=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,['scripts/server.mjs'],{env:{...process.env,PORT:String(port)},stdio:'pipe'});
let browser;const errors=[],metrics=[];
try{
 let ready=false;for(let n=0;n<100;n++){try{if((await fetch(url)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(ready);
 await mkdir('test-results/battle-visual',{recursive:true});
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 for(const [width,height] of [[2560,1440],[1440,900],[844,390],[740,360]]){
  const touch=width<1000,context=await browser.newContext({viewport:{width,height},hasTouch:touch,isMobile:touch,deviceScaleFactor:1}),page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  const click=async(action,extra='')=>{const el=page.locator(`[data-act="${action}"]${extra}`).filter({visible:true}).first();if(touch)await el.tap();else await el.click();};
  await page.goto(url);await page.clock.install();await click('preview-menu');await click('preview','[data-page="battle"]');await page.locator('#battle-canvas[data-engine]').waitFor();
  await page.clock.pauseAt(new Date((await page.evaluate(()=>Date.now()))+1000));
  await page.evaluate(async()=>{const img=new Image();img.src='/art/gothic-courtyard.png';await img.decode();});
  await click('select-unit','[data-hero="2"]');
  const box=await page.locator('canvas').boundingBox(),actors=JSON.parse(await page.locator('#battle-canvas').getAttribute('data-actors')),enemy=actors.find(a=>a.side==='enemy'&&a.index===4);
  if(touch)await page.touchscreen.tap(box.x+enemy.x,box.y+enemy.y);else await page.mouse.click(box.x+enemy.x,box.y+enemy.y);
  await click('accept-challenge');if(touch)await click('detail-loadout');
  await page.clock.runFor(3600);
  if(!touch){
   // Inspect a living opponent through the actual UI so the review image includes its resource panel.
   await click('inspect-enemy');
   const living=page.locator('.enemy-selector [data-act="select-enemy"]').filter({hasText:/号/});
   if(await living.count()){await living.last().click();await page.clock.runFor(50);}
  }
  const layout=await page.evaluate(()=>{
   const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom};};
   return {fontsLoaded:[...document.fonts].filter(f=>f.family.includes('Expedition Serif')).every(f=>f.status==='loaded')&&document.fonts.check('20px "Expedition Serif"'),width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight,details:rect('.battle-details'),arena:rect('#battle-canvas'),titleSize:getComputedStyle(document.querySelector('.challenge-heading h2')).fontSize,background:getComputedStyle(document.querySelector('#battle-canvas')).backgroundImage,actors:JSON.parse(document.querySelector('#battle-canvas').dataset.actors)};
  });
  assert.equal(layout.overflow,false);
  assert.equal(layout.fontsLoaded,true,'local battle fonts loaded before rendering');
  assert.match(layout.background,/gothic-courtyard/);
  for(const a of layout.actors){assert.ok(a.x-a.width/2>=0&&a.x+a.width/2<=layout.arena.width);assert.ok(a.y-a.height/2>=0&&a.y+a.height/2<=layout.arena.height);}
  if(!touch){assert.ok(layout.details.height/height<.36,'bottom details stay compact');assert.ok(layout.actors.every(a=>a.height/a.width<=2),'no tall empty portrait rectangles');assert.ok(parseFloat(layout.titleSize)>=24,'desktop headings remain legible');}
  else assert.ok(await page.locator('.hero-panel.selected .skill,.hero-panel.selected .gear-slot').evaluateAll(els=>els.every(el=>{const r=el.getBoundingClientRect();return r.height>=44&&r.bottom<=innerHeight;})),'touch controls fit');
  await page.screenshot({path:`test-results/battle-visual/${width}x${height}.png`});
  if(!touch){
   await page.locator('.squad-section').screenshot({path:`test-results/battle-visual/${width}x${height}-hero-stats.png`});
   await click('attributes');assert.match(await page.locator('.attribute-toggle').textContent(),/次要/);
   assert.equal((await page.locator('.battle-details').boundingBox()).height,layout.details.height,'attribute pages keep the same bottom-panel height');
   assert.ok(await page.locator('.hero-panel .stat-grid>div').evaluateAll(cells=>cells.every(cell=>{
    const label=cell.querySelector('span'),value=cell.querySelector('b'),l=label.getBoundingClientRect(),v=value.getBoundingClientRect(),c=cell.getBoundingClientRect();
    return label.scrollWidth<=label.clientWidth&&l.right<=v.left&&v.right<=c.right&&v.bottom<=c.bottom;
   })),'secondary attribute labels and values remain readable without overlap');
   await page.screenshot({path:`test-results/battle-visual/${width}x${height}-secondary.png`});
   await page.locator('.squad-section').screenshot({path:`test-results/battle-visual/${width}x${height}-hero-stats-secondary.png`});
   await click('auto','[data-hero="2"]');
   const cast=await page.locator('.cast-ultimate').boundingBox(),automatic=await page.locator('.auto-toggle').boundingBox();
   assert.ok(cast&&automatic&&cast.x>=automatic.x+automatic.width,'manual ultimate does not cover the auto toggle');
   const name=await page.locator('.hero-panel .hero-name').boundingBox(),role=await page.locator('.detail-position').boundingBox();
   assert.ok(name.y+name.height<=role.y+.5,'hero name and role do not overlap');
  }
  metrics.push(layout);await context.close();
 }
 assert.deepEqual(errors,[]);await writeFile('test-results/battle-visual/layout.json',JSON.stringify(metrics,null,2));
 console.log('Visual layout checks passed: real 2K/1440/844/740 screenshots, background loaded, compact cards, readable headings, touch controls and secondary attributes.');
 console.log(metrics.map(m=>({size:`${m.width}x${m.height}`,detailsRatio:Number((m.details.height/m.height).toFixed(3))})));
}finally{if(browser)await browser.close();server.kill('SIGTERM');}
