import test from 'node:test';
import assert from 'node:assert/strict';
import {Battle} from '../src/battle.js';
import * as M from '../src/model.js';
import {initializeProgression,recommendedRanks} from '../src/heroes/progression.js';
import {setSource} from '../src/combat/unit.js';
import {initializeEquipment} from '../src/combat/equipment.js';
import {loadoutModifiers} from '../src/combat/content.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
function arena(level=15,ranks=recommendedRanks(level)){
 const run=M.createRun(42);run.level=level;run.party=[{hero:'lanya',gear:[null,null,null,null],skillModes:Array(4).fill('manual')}];run.phase='ready';initializeProgression(run.party[0],level,42);run.party[0].progression.ranks=ranks;
 const b=new Battle(run,{duration:1000});b.nextSpawn=Infinity;for(const u of b.units()){u.nextAttack=Infinity;u.ready=u.skills.map(()=>0);u.skillModes=u.skills.map(()=> 'manual');u.stats.hpRegen=0;u.stats.manaRegen=0;u.stats.accuracy=1000;}for(const t of b.enemies){t.hp=10000;t.stats.hp=10000;t.stats.armor=50;t.stats.resist=50;}
 return {b,u:b.party[0],target:b.enemies[0],run};
}
test('live Lanya panel and learned ranks use additive AS before total multiplier',()=>{
 const {b,u}=arena();near(u.stats.attackSpeed,1.365364);near(u.stats.power,0);
 setSource(u,'gear-test',{modifiers:[{stat:'attackSpeed',op:'percent',value:.4}]});near(u.stats.attackSpeed,.91*(1+.364+.4)*1.1);
 assert.equal(b.cast(u,1),true);near(u.stats.attackSpeed,.91*(1+.364+.4+.7)*1.1);
 assert.equal(b.cast(u,3),true);near(u.stats.attackSpeed,.91*(1+.364+.4+.7)*1.1);assert.equal(b.skillReason(u,0),'大招维持中');
});
test('launch consumes five charges including misses; main hit refunds only its own cooldown once',()=>{
 const {b,u,target}=arena();b.cast(u,0);u.ready[1]=500;u.stats.accuracy=0;
 const miss=b.fire(u,target);assert.equal(u.edgeCharges,4);assert.equal(miss.hit,false);b.settle(miss);assert.equal(u.ready[1],500);assert.equal(target.hp,10000);
 u.stats.accuracy=1000;const shot=b.fire(u,target);const hp=target.hp;target.shield=10;b.settle(shot);near(u.ready[1],487.5);near(hp-target.hp+10,shot.damage+shot.heroPayload.parts.reduce((n,p)=>n+p.damage,0));
 assert.equal(b.events.history.filter(e=>e.type==='hit'&&e.source===u.id).length,1);
 const ready=u.ready[1];b.settle(shot);assert.equal(u.ready[1],ready);
});
test('three arrows are distinct and never consume charges or refund CD; buff precedes their snapshots',()=>{
 const {b,u}=arena();u.stats.accuracy=95;b.cast(u,0);u.ready[1]=500;const mana=u.mana;
 assert.equal(b.cast(u,2),true);const arrows=b.shots.filter(s=>s.skillKey==='3');assert.equal(arrows.length,3);assert.equal(new Set(arrows.map(s=>s.target)).size,3);assert.equal(u.stats.accuracy,110);assert.equal(u.stats.evasion,9);
 near(mana-u.mana,52);for(const shot of arrows){assert.equal(shot.heroPayload,undefined);assert.equal(shot.vamp,0);b.settle(shot);}assert.equal(u.edgeCharges,5);assert.equal(u.ready[1],500);
 const single=arena();single.b.enemies.slice(1).forEach(t=>t.hp=0);single.b.cast(single.u,2);assert.equal(single.b.shots.length,1);
});
test('ultimate launch snapshots survive expiration; no remnant charges/speed or unlearned abilities',()=>{
 const {b,u,target}=arena();b.cast(u,0);b.cast(u,1);const c1=u.ready[0],c2=u.ready[1];b.cast(u,3);assert.equal(u.ready[0],c1);assert.equal(u.ready[1],c2);
 const shot=b.fire(u,target,{duration:20});assert.equal(shot.heroPayload.parts[0].damage,60);for(let i=0;i<500;i++)b.step();
 assert.equal(u.edgeCharges,0);near(u.stats.attackSpeed,1.365364);assert.equal(b.fire(u,target).heroPayload.parts.length,1);b.settle(shot);assert.equal(shot.heroPayload.parts[0].damage,60);
 const unlearned=arena(15,[0,0,0,3]);unlearned.b.cast(unlearned.u,3);assert.equal(unlearned.b.fire(unlearned.u,unlearned.target).heroPayload.parts.length,1);near(unlearned.u.stats.attackSpeed,1.365364);
});
test('true damage respects shields, shield-piercing magic respects MR, all damage can miss',()=>{
 const {b,u,target}=arena();target.stats.reduction=.8;target.shield=100;
 const trueShot=b.fire(u,target,{skill:true,amount:50,attack:0,power:0,damageType:'true',duration:0});b.settle(trueShot);assert.equal(target.shield,50);assert.equal(target.hp,10000);
 const magic=b.fire(u,target,{skill:true,amount:150,attack:0,power:0,damageType:'shield_piercing_magic'});b.settle(magic);near(target.hp,9980);assert.equal(target.shield,50);
 u.stats.accuracy=0;assert.equal(b.fire(u,target,{skill:true,damageType:'true'}).hit,false);
});
test('late recruits have all earned points, unlearned skills cannot cast, skill/growth/save rules persist',()=>{
 const r=M.createRun(9);r.level=16;r.candidates=['lanya','stone','wind'];M.recruit(r,'lanya');assert.equal(M.progressionSummary(r.party[0],16).points,15);
 r.phase='ready';const b=new Battle(r);assert.equal(b.skillReason(b.party[0],0),'未学习');M.recommendSkills(r,0);assert.deepEqual(r.party[0].progression.ranks,[4,4,4,3]);
 const restored=M.parseSave(JSON.stringify(r));assert.ok(restored);assert.deepEqual(restored.party[0].progression,r.party[0].progression);
 const later=M.statsFor(r.party[0],20);assert.ok(later.hp>M.statsFor(r.party[0],16).hp);assert.equal(later.power,0);
});
test('managed Lanya actually uses its buff kit and reserves for ultimate without hidden RNG',()=>{
 const {b,u}=arena();u.skillModes=Array(4).fill('managed');u.nextAttack=0;b.step();assert.ok(b.events.history.some(e=>e.type==='cast'&&e.skill==='lanya-4'));assert.ok(u.mana>=0);
});
test('Lanya and formal equipment share one basic hit count, additive AS, and a single spell bonus',()=>{
 const {b,u,target,run}=arena();const m=run.party[0];m.gear=[M.makeItem(run,'purple_combo_bow'),M.makeItem(run,'purple_battle_spear'),M.makeItem(run,'purple_flowing_codex'),M.makeItem(run,'purple_clearwell_staff')];
 initializeEquipment(u,m.gear);setSource(u,'loadout',{modifiers:loadoutModifiers(m)});u.stats.accuracy=1000;target.shield=1e5;b.cast(u,3);
 near(u.stats.attackSpeed,.91*(1+.364+.24+.24+.7)*1.1);
 for(let n=0;n<3;n++){const shot=b.fire(u,target);b.settle(shot);}assert.equal(u.equipment.hits,3);assert.equal(b.effects.filter(e=>e.originId==='triple_hit_damage').length,1);
 near(u.stats.attackSpeed,.91*(1+.364+.24+.24+.7+.12)*1.1);const ready=u.ready[1],hits=u.equipment.hits;
 b.cast(u,2);const arrows=b.shots.filter(s=>s.skillKey==='3');assert.equal(arrows.filter(s=>s.spellBonus).length,1);for(const shot of arrows)b.settle(shot);assert.equal(u.equipment.hits,hits);assert.equal(u.ready[1],ready);
 // A passive finishing blow still records actual damage for a single Conduit refund.
 target.shield=0;const shot=b.fire(u,target);target.hp=shot.damage+1;u.mana=0;b.settle(shot);assert.equal(target.hp,0);assert.equal(u.mana,15);b.settle(shot);assert.equal(u.mana,15);
});
test('old accuracy bonuses migrate once while currency, loadout and modes survive',()=>{
 const r=M.createRun(19);r.phase='ready';r.candidates=[];r.party=[{hero:'wind',gear:[M.makeLegacyItem(r,0,'lens'),M.makeLegacyItem(r,0,'boots'),null,null],skillModes:['manual','auto','managed','manual']}];
 r.version=1;r.gold=20;r.party[0].gear[0].stats={focus:8,crit:.04};r.party[0].gear[1].stats={move:4,tenacity:.04};r.party[0].gear.forEach(i=>{if(i)i.price/=10;});
 const parsed=M.parseSave(JSON.stringify(r));assert.ok(parsed);assert.equal(parsed.gold,200);assert.equal(M.statsFor(parsed.party[0]).accuracy,103);assert.equal(M.statsFor(parsed.party[0]).evasion,4);
 assert.deepEqual(parsed.party[0].skillModes,r.party[0].skillModes);assert.deepEqual(M.parseSave(JSON.stringify(parsed)),parsed);
});
