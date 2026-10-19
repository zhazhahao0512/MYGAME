// Regression: reduced motion must not erase attack travel or change simulation outcomes.
import {chromium} from 'playwright-core';
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const port=Number(process.env.ANIMATION_TEST_PORT||5221),url=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,['scripts/server.mjs'],{env:{...process.env,PORT:String(port)},stdio:'ignore'});
let browser;const errors=[],results=[];
try {
 for(let i=0;i<100;i++){try{if((await fetch(url)).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 await mkdir('test-results/attack-animation',{recursive:true});
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 // Exercise the real app's OS preference and saved browser setting, not just a renderer option.
 for(const [name,reducedMotion,savedMotion] of [['normal','no-preference',null],['system-reduced','reduce',null],['saved-reduced','no-preference',false]]) {
  const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion});
  if(savedMotion!==null)await context.addInitScript(value=>localStorage.setItem('squad.settings',JSON.stringify({motion:value})),savedMotion);
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);await page.clock.install();
  await page.locator('[data-act="preview-menu"]').click();await page.locator('[data-page="battle"]').click();
  const host=page.locator('#battle-canvas');await page.locator('#battle-canvas[data-engine="phaser"]').waitFor();
  await page.clock.runFor(1200);
  const before=await host.evaluate(el=>({...el.dataset}));assert.ok(Number(before.projectiles)>0,`${name}: attacks remain visible`);
  if(name!=='normal')assert.equal(Number(before.particles),0,'reduced motion still suppresses decorative particles');
  await page.screenshot({path:`test-results/attack-animation/${name}-flight.png`});
  await page.locator('[data-act="pause"]').click();const paused=await host.getAttribute('data-tick');await page.clock.runFor(300);assert.equal(await host.getAttribute('data-tick'),paused);
  await page.locator('[data-act="close"]').filter({visible:true}).first().click();await page.clock.runFor(200);assert.ok(Number(await host.getAttribute('data-tick'))>Number(paused));
  results.push({name,tick:before.tick,projectiles:before.projectiles,particles:before.particles});await context.close();
 }
 // Test-only fixture: actual Battle.fire + actual Phaser scene, advance exclusively by combat ticks.
 // Fixed snapshots allow both attack kinds, identical outcomes and replacement IDs to be checked.
 const page=await browser.newPage({viewport:{width:1440,height:900}});page.on('pageerror',e=>errors.push(e.message));await page.goto(url);
 const trace=await page.evaluate(async()=>{
  const [{Battle},{createRun},{PhaserBattleRenderer}]=await Promise.all([import('/src/battle.js'),import('/src/model.js'),import('/src/renderer/PhaserBattleRenderer.ts')]);
  document.body.innerHTML='<div id="animation-stage" style="width:1400px;height:650px"></div>';
  const run=createRun(42);run.phase='ready';run.party=['wind','lanya','blade'].map(hero=>({hero,gear:[null,null,null,null]}));
  const battle=new Battle(run),control=new Battle(structuredClone(run));
  for(const b of [battle,control]){for(const u of b.units())u.nextAttack=Infinity;b.fire(b.party[0],b.enemies[1],{duration:1});b.fire(b.party[1],b.enemies[2],{duration:1,skill:true,canMiss:false,originId:'animation-check'});b.fire(b.party[2],b.enemies[3],{duration:1,canMiss:false});}
  const state={motion:true,paused:false};const host=document.querySelector('#animation-stage');
  const renderer=new PhaserBattleRenderer(host,battle,{advance(){},selected:()=>0,select(){},motion:()=>state.motion,paused:()=>state.paused});
  await new Promise(resolve=>{const check=()=>host.dataset.engine?resolve():setTimeout(check,20);check();});
  const scene=renderer.game.scene.getScene('battle');
  const frame=()=>{scene.update(0,0);return scene.projectiles.filter(p=>p.dot.visible).map(p=>({texture:p.dot.texture.key,tint:p.dot.tintTopLeft,x:p.dot.x,y:p.dot.y,size:p.dot.displayWidth,glow:p.glow.visible}));};
  const snapshots=[];
  for(const tick of [5,15,25]){
   while(battle.tick<tick){battle.step();control.step();}
   state.motion=true;const normal=frame();state.motion=false;const reduced=frame();snapshots.push({tick,normal,reduced});
  }
  window.__attackAnimation={battle,renderer,state,frame,control};
  const snapshot=b=>({tick:b.tick,rng:b.rng.seed,units:b.units().map(u=>[u.id,u.hp,u.mana,u.shield]),gold:b.gold,kills:b.kills,shots:b.shots,effects:b.effects});
  return {snapshots,equal:JSON.stringify(snapshot(battle))===JSON.stringify(snapshot(control))};
 });
 assert.equal(trace.equal,true,'rendering on/off does not change combat');
 for(const f of trace.snapshots){assert.equal(f.normal.length,3);assert.equal(f.reduced.length,3);assert.deepEqual(f.normal.map(p=>p.x),f.reduced.map(p=>p.x));assert.deepEqual(f.normal.map(p=>p.texture),['attack-arrow','attack-slash','attack-spell']);assert.deepEqual(f.normal.map(p=>p.tint),[0xa9c7a3,0xd69682,0xacc6a1]);assert.ok(f.reduced.every(p=>!p.glow));}
 assert.notEqual(trace.snapshots[0].reduced[0].x,trace.snapshots[2].reduced[0].x,'basic projectile travels');
 assert.notEqual(trace.snapshots[0].reduced[2].x,trace.snapshots[2].reduced[2].x,'skill projectile travels');
 assert.equal(trace.snapshots[0].reduced[1].x,trace.snapshots[2].reduced[1].x,'melee windup remains at source');
 await page.screenshot({path:'test-results/attack-animation/reduced-mid-flight.png'});
 const ending=await page.evaluate(()=>{
  const {battle:b,control:c,renderer:r,frame}=window.__attackAnimation;const scene=r.game.scene.getScene('battle');const earlyStrikes=scene.strikes.filter(s=>s.image.visible).length;
  // Replace the exact target slot. The old shot must not be drawn toward the new unit.
  const old=b.enemies[1].id;b.enemies[1]=b.spawn(1);const newId=b.enemies[1].id;const visible=frame().length;
  // Separate unchanged control completes both real shots on their scheduled impact tick.
  const beforeHp=c.enemies[2].hp;while(c.tick<49)c.step();const beforeImpact=c.enemies[2].hp;c.step();const afterImpact=c.enemies[2].hp;
  while(b.tick<50)b.step();frame();const impactStrikes=scene.strikes.filter(s=>s.image.visible).map(s=>s.image.tintTopLeft);
  r.destroy();return {old,newId,visible,beforeHp,beforeImpact,afterImpact,earlyStrikes,impactStrikes};
 });
 assert.notEqual(ending.old,ending.newId);assert.equal(ending.visible,2,'same-slot replacement hides the invalid old projectile');
 assert.equal(ending.beforeImpact,ending.beforeHp);assert.ok(ending.afterImpact<ending.beforeImpact,'skill settles at arrival');
 assert.equal(ending.earlyStrikes,0);assert.deepEqual(ending.impactStrikes,[0xd69682],'melee slash only appears on real impact, in source color');
 assert.deepEqual(errors,[]);
 await writeFile('test-results/attack-animation/results.json',JSON.stringify({results,trace,ending},null,2));
 console.log('Attack animation checks passed: real app defaults/system/saved reduced motion; basic and skill travel, pause/resume, unchanged combat, impact tick and replacement isolation.');
}finally{await browser?.close();server.kill('SIGTERM');}
