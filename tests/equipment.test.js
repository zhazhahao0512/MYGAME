import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as M from '../src/model.js';
import {EQUIPMENT, equipmentById, recipesFor, PASSIVES} from '../src/equipment.js';
import {skillsFor} from '../src/combat/content.js';
import {RARITIES} from '../src/data.js';
import {Battle, STEP} from '../src/battle.js';
import {setSource, expireStatuses} from '../src/combat/unit.js';
import {syncEquipment} from '../src/combat/equipment.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} ≠ ${b}`);
function runWith(ids=[],hero='jinli') {
  const r=M.createRun(42);r.party=[{hero,gear:[...ids.map(id=>M.makeItem(r,id)),...Array(4-ids.length).fill(null)],skillModes:Array(4).fill('manual')}];r.candidates=[];r.phase='ready';return r;
}
function shop(ids=[]){const r=runWith(ids);M.finishRound(r,{won:true,kills:20,gold:2000});return r;}
function fixture(ids=[],hero='jinli'){
  const b=new Battle(runWith(ids,hero)),u=b.party[0];
  for(const t of b.enemies){setSource(t,'test',{modifiers:[{stat:'hp',op:'override',value:10000},{stat:'armor',op:'override',value:50},{stat:'resist',op:'override',value:50}]});t.hp=t.stats.hp;t.nextAttack=1e9;t.skills=[];}
  u.skills=skillsFor(hero);u.ready.fill(0);u.nextAttack=1e9;
  setSource(u,'test',{modifiers:[{stat:'crit',op:'override',value:0},{stat:'accuracy',op:'override',value:1e6},{stat:'hpRegen',op:'flat',value:-u.stats.hpRegen}]});
  return {b,u,t:b.enemies[0]};
}
const basic=(b,u,t,options={})=>{const shot=b.fire(u,t,{canMiss:false,...options});b.settle(shot);return shot;};
const direct=(b,u,t,damage)=>b.dealDamage(u,t,{damage,vamp:0,origin:'skill'});

