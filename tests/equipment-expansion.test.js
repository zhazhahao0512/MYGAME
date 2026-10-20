import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as M from '../src/model.js';
import {EQUIPMENT,equipmentById,passiveFor,recipesFor} from '../src/equipment.js';
import {Battle} from '../src/battle.js';
import {setSource,expireStatuses} from '../src/combat/unit.js';
import {getPassive,syncEquipment,supportSpellBatch} from '../src/combat/equipment.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const red=JSON.parse(readFileSync(new URL('../docs/equipment/red-equipment-r060.json',import.meta.url))).items;
const purple=JSON.parse(readFileSync(new URL('../docs/equipment/purple-survival-support-r053.json',import.meta.url))).items;
function run(loadouts=[[]]){
 const r=M.createRun(64);r.phase='ready';r.candidates=[];
 r.party=loadouts.map((ids,i)=>({hero:['wind','tide','stone','ember','shade'][i],gear:[...ids.map(id=>M.makeItem(r,id)),...Array(4-ids.length).fill(null)],skillModes:Array(4).fill('manual')}));return r;
}
function fixture(loadouts=[[]]){
 const b=new Battle(run(loadouts));
 for(const u of b.units()){
  setSource(u,'test',{modifiers:Object.entries({hp:10000,armor:0,resist:0,hpRegen:0,manaRegen:0,accuracy:10000,crit:0}).map(([stat,value])=>({stat,op:'override',value}))});u.hp=u.stats.hp;u.nextAttack=1e9;u.skills=[];u.triggers=[];
 }
 return {b,u:b.party[0],t:b.enemies[0]};
}
function hit(b,source,target,options={}){const shot=b.fire(source,target,{canMiss:false,...options});b.settle(shot);return shot;}
function damage(b,source,target,amount,type='physical',origin='skill'){
 b.dealDamage(source,target,{damage:amount,damageType:type,origin,skill:origin!=='attack',vamp:0});
}
function cast(b,u,targets,effects,{castTime=0,cost=0}={}){
 const skill={id:'test-active',key:'Q',rank:1,cost,cooldown:0,castTime,target:'allAllies',retarget:'release',effects};
 u.skills=[skill];u.ready=[0];
 const action={skill,index:0,targets:targets.map(t=>t.id)};b.release(u,action);return action;
}

