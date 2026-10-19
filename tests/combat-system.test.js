import test from 'node:test';
import assert from 'node:assert/strict';
import {BASE} from '../src/data.js';
import {Battle} from '../src/battle.js';
import * as M from '../src/model.js';
import {resolveStats} from '../src/combat/attributes.js';
import {setSource,removeSource,applyStatus,removeStatus,expireStatuses,isControlled} from '../src/combat/unit.js';
import {STATUSES,skillsFor} from '../src/combat/content.js';
import {TriggerQueue} from '../src/combat/events.js';
function arena(hero='stone',augments=[]) {
  const run=M.createRun(91);run.party=[{hero,gear:[null,null,null,null],auto:true}];run.phase='ready';run.augments=augments;
  return new Battle(run);
}
function configure(unit,values) {setSource(unit,'fixture',{modifiers:Object.entries(values).map(([stat,value])=>({id:stat,stat,op:'override',value,priority:100}))});}
function quiet(b) {for(const u of b.units()){u.nextAttack=Infinity;u.ready=u.skills.map(()=>Infinity);configure(u,{hpRegen:0,manaRegen:0});}}
function advance(b,count) {for(let i=0;i<count;i++)b.step();}

test('attribute sources combine in defined order and remove without drift, including rule priority',()=>{
  const base={...BASE,attack:100};
  const modifiers=[{id:'flat',stat:'attack',op:'flat',value:20},{id:'percent',stat:'attack',op:'percent',value:.5},{id:'multiply',stat:'attack',op:'multiply',value:2}];
  assert.equal(resolveStats(base,modifiers).attack,360);assert.deepEqual(resolveStats(base,modifiers),resolveStats(base,[...modifiers].reverse()));
  const b=arena(),u=b.party[0],original=u.stats.attack;
  setSource(u,'gear',{modifiers:[{id:'attack',stat:'attack',op:'flat',value:10}],rules:[{id:'aim',rule:'attackTarget',value:'slot3',priority:1}]});
  setSource(u,'buff',{modifiers:[{id:'attack',stat:'attack',op:'percent',value:1}],rules:[{id:'aim',rule:'attackTarget',value:'weakest',priority:2}]});
  assert.equal(u.stats.attack,(original+10)*2);assert.equal(u.rules.attackTarget,'weakest');
  removeSource(u,'buff');assert.equal(u.stats.attack,original+10);assert.equal(b.target(u).slot,2);
  removeSource(u,'gear');assert.equal(u.stats.attack,original);assert.equal(u.rules.attackTarget,'front');
});
test('refresh and capped stacks expire without removing independent sources or healing on max-HP changes',()=>{
  const b=arena(),u=b.party[0],armor=u.stats.armor;u.hp=100;
  const hpStatus={id:'vigor',name:'活力',duration:1,stacking:'refresh',modifiers:[{stat:'hp',op:'flat',value:100}]};
  const hp=applyStatus(u,hpStatus,'a',0);assert.equal(u.hp,100);removeStatus(u,hp.key);assert.equal(u.hp,100);
  applyStatus(u,STATUSES.fortify,u.id,0);applyStatus(u,STATUSES.fortify,u.id,25);
  assert.equal(u.stats.armor,armor+8);assert.equal(u.statuses.size,1);
  for(let i=0;i<5;i++)applyStatus(u,STATUSES.resonance,'augment',25);
  assert.equal(u.stats.armor,armor+8+12);assert.equal([...u.statuses.values()].find(s=>s.definition.id==='resonance').stacks,3);
  expireStatuses(u,175);assert.equal(u.stats.armor,armor+12);
  expireStatuses(u,225);assert.equal(u.stats.armor,armor);assert.equal(u.statuses.size,0);
});
test('heroes and monsters share skills, modifiers, statuses and ally targeting',()=>{
  const b=arena(),enemy=b.enemies[0];
  assert.deepEqual(Object.keys(enemy).sort(),Object.keys(b.party[0]).sort());
  enemy.skills=skillsFor('leaf');enemy.ready=[0,0,0,0];enemy.hp-=20;b.party[0].hp-=30;
  const heroHp=b.party[0].hp;assert.equal(b.cast(enemy,1),true);assert.equal(enemy.hp,enemy.stats.hp);assert.equal(b.party[0].hp,heroHp);
  applyStatus(enemy,STATUSES.fortify,enemy.id,0);assert.equal(enemy.stats.armor,enemy.baseStats.armor+8);
});
test('same-name statuses from independent sources remove independently; equal-priority rule winners are deterministic',()=>{
  const b=arena(),u=b.party[0],armor=u.stats.armor;
  const a=applyStatus(u,STATUSES.fortify,'source-a',0),z=applyStatus(u,STATUSES.fortify,'source-z',0);
  assert.equal(u.stats.armor,armor+16);removeStatus(u,a.key);assert.equal(u.stats.armor,armor+8);
  removeStatus(u,z.key);assert.equal(u.stats.armor,armor);
  const rules=id=>({rules:[{id:'target',rule:'attackTarget',value:id==='a'?'front':'slot3',priority:2}]});
  setSource(u,'z',rules('z'));setSource(u,'a',rules('a'));assert.equal(u.rules.attackTarget,'slot3');
  removeSource(u,'a');removeSource(u,'z');setSource(u,'a',rules('a'));setSource(u,'z',rules('z'));assert.equal(u.rules.attackTarget,'slot3');
});
test('simultaneous instant skills use priority and recheck mana; they do not reset attack timing',()=>{
  const b=arena('tide');quiet(b);const u=b.party[0];u.mana=25;u.nextAttack=5;
  u.skills=[10,30,20].map((priority,i)=>({id:`s${i}`,key:`S${i}`,name:'护盾',priority,cost:10,cooldown:1,castTime:0,target:'self',effects:[{type:'shield',amount:1}]}));u.ready=[0,0,0];u.skillModes=['auto','auto','auto'];
  b.step();assert.equal(u.mana,5);assert.equal(u.shield,2);assert.equal(u.nextAttack,5);
  assert.deepEqual(b.events.history.filter(e=>e.type==='castStart').map(e=>e.skill),['s1','s2']);
  assert.equal(u.ready[0],0);
});
test('skill rule overrides affect cost and cooldown and preview checks never consume RNG',()=>{
  const b=arena('tide'),u=b.party[0];quiet(b);u.ready[0]=0;u.mana=0;
  setSource(u,'test-rule',{rules:[{id:'cost',rule:'skill.Q.cost',value:0},{id:'cd',rule:'skill.Q.cooldown',value:2}]});
  const seed=b.rng.seed;for(let i=0;i<50;i++)assert.equal(b.skillReason(u,0),'就绪');assert.equal(b.rng.seed,seed);
  assert.equal(b.cast(u,0),true);assert.equal(u.mana,0);assert.equal(u.ready[0],Math.ceil(2/(1+u.stats.haste/100)/.02));
});
test('cast time occupies actions; tenacity shortens stun and interruption retains spent mana and cooldown',()=>{
  const b=arena();quiet(b);const u=b.party[0];u.ready[3]=0;u.nextAttack=0;
  assert.equal(b.cast(u,3),true);assert.ok(u.casting);const mana=u.mana,ready=u.ready[3];
  advance(b,5);assert.equal(b.shots.length,0,'casting prevents a new basic attack');
  configure(u,{hpRegen:0,manaRegen:0,tenacity:.4});
  b.addStatus(b.enemies[0],u,'stun');b.flushTriggers();
  assert.equal(u.casting,null);assert.equal(u.mana,mana);assert.equal(u.ready[3],ready);
  assert.equal([...u.statuses.values()][0].expiresAt,b.tick+15);
  advance(b,14);assert.ok(isControlled(u));b.step();assert.equal(isControlled(u),false);
  assert.ok(!b.events.history.some(e=>e.type==='cast'&&e.skill==='stone-R'));
});
test('a projectile already in flight still settles while its source is stunned',()=>{
  const b=arena('tide');quiet(b);const source=b.party[0],target=b.enemies[0];
  const hp=target.hp;configure(source,{hpRegen:0,manaRegen:0,attack:10,crit:0});
  b.fire(source,target,{duration:.1});b.addStatus(target,source,'stun');advance(b,5);
  assert.ok(target.hp<hp);assert.ok(isControlled(source));
});
test('cast release retargets only when configured; impact effects apply only after impact',()=>{
  for(const retarget of ['release','none']) {
    const b=arena();quiet(b);const u=b.party[0];u.skills[0].retarget=retarget;u.ready[0]=0;
    b.cast(u,0);assert.equal(b.shots.length,0);
    b.enemies[0].hp=0;b.enemies[0].respawnAt=Infinity;
    advance(b,13);
    if(retarget==='none'){assert.equal(b.shots.length,0);assert.ok(b.events.history.some(e=>e.type==='fizzle'));}
    else {assert.equal(b.shots[0].target,b.enemies[1].id);assert.equal(b.enemies[1].statuses.size,0);advance(b,10);assert.ok(isControlled(b.enemies[1]));}
  }
});
test('impact snapshots resist later stat changes and fully shielded hits do not trigger damage-taken passive',()=>{
  const b=arena();quiet(b);const u=b.party[0],enemy=b.enemies[0];
  const shot=b.fire(enemy,u,{duration:.1});const originalDamage=shot.damage;
  applyStatus(u,STATUSES.fortify,'other',0);u.shield=originalDamage+1;
  b.settle(shot);assert.equal(u.hp,u.stats.hp);assert.equal(u.statuses.size,1);
  assert.ok(!u.triggerReady.has('passive:stone'));
});
test('stone shield, orange equipment healing and augment stacking form one working chain',()=>{
  const run=M.createRun(77);run.phase='ready';run.augments=['resonant-guard'];run.party=[{hero:'stone',gear:[M.makeItem(run,5,'rune'),null,null,null],auto:true}];
  const b=new Battle(run),u=b.party[0];quiet(b);u.hp=100;u.ready[2]=0;
  assert.equal(u.stats.hp,560);assert.equal(b.cast(u,2),true);
  assert.equal(u.hp,108);assert.ok(u.shield>0);
  assert.equal(u.stats.armor,30+8+4);
  const events=b.events.history.map(e=>e.type);assert.ok(events.includes('shield')&&events.includes('heal')&&events.includes('status'));
  assert.equal(b.events.suppressed,0);
});
test('orange clock triggers on critical impact rather than projectile launch',()=>{
  const run=M.createRun(7);run.phase='ready';run.party=[{hero:'wind',gear:[M.makeItem(run,5,'clock'),null,null,null],auto:true}];
  const b=new Battle(run),u=b.party[0];quiet(b);configure(u,{hpRegen:0,manaRegen:0,crit:1});
  const speed=u.stats.attackSpeed,shot=b.fire(u,b.enemies[0]);assert.equal(u.statuses.size,0);
  b.settle(shot);assert.ok(Math.abs(u.stats.attackSpeed-speed-.15)<1e-10);assert.ok([...u.statuses.values()].some(s=>s.definition.id==='tempo'));
});
test('reciprocal zero-cooldown retaliation terminates, independent attacks can trigger again, and rewards occur once',()=>{
  const b=arena('tide');quiet(b);const a=b.party[0],z=b.enemies[0];
  for(const u of [a,z]){configure(u,{hp:1000,hpRegen:0,manaRegen:0,armor:0,attack:10,crit:0});u.hp=1000;u.triggers=[{id:'reflect',event:'damaged',relation:'target',effects:[{type:'damage',target:'attacker',amount:1,damageType:'physical'}]}];}
  b.settle(b.fire(a,z));assert.equal(z.hp,989);assert.equal(a.hp,999);assert.equal(b.events.pending.length,0);assert.ok(b.events.suppressed>0);
  b.settle(b.fire(a,z));assert.equal(z.hp,978);assert.equal(a.hp,998);
  z.hp=1;const shot=b.fire(a,z);b.settle(shot);b.settle(shot);assert.equal(b.kills,1);
});
test('lethal critical impact records stable hit, critical, damaged, lifesteal, kill and death order',()=>{
  const b=arena('tide');quiet(b);const source=b.party[0],target=b.enemies[0];
  configure(source,{attack:100,crit:1,lifeSteal:.1,hpRegen:0,manaRegen:0});source.hp=100;target.hp=1;
  const shot=b.fire(source,target);b.settle(shot);
  assert.deepEqual(b.events.history.map(e=>e.type),['attack','hit','critical','damaged','heal','kill','death']);
  assert.equal(source.hp,100.1);assert.equal(b.kills,1);
  assert.equal(new Set(b.events.history.slice(1).map(e=>e.root)).size,1,'impact and its reactions share one root budget');
});
test('trigger FIFO order, path guard, depth and root budgets are bounded without dropping unrelated roots',()=>{
  const q=new TriggerQueue({maxDepth:2,maxEvents:8});const order=[];
  q.enqueue({type:'A'});q.enqueue({type:'B'});
  q.drain(e=>{order.push(e.type);if(e.type==='A')q.branch('one',()=>q.enqueue({type:'C'}));if(e.type==='C')q.branch('one',()=>q.enqueue({type:'bad'}));});
  assert.deepEqual(order,['A','B','C']);assert.equal(q.suppressed,1);
  q.enqueue({type:'fan'});let count=0;q.drain(()=>{count++;q.branch(`branch-${count}`,()=>{for(let i=0;i<20;i++)q.enqueue({type:'child'});});});
  assert.equal(count,8);assert.equal(q.pending.length,0);assert.ok(q.suppressed>1);
  q.enqueue({type:'independent'});q.drain(()=>count++);assert.equal(count,9);
});
test('augment selection persists, affects future recruits, rejects duplicates and migrates old saves',()=>{
  const r=M.createRun(3);M.recruit(r,r.candidates[0]);M.recruit(r,r.candidates[0]);M.finishRound(r,{won:true,gold:30,kills:10});
  assert.throws(()=>M.chooseAugment(r,'resonant-guard'));M.sellReward(r,0);M.chooseAugment(r,'resonant-guard');assert.throws(()=>M.chooseAugment(r,'resonant-guard'));
  const restored=M.parseSave(JSON.stringify(r));assert.deepEqual(restored.augments,['resonant-guard']);
  M.nextFloor(restored);M.recruit(restored,restored.candidates[0]);const member=restored.party.at(-1);
  assert.equal(M.statsFor(member,restored.level,restored.augments).hp,M.statsFor(member,restored.level).hp+40);
  const b=new Battle(restored);assert.equal(b.party.at(-1).stats.hp,M.statsFor(member,restored.level,restored.augments).hp);
  delete r.augments;assert.deepEqual(M.parseSave(JSON.stringify(r)).augments,[]);
  r.augments=['unknown'];assert.equal(M.parseSave(JSON.stringify(r)),null);
});