test('78 fixed definitions cover approved tiers, all 73 recipes and prices',()=>{
  assert.deepEqual(RARITIES.map(r=>r.id),['white','blue','purple','red','orange']);
  assert.deepEqual(['white','blue','purple','red'].map(t=>EQUIPMENT.filter(d=>d.rarity===t).length),[12,21,26,19]);
  assert.equal(new Set(EQUIPMENT.map(d=>d.id)).size,78);assert.equal(Object.keys(PASSIVES).length,21);
  const doc=readFileSync(new URL('../docs/EQUIPMENT-DESIGN.md',import.meta.url),'utf8')+
    readFileSync(new URL('../docs/equipment/purple-survival-support-r053.json',import.meta.url),'utf8')+
    readFileSync(new URL('../docs/equipment/red-equipment-r060.json',import.meta.url),'utf8');
  assert.equal(EQUIPMENT.reduce((n,d)=>n+recipesFor(d).length,0),73);
  for(const d of EQUIPMENT){
    assert.ok(doc.includes(d.id),d.id);
    if(d.rarity==='white')assert.equal(Object.keys(d.stats).length,1);
    else for(const r of recipesFor(d)){assert.equal(d.price,r.materials.reduce((n,id)=>n+equipmentById(id).price,0)+r.fee);assert.ok(r.materials.every(id=>equipmentById(id)));}
    if(d.rarity==='blue'){assert.equal(d.recipe.length,2);assert.ok(d.recipe.every(id=>id.startsWith('white_')));assert.equal(d.effectId,undefined);}
    if(d.effectId)assert.ok(PASSIVES[d.effectId]);
  }
  assert.equal(EQUIPMENT.filter(d=>d.rarity==='white').reduce((n,d)=>n+d.weight,0),910);
});
test('random shop and chest offers use only fixed formal content, and preserve seeded determinism',()=>{
  const r=runWith(),copy=structuredClone(r),seen=new Set();
  for(let floor=1;floor<=20;floor++)for(let n=0;n<100;n++){
    r.floor=copy.floor=floor;const item=M.makeItem(r),other=M.makeItem(copy),d=equipmentById(item.base);
    assert.deepEqual(item,other);assert.deepEqual(item.stats,d.stats);assert.equal(item.price,d.price);assert.equal(item.rarity,d.rarity);seen.add(item.base);
  }
  assert.equal(seen.size,59);assert.ok([...seen].every(id=>!id.startsWith('red_')));assert.throws(()=>M.makeItem(r,'orange'));
});
test('formal attack speed is a bonus relative to different hero base rates, duplicate bases stack',()=>{
  for(const hero of ['jinli','lishan']){
    const r=runWith(['purple_battle_spear','purple_battle_spear'],hero),m=r.party[0];
    near(M.statsFor(m).attackSpeed,M.baseStatsFor(m).attackSpeed*1.48);
  }
});
test('same-material crafting consumes distinct equipped instances across heroes, only charges fee and preserves empty slots',()=>{
  const r=shop(['white_iron_sword']);r.party.push({hero:'lishan',gear:[null,null,M.makeItem(r,'white_iron_sword'),null]});
  const uid=r.party[0].gear[0].uid,before=structuredClone(r),q=M.previewCombine(r,'blue_tempered_sword',0,0,uid);
  assert.deepEqual(r,before);assert.equal(q.cost,150);assert.equal(q.reason,'');assert.equal(new Set(q.uids).size,2);
  const item=M.combineEquipment(r,'blue_tempered_sword',0,0,uid,q.uids);
  assert.equal(item.base,'blue_tempered_sword');assert.equal(r.gold,1850);assert.equal(r.party[1].gear[2],null);assert.equal(r.serial,before.serial+1);
  assert.throws(()=>M.combineEquipment(r,'blue_tempered_sword',0,0,uid,q.uids));
});
test('crafting rejects missing, stale, duplicate and unaffordable materials without any mutation',()=>{
  const r=shop(['white_dagger']);let q=M.previewCombine(r,'blue_swift_blades',0,0,r.party[0].gear[0].uid);
  assert.deepEqual(q.missing,['匕首']);let before=JSON.stringify(r);
  assert.throws(()=>M.combineEquipment(r,'blue_swift_blades',0,0,q.anchorUid,q.uids));assert.equal(JSON.stringify(r),before);
  r.party[0].gear[1]=M.makeItem(r,'white_dagger');q=M.previewCombine(r,'blue_swift_blades',0,0,q.anchorUid);
  r.party[0].gear[1]=M.makeItem(r,'white_dagger');before=JSON.stringify(r);
  assert.throws(()=>M.combineEquipment(r,'blue_swift_blades',0,0,q.anchorUid,q.uids),/变化/);assert.equal(JSON.stringify(r),before);
  q=M.previewCombine(r,'blue_swift_blades',0,0,q.anchorUid);r.gold=149;before=JSON.stringify(r);
  assert.throws(()=>M.combineEquipment(r,'blue_swift_blades',0,0,q.anchorUid,q.uids),/金币/);assert.equal(JSON.stringify(r),before);
});
test('three-component purple recipe and reverse upgrade routes are usable',()=>{
  const r=shop(['blue_duelist_blade','white_iron_sword','white_dagger']),uid=r.party[0].gear[0].uid;
  assert.ok(M.upgradesFor(r.party[0].gear[2]).some(d=>d.id==='purple_battle_spear'));
  const q=M.previewCombine(r,'purple_battle_spear',0,0,uid);M.combineEquipment(r,'purple_battle_spear',0,0,uid,q.uids);
  assert.equal(r.gold,1400);assert.equal(r.party[0].gear.filter(Boolean).length,1);assert.equal(r.party[0].gear[0].base,'purple_battle_spear');
});
test('old saves migrate currency once without changing legacy stats, and formal saves rehydrate canonical values',()=>{
  const r=runWith();r.party[0].gear[0]=M.makeLegacyItem(r,1,'clock');r.version=1;r.gold=31;r.earned=51;r.lastRound={gold:12};r.party[0].gear[0].price=23;
  const migrated=M.parseSave(JSON.stringify(r));assert.equal(migrated.version,2);assert.equal(migrated.gold,310);assert.equal(migrated.earned,510);assert.equal(migrated.lastRound.gold,120);
  assert.equal(migrated.party[0].gear[0].price,230);assert.deepEqual(migrated.party[0].gear[0].stats,r.party[0].gear[0].stats);assert.deepEqual(M.parseSave(JSON.stringify(migrated)),migrated);
  const formal=shop(['purple_flowing_codex']);formal.party[0].gear[0].stats.power=999;formal.party[0].gear[0].price=1;
  const restored=M.parseSave(JSON.stringify(formal));assert.equal(restored.party[0].gear[0].stats.power,40);assert.equal(restored.party[0].gear[0].price,1800);
  formal.party[0].gear[1]=structuredClone(formal.party[0].gear[0]);assert.equal(M.parseSave(JSON.stringify(formal)),null);
});
test('triple hit uses launch AD and armor, shield hits count, duplicate passives do not duplicate damage or lifesteal',()=>{
  const {b,u,t}=fixture(['purple_combo_bow','purple_combo_bow']);u.stats.lifeSteal=1;u.stats.omni=1;u.hp=1;t.shield=10000;
  basic(b,u,t);basic(b,u,t);const third=b.fire(u,t,{canMiss:false});const bonus=third.comboDamage.damage;
  near(bonus,u.stats.attack*.30/1.5);assert.equal(third.comboDamage.vamp,0);u.stats.attack=999;b.settle(third);
  const effects=b.effects.filter(e=>e.originId==='triple_hit_damage'&&e.type==='damage');assert.equal(effects.length,1);near(effects[0].shieldLoss,bonus);near(u.hp,1);assert.equal(u.equipment.hits,3);
  b.settle(third);assert.equal(u.equipment.hits,3);
});
test('misses and skills do not advance basic hit counters; third lethal body does not transfer its proc',()=>{
  const {b,u,t}=fixture(['purple_combo_bow']);const miss=b.fire(u,t);miss.hit=false;b.settle(miss);
  basic(b,u,t,{skill:true});assert.equal(u.equipment.hits,0);
  basic(b,u,t);basic(b,u,b.enemies[1]);t.hp=1;basic(b,u,t);
  assert.equal(u.equipment.hits,3);assert.equal(b.effects.filter(e=>e.originId==='triple_hit_damage').length,0);
});
test('critical haste and pursuit add to fixed percentages once, cap/refresh and clear on target change',()=>{
  const {b,u,t}=fixture(['purple_battle_spear','purple_battle_spear','purple_hunting_wind_bow']);const base=u.baseStats.attackSpeed;
  for(let n=0;n<5;n++){const s=b.fire(u,t,{canMiss:false});s.crit=true;b.settle(s);}
  near(u.stats.attackSpeed,base*(1+.24+.24+.24+.12+.20));
  const focus=[...u.statuses.values()].find(s=>s.definition.id==='equipment:focused_haste');assert.equal(focus.stacks,3);
  b.tick=100;const miss=b.fire(u,t);miss.hit=false;b.settle(miss);assert.equal(focus.expiresAt,150);
  b.commandTarget(0,b.enemies[1].id);near(u.stats.attackSpeed,base*(1+.72+.20));
  expireStatuses(u,150);near(u.stats.attackSpeed,base*1.72);
});
test('blood lifesteal reads current health before impact, strictly below 50%, and only restores body HP damage',()=>{
  const {b,u,t}=fixture(['purple_bloodtide_blades','purple_bloodtide_blades'],'jinli');
  let shot=b.fire(u,t,{canMiss:false});u.hp=u.stats.hp*.5;let before=u.hp;b.settle(shot);near(u.hp-before,shot.damage*.06);
  shot=b.fire(u,t,{canMiss:false});u.hp=u.stats.hp*.5-1;before=u.hp;b.settle(shot);near(u.hp-before,shot.damage*.09);
  t.shield=10000;u.hp=10;basic(b,u,t);near(u.hp,10);
});
test('four-hit ward refills its own 30, consumes first, expires independently of skill shields',()=>{
  const {b,u,t}=fixture(['purple_watch_blades','purple_watch_blades']);u.shield=100;
  for(let n=0;n<4;n++)basic(b,u,t);near(u.shield,130);near(u.equipment.ward,30);
  direct(b,t,u,10);near(u.shield,120);near(u.equipment.ward,20);
  b.tick=50;for(let n=0;n<4;n++)basic(b,u,t);near(u.shield,130);assert.equal(u.equipment.wardExpires,200);
  syncEquipment(u,199);near(u.shield,130);syncEquipment(u,200);near(u.shield,100);
});
test('keen crit multiplier is basic-only and unique; guard applies after armor before shields only to basic physical',()=>{
  const {b,u,t}=fixture(['purple_keen_warblade','purple_keen_warblade','purple_ironward_blade']);u.stats.crit=1;
  const body=b.snapshot(u,t,1,false,{canMiss:false});near(body.damage,u.stats.attack*1.65/1.5);
  const skill=b.snapshot(u,t,1,true,{canCrit:true,canMiss:false,power:0});near(skill.damage,u.stats.attack*1.5/1.5);
  const incoming=b.snapshot(t,u,1,false,{canMiss:false,canCrit:false});near(incoming.damage,t.stats.attack*100/(100+u.stats.armor)*.92);
  const physicalSkill=b.snapshot(t,u,1,true,{power:0,damageType:'physical'});near(physicalSkill.damage,incoming.damage/.92);
});
test('post-hit regen refreshes once, shield hits work, heals over time without instant or heal events',()=>{
  const {b,u,t}=fixture(['purple_bloodpact_blade','purple_bloodpact_blade']);u.hp=10;t.shield=10000;
  basic(b,u,t);basic(b,u,t);near(u.hp,10);near(u.stats.hpRegen,3);b.shots=[];
  for(let n=0;n<50;n++)b.step();near(u.hp,13);assert.equal(b.effects.filter(e=>e.type==='heal'&&e.origin!=='regen').length,0);
  expireStatuses(u,150);near(u.stats.hpRegen,0);
});
test('backwater is a dynamic unique +12, respects strict threshold, and does not mutate a launched shot',()=>{
  const {b,u,t}=fixture(['purple_campaign_axe','purple_campaign_axe']);const normal=u.stats.attack;
  u.hp=u.stats.hp/2;syncEquipment(u,0);near(u.stats.attack,normal);
  u.hp--;syncEquipment(u,0);near(u.stats.attack,normal+12);const shot=b.fire(u,t,{canMiss:false});
  b.heal(u,u,20);near(u.stats.attack,normal);near(shot.damage,(normal+12)/1.5);
});
test('echo binds once to primary first damage, uses release AP snapshot, shares miss, and has independent 12s cooldown',()=>{
  const {b,u}=fixture(['purple_flowing_codex','purple_flowing_codex'],'jinli');u.stats.haste=1000;
  const skill={...u.skills[0],ranks:undefined,target:'allEnemies',cost:0,castTime:1,effects:[{type:'damage',amount:1,attack:0,power:0,travel:.1},{type:'damage',amount:1,attack:0,power:0,travel:.2}]};u.skills[0]=skill;
  assert.ok(b.cast(u,0));const action=u.casting;u.stats.power=123;const ap=u.stats.power;u.casting=null;b.release(u,action);u.stats.power=999;
  assert.equal(b.shots.length,10);assert.equal(b.shots.filter(s=>s.spellBonus).length,1);near(b.shots[0].spellBonus.damage,(25+.05*ap)/1.5);assert.equal(u.equipment.spellReady,600);
  const first=b.shots[0];first.hit=false;b.settle(first);assert.equal(b.effects.filter(e=>e.originId==='charged_spell_damage').length,0);
  b.shots=[];b.tick=599;b.release(u,action);assert.equal(b.shots.filter(s=>s.spellBonus).length,0);
  b.shots=[];b.tick=600;b.release(u,action);assert.equal(b.shots.filter(s=>s.spellBonus).length,1);assert.equal(u.equipment.spellReady,1200);
});
test('echo ignores non-damage releases, interruptions and dead targets; proc has no vamp or on-hit recursion',()=>{
  const {b,u,t}=fixture(['purple_flowing_codex','purple_combo_bow'],'lishan');u.hp=20;u.stats.omni=1;
  u.ready.fill(0);assert.ok(b.cast(u,0));assert.equal(u.equipment.spellReady,0);
  u.skills[0]={...u.skills[1],ranks:undefined,castTime:.25};
  u.ready[0]=0;assert.ok(b.cast(u,0));b.addStatus(t,u,'stun');assert.equal(u.casting,null);assert.equal(u.equipment.spellReady,0);
  expireStatuses(u,100);u.ready[0]=0;b.tick=100;assert.ok(b.cast(u,0));const action=u.casting;u.casting=null;b.release(u,action);
  const shot=b.shots.at(-1);assert.ok(shot.spellBonus);assert.equal(shot.spellBonus.vamp,0);t.hp=1;const count=u.equipment.hits;b.settle(shot);assert.equal(u.equipment.hits,count);assert.equal(b.effects.filter(e=>e.originId==='charged_spell_damage').length,0);assert.equal(u.equipment.spellReady,700);
});
test('conduit credits real shield/HP assists at the 6s boundary once, excludes expiry/dead/nonparticipants, and clamps mana',()=>{
  const r=runWith(['purple_clearwell_staff','purple_clearwell_staff'],'jinli');r.party.push({hero:'shuoying',gear:[null,null,null,null]});const b=new Battle(r),[u,killer]=b.party,t=b.enemies[0];u.mana=0;t.shield=20;
  direct(b,u,t,1);assert.equal(u.mana,0);b.tick=300;direct(b,killer,t,1e6);assert.equal(u.mana,15);direct(b,killer,t,1e6);assert.equal(u.mana,15);
  const late=b.enemies[1];direct(b,u,late,1);b.tick=601;direct(b,killer,late,1e6);assert.equal(u.mana,15);
  direct(b,killer,b.enemies[2],1e6);assert.equal(u.mana,15);
  u.mana=u.stats.mana-2;direct(b,u,b.enemies[3],1e6);assert.equal(u.mana,u.stats.mana);
  u.mana=0;direct(b,u,b.enemies[4],1);u.hp=0;direct(b,killer,b.enemies[4],1e6);assert.equal(u.mana,0);
});
test('owned summon damage qualifies for conduit, zero damage and a heal alone do not',()=>{
  const {b,u,t}=fixture(['purple_clearwell_staff']);u.mana=0;
  const summon=b.enemies[4];summon.ownerId=u.id;direct(b,summon,t,1e6);assert.equal(u.mana,15);
  direct(b,u,b.enemies[1],0);b.heal(u,u,1);direct(b,null,b.enemies[1],1e6);assert.equal(u.mana,15);
});