test('31 definitions match accepted stats, prices, parameters and every alternate recipe',()=>{
 for(const expected of [...purple,...red]){
  const d=equipmentById(expected.id);assert.deepEqual(d.stats,expected.stats);assert.equal(d.price,expected.price);
  assert.deepEqual(recipesFor(d),expected.recipes||[{materials:expected.recipe,fee:expected.combineFee}]);
  if(expected.effectId){const p=passiveFor(d);assert.equal(p.id,expected.effectId);assert.equal(p.rank,expected.effectRank||1);assert.deepEqual(p.parameters,expected.parameters);}
 }
 assert.equal(new Set(red.flatMap(d=>d.recipes.map(r=>r.materials[0]))).size,26);
});
test('all 38 new recipes craft from either material, preserve other slots, and save canonically',()=>{
 for(const expected of [...purple,...red])for(const [ri,recipe] of recipesFor(equipmentById(expected.id)).entries())for(const anchorIndex of [0,recipe.materials.length-1]){
  const r=run([recipe.materials]);M.finishRound(r,{won:true,kills:1,gold:5000});
  const anchor=r.party[0].gear[anchorIndex];const route=M.upgradeRoutesFor(anchor).find(x=>x.definition.id===expected.id&&x.recipeIndex===ri);assert.ok(route);
  const q=M.previewCombine(r,expected.id,0,anchorIndex,anchor.uid,ri);assert.equal(q.reason,'');assert.equal(q.cost,recipe.fee);
  const before=JSON.stringify(r);const bad=[...q.uids];bad[bad.length-1]=bad[0];
  assert.throws(()=>M.combineEquipment(r,expected.id,0,anchorIndex,anchor.uid,bad,ri));assert.equal(JSON.stringify(r),before);
  M.combineEquipment(r,expected.id,0,anchorIndex,anchor.uid,q.uids,ri);
  assert.equal(r.gold,5000-recipe.fee);assert.equal(r.party[0].gear.filter(Boolean).length,1);assert.equal(r.party[0].gear[anchorIndex].base,expected.id);
  const save=M.parseSave(JSON.stringify(r));assert.ok(save);assert.deepEqual(save.party[0].gear[anchorIndex],r.party[0].gear[anchorIndex]);
 }
});
test('alternative recipe selection is explicit, stale route and illegal indexes cannot spend gold',()=>{
 const r=run([['purple_steel_greatsword','white_spiked_blade']]);M.finishRound(r,{won:true,kills:1,gold:1000});const a=r.party[0].gear[0];
 assert.throws(()=>M.previewCombine(r,'red_judgment_blade',0,0,a.uid,0));
 let q=M.previewCombine(r,'red_judgment_blade',0,0,a.uid,1);assert.deepEqual(q.missing,['尖刺短刃']);
 r.party[0].gear[2]=M.makeItem(r,'white_spiked_blade');q=M.previewCombine(r,'red_judgment_blade',0,0,a.uid,1);assert.equal(new Set(q.uids).size,3);
 const before=JSON.stringify(r);for(const ri of [-1,2,1.5,'1'])assert.throws(()=>M.combineEquipment(r,'red_judgment_blade',0,0,a.uid,q.uids,ri));assert.equal(JSON.stringify(r),before);
 r.gold=799;assert.throws(()=>M.combineEquipment(r,'red_judgment_blade',0,0,a.uid,q.uids,1),/金币/);
});
test('highest whole passive rank wins in either slot order; each new battle resets counters and cooldowns',()=>{
 for(const item of red.filter(i=>i.effectId)){
  const lower=EQUIPMENT.find(i=>i.rarity==='purple'&&i.effectId===item.effectId);
  for(const ids of [[lower.id,item.id,item.id],[item.id,lower.id,item.id]]){
   const b=new Battle(run([ids]));assert.equal(getPassive(b.party[0],item.effectId).rank,2);assert.deepEqual(getPassive(b.party[0],item.effectId).parameters,item.parameters);
   b.party[0].equipment.hits=10;b.party[0].equipment.spellReady=1000;
   const next=new Battle(b.run);assert.equal(next.party[0].equipment.hits,0);assert.equal(next.party[0].equipment.spellReady,0);
  }
 }
});
test('red pursuit, critical haste and crit multiplier stack only their distinct effects',()=>{
 const {b,u,t}=fixture([['red_storm_blades','purple_battle_spear','red_riftwind_bow','red_judgment_blade']]);
 const base=u.baseStats.attackSpeed;
 for(let n=0;n<4;n++){const shot=b.fire(u,t,{canMiss:false});shot.crit=true;b.settle(shot);}
 near(u.stats.attackSpeed,base*(1+.48+.24+.44+.18+.24));
 u.stats.crit=1;const body=b.snapshot(u,t,1,false,{canMiss:false});near(body.damage,u.stats.attack*1.8);
 const skill=b.snapshot(u,t,1,true,{canMiss:false,canCrit:true,power:0});near(skill.damage,u.stats.attack*1.5);
 b.commandTarget(0,b.enemies[1].id);near(u.stats.attackSpeed,base*(1+.48+.24+.44+.24));
 expireStatuses(u,150);near(u.stats.attackSpeed,base*(1+.48+.24+.44));
});
test('red triple hit uses one 45% launch snapshot, cannot vamp, and does not feed hit counters',()=>{
 const {b,u,t}=fixture([['red_decisive_crossbow','purple_combo_bow','red_watch_halberd','red_crimson_tide_blade']]);u.hp=100;t.shield=10000;
 for(let n=0;n<2;n++)hit(b,u,t);
 const shot=b.fire(u,t,{canMiss:false}),expected=u.stats.attack*.45;u.stats.attack=999;b.settle(shot);
 near(shot.comboDamage.damage,expected);near(u.hp,100);assert.equal(u.equipment.hits,3);assert.equal(u.shield,0);
 hit(b,u,t);near(u.shield,50);assert.equal(u.equipment.hits,4);
 const procs=b.effects.filter(e=>e.originId==='triple_hit_damage');assert.equal(procs.length,1);assert.equal(procs[0].crit,false);
});
test('red blood and backwater use strict low-health boundary and one upgraded passive',()=>{
 const {b,u,t}=fixture([['red_crimson_tide_blade','purple_bloodtide_blades','red_crimson_edge_axe','purple_campaign_axe']]);
 const ad=u.stats.attack;u.hp=5000;syncEquipment(u,0);near(u.stats.attack,ad);
 u.hp=4999;syncEquipment(u,0);near(u.stats.attack,ad+20);const shot=hit(b,u,t);near(u.hp-4999,shot.damage*.15);
 u.hp=5000;syncEquipment(u,0);near(u.stats.attack,ad);
});
test('red echo binds once with upgraded AP ratio and 12s cooldown; red conduit restores 20 only',()=>{
 const {b,u,t}=fixture([['red_echo_codex','purple_flowing_codex','red_tidal_staff','purple_clearwell_staff']]);
 u.mana=0;const effects=[{type:'damage',amount:1,attack:0,power:0,travel:.2},{type:'damage',amount:1,attack:0,power:0,travel:.3}];
 cast(b,u,b.enemies,effects);assert.equal(b.shots.filter(s=>s.spellBonus).length,1);near(b.shots[0].spellBonus.damage,45+.08*u.stats.power);assert.equal(u.equipment.spellReady,600);
 const shot=b.shots[0];shot.hit=false;b.settle(shot);assert.equal(u.equipment.hits,0);
 damage(b,u,t,1e6);assert.equal(u.mana,20);damage(b,u,t,1e6);assert.equal(u.mana,20);
});
test('nourish fires once on successful damaging release, no amplification or recursion; cancellation and non-damage excluded',()=>{
 const {b,u,t}=fixture([['red_lifebloom_scepter','purple_abundant_staff']]);u.hp=100;u.stats.healing=2;u.stats.haste=1000;
 const effects=[{type:'damage',amount:10,attack:0,power:0},{type:'damage',amount:10,attack:0,power:0}];
 cast(b,u,b.enemies,effects);near(u.hp,165);assert.equal(u.equipment.ready.get('spell_self_mend'),400);assert.equal(b.events.history.filter(e=>e.type==='heal').length,0);
 b.shots.forEach(s=>s.hit=false);for(const s of b.shots)b.settle(s);near(u.hp,165);
 cast(b,u,b.enemies,effects);near(u.hp,165);b.tick=400;u.hp=u.stats.hp;cast(b,u,b.enemies,effects);assert.equal(u.equipment.ready.get('spell_self_mend'),800);
 b.tick=800;u.hp=100;cast(b,u,[u],[{type:'status',status:'fortify'}]);near(u.hp,100);assert.equal(u.equipment.ready.get('spell_self_mend'),800);
 u.skills=[{id:'cancel',key:'Q',rank:1,cost:10,cooldown:0,castTime:1,target:'enemy',effects}];u.ready=[0];assert.ok(b.cast(u,0));b.addStatus(t,u,'stun');assert.equal(u.casting,null);near(u.hp,100);
});
test('response and mixed-damage regeneration require actual hostile damage, survive, and refresh only',()=>{
 for(const [id,bonus,types] of [['purple_stonegrain_staff',20,['physical']],['red_battleweave_robe',35,['physical','magic']]]){
  const {b,u,t}=fixture([[id,'purple_equilibrium_sigil','red_equilibrium_bulwark']]);const ap=u.stats.power;
  damage(b,t,u,0);near(u.stats.power,ap);damage(b,u,u,1);near(u.stats.power,ap);
  damage(b,t,u,1,'true');near(u.stats.power,ap);damage(b,t,u,1,'shield_piercing_magic');near(u.stats.power,ap);
  u.shield=10;damage(b,t,u,1,'magic');near(u.stats.power,ap+(types.includes('magic')?bonus:0));
  b.tick=300;damage(b,t,u,1,'physical');near(u.stats.power,ap+bonus);assert.ok(u.statuses.has(`equipment:mixed_damage_regeneration:${u.id}`));
  b.tick=301;damage(b,t,u,1,'physical');near(u.stats.power,ap+bonus);assert.equal(u.statuses.get(`equipment:mixed_damage_regeneration:${u.id}`).expiresAt,500);
  expireStatuses(u,501);near(u.stats.power,ap);damage(b,t,u,1e6);assert.equal(u.hp,0);assert.equal(u.statuses.size,0);
 }
});
test('low-health regeneration is immediate at crossing, unique and fixed despite healing amplification',()=>{
 const r=run([['purple_evergreen_amulet','red_mountain_heart']]),b=new Battle(r),u=b.party[0];u.skills=[];u.nextAttack=1e9;
 for(const t of b.enemies){t.skills=[];t.nextAttack=1e9;}
 const base=u.stats.hpRegen;u.hp=u.stats.hp/2;syncEquipment(u,0);near(u.stats.hpRegen,base);
 u.hp-=1;syncEquipment(u,0);near(u.stats.hpRegen,base+8);
 u.hp=10;u.stats.healing=2;b.step();near(u.hp,10+(base*3+8)*.02);
 b.heal(u,u,u.stats.hp);near(u.stats.hpRegen,base);
});
test('flat block only affects physical basic body after percentage guard; shield and vamp use post-block damage',()=>{
 const {b,u,t}=fixture([['purple_ironward_blade','purple_bastion_armor','red_ironwall_armor']]);u.shield=100;t.stats.attack=100;
 const shot=hit(b,t,u);near(shot.damage,92);near(u.shield,20);
 damage(b,t,u,5,'physical','attack');near(u.shield,20);
 damage(b,t,u,10,'physical','equipment');near(u.shield,10);
 damage(b,t,u,10,'physical','skill');near(u.shield,0);
 const hp=u.hp;damage(b,t,u,10,'true','attack');near(u.hp,hp-10);
});
test('magic wards use arrival max HP, ordered proportional guard, independent segments, and exclude true/antimagic',()=>{
 const {b,u,t}=fixture([['purple_stillmind_staff','purple_spellward_cloak','red_spellward_mantle']]);u.stats.hp=2000;u.hp=2000;
 damage(b,t,u,400,'magic');near(u.hp,2000-(376-.25*(376-160)));
 u.hp=2000;damage(b,t,u,160,'magic');near(u.hp,2000-150.4);
 u.hp=2000;for(let i=0;i<4;i++)damage(b,t,u,100,'magic');near(u.hp,1624);
 u.hp=2000;u.shield=100;damage(b,t,u,400,'shield_piercing_magic');near(u.hp,1600);near(u.shield,100);
 damage(b,t,u,200,'true');near(u.hp,1500);near(u.shield,0);
 const shot=b.fire(t,u,{skill:true,canMiss:false,damageType:'magic',amount:400,attack:0,power:0});u.stats.hp=1000;u.hp=1000;b.settle(shot);near(u.hp,1000-(376-.25*(376-80)));
});
test('support procs pick one beneficiary after the whole batch, use highest rank and fixed values',()=>{
 const {b,u}=fixture([['red_redemption_codex','purple_relief_codex','red_wellspring_chalice','purple_spiritwell_orb'],[],[]]);const [_,a,c]=b.party;
 u.stats.healing=2;a.hp=100;c.hp=200;a.mana=0;c.mana=c.stats.mana-1;
 const act=cast(b,u,[a,c],[{type:'heal',amount:10},{type:'shield',amount:10}]);
 near(a.hp,195);near(c.hp,230);near(a.mana,30);near(c.mana,c.stats.mana-1);
 assert.equal(u.equipment.ready.get('ally_spell_mend'),400);assert.equal(u.equipment.ready.get('ally_spell_mana'),600);
 const heals=b.events.history.filter(e=>e.type==='heal');assert.equal(heals.length,2);
 b.tick=1000;supportSpellBatch(b,u,act,[a,c]);near(a.hp,195);near(a.mana,30);
});
test('support ignores ineffective healing, self effects and gear healing; first effective cast batch consumes its opportunity',()=>{
 const {b,u}=fixture([['purple_relief_codex','purple_spiritwell_orb'],[]]),a=b.party[1];
 cast(b,u,[a],[{type:'heal',amount:10}]);assert.equal(u.equipment.ready.size,0);
 u.hp=100;cast(b,u,[u],[{type:'heal',amount:10},{type:'shield',amount:10}]);assert.equal(u.equipment.ready.size,0);
 a.hp=100;const act=cast(b,u,[a],[{type:'heal',amount:10}]);near(a.hp,145);assert.equal(u.equipment.ready.has('ally_spell_mana'),false);
 a.mana=0;b.tick=1000;supportSpellBatch(b,u,act,[a]);near(a.mana,0);
 b.heal(u,a,10,{origin:'equipment'});near(a.mana,0);
 cast(b,u,[a],[{type:'shield',amount:5}]);near(a.mana,20);near(a.hp,190);
});
test('aid shield rank arbitration, owner cooldowns, death persistence and expiry are independent of base shields',()=>{
 const {b,t}=fixture([['purple_shelter_pendant'],['red_oath_emblem'],[]]),[low,high,a]=b.party;a.hp=3000;a.shield=40;
 high.hp=0;damage(b,t,a,1);near(a.shield,139);near(a.timedShields.get('ally_low_health_shield').amount,100);
 high.hp=10000;b.tick=50;damage(b,t,a,1);near(a.shield,219);assert.equal(a.timedShields.get('ally_low_health_shield').rank,2);
 low.equipment.ready.clear();b.tick=100;damage(b,t,a,1);assert.equal(a.timedShields.get('ally_low_health_shield').expiresAt,250);assert.equal(low.equipment.ready.get('ally_low_health_shield'),1000);
 high.hp=0;syncEquipment(a,249);assert.ok(a.shield>39);syncEquipment(a,250);near(a.shield,39);
 low.equipment.ready.clear();b.tick=251;damage(b,t,a,1);assert.equal(a.timedShields.get('ally_low_health_shield').rank,1);
});
test('same-rank support shields refresh without adding, consume earliest expiry, and lethal hits are not rescued',()=>{
 const {b,t}=fixture([['red_oath_emblem'],['red_oath_emblem'],['red_watch_halberd']]),[one,two,a]=b.party;
 a.hp=3000;a.shield=20;for(let i=0;i<4;i++)hit(b,a,t);near(a.shield,70);
 damage(b,t,a,10);near(a.shield,240);near(a.equipment.ward,40);near(a.timedShields.get('ally_low_health_shield').amount,180);
 damage(b,t,a,45);near(a.equipment.ward,0);near(a.timedShields.get('ally_low_health_shield').amount,175);near(a.shield,195);
 b.tick=100;two.equipment.ready.clear();damage(b,t,a,1);near(a.shield,200);assert.equal(a.timedShields.get('ally_low_health_shield').expiresAt,300);
 const hp=a.hp;damage(b,t,a,10,'shield_piercing_magic');near(a.hp,hp-10);near(a.shield,200);
 syncEquipment(a,300);near(a.shield,20);one.equipment.ready.clear();two.equipment.ready.clear();damage(b,t,a,1e6);assert.equal(a.hp,0);assert.equal(a.shield,0);assert.equal(a.timedShields.size,0);
});
test('full Battle advances new four-slot builds with finite mana, deaths, procs and stable replay',()=>{
 const builds=[
  ['red_storm_blades','red_decisive_crossbow','red_riftwind_bow','red_judgment_blade'],
  ['red_crimson_tide_blade','red_crimson_edge_axe','red_watch_halberd','purple_bloodpact_blade'],
  ['red_morningstar_staff','red_echo_codex','red_tidal_staff','red_lifebloom_scepter'],
  ['red_battleweave_robe','red_mountain_heart','red_ironwall_armor','red_spellward_mantle'],
  ['red_equilibrium_bulwark','red_redemption_codex','red_wellspring_chalice','red_oath_emblem'],
 ];
 function simulate(seed){
  const r=run(builds);r.seed=seed;r.floor=15;r.level=15;r.party.forEach((m,i)=>{M.recommendSkills(r,i);m.skillModes=Array(4).fill('managed');});
  const b=new Battle(r);let peakShields=0,peakStatuses=0;
  while(['combat','cleanup'].includes(b.phase)&&b.tick<9000){
   b.step();for(const u of b.units()){
    for(const value of [u.hp,u.mana,u.shield,...Object.values(u.stats)])assert.ok(Number.isFinite(value));
    assert.ok(u.hp>=0&&u.hp<=u.stats.hp&&u.mana>=0&&u.mana<=u.stats.mana&&u.shield>=0);
    assert.ok([...u.timedShields.values()].reduce((n,s)=>n+s.amount,0)<=u.shield+1e-7);
    peakShields=Math.max(peakShields,u.timedShields.size);peakStatuses=Math.max(peakStatuses,u.statuses.size);
   }
  }
  assert.ok(['won','lost'].includes(b.phase),'no stalled cleanup');assert.ok(peakShields<=2&&peakStatuses<15);assert.equal(b.events.suppressed,0);
  return {result:b.result(),hp:b.party.map(u=>u.hp),mana:b.party.map(u=>u.mana),effects:b.effects};
 }
 for(const seed of [64,103,237])assert.deepEqual(simulate(seed),simulate(seed));
});
