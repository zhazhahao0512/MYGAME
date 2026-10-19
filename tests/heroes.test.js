import test from 'node:test';
import assert from 'node:assert/strict';
import { HERO_PROFILES,heroBaseStats,heroBudget } from '../src/heroes/foundation.js';
import { initializeProgression,validProgression,upgradeSkill,recommendSkills,chooseGrowth,growthOffers,growthBonuses,progressionSummary,recommendedRanks } from '../src/heroes/progression.js';
import { actionHitChance,migrateAccuracyBonuses } from '../src/heroes/accuracy.js';
import { lanyaSkills,releaseLanya,lanyaAttackPayload,lanyaMainHit,lanyaMechanicReason,lanyaAutoReady } from '../src/heroes/lanya.js';
import { BASE } from '../src/data.js';
import { createUnit,applyStatus,expireStatuses } from '../src/combat/unit.js';
import { combineHeroAttackSpeed,memberBaseStats,rankedHeroSkills,threeTargets } from '../src/heroes/integration.js';
import { renderGrowth } from '../src/heroes/growth-ui.js';
import { LANYA_HERO } from '../src/heroes/foundation.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
function fixture(level=1){const m={hero:'lanya'};initializeProgression(m,level,123);return {level,seed:123,party:[m],phase:'ready'};}
test('individual panels, zero AP/crit, fractional growth persists past 15',()=>{
  assert.equal(new Set(Object.values(HERO_PROFILES).map(p=>p.base.attackSpeed)).size,8);
  for(const id of Object.keys(HERO_PROFILES))for(const level of [1,15,16,99]){
    const s=heroBaseStats(id,level,BASE);assert.equal(s.power,0);assert.equal(s.crit,0);assert.equal(s.accuracy,95);assert.equal(s.evasion,0);
  }
  const s=heroBaseStats('lanya',15,BASE);near(s.hp,1760.6);near(s.attack,120.92);near(s.manaRegen,4.94);near(s.attackSpeed*(1+s.bonusAttackSpeed)*1.1,1.365364);
  near(heroBaseStats('lanya',16,BASE).hp-s.hp,63.4);
  near(heroBudget('lanya').base,8014.733333333333);near(heroBudget('lanya').growth,546.1833333333334);
});
test('skill gates, saved points and recommended route stay legal',()=>{
  const r=fixture();upgradeSkill(r,0,0);assert.throws(()=>upgradeSkill(r,0,1),/没有技能点/);
  r.level=2;assert.throws(()=>upgradeSkill(r,0,0),/不同技能/);upgradeSkill(r,0,1);
  r.level=4;upgradeSkill(r,0,0);upgradeSkill(r,0,0);
  r.level=5;assert.throws(()=>upgradeSkill(r,0,0),/6级/);upgradeSkill(r,0,3);
  r.level=6;upgradeSkill(r,0,0);assert.deepEqual(r.party[0].progression.ranks,[4,1,0,1]);
  r.level=9;assert.throws(()=>upgradeSkill(r,0,3),/10级/);
  r.level=10;upgradeSkill(r,0,3);r.level=14;assert.throws(()=>upgradeSkill(r,0,3),/15级/);
  r.level=15;recommendSkills(r,0);assert.deepEqual(r.party[0].progression.ranks,[4,4,4,3]);
  for(let level=1;level<=15;level++){const m={hero:'lanya'};initializeProgression(m,level,2,{legacy:true});assert.deepEqual(m.progression.ranks,recommendedRanks(level));assert.ok(validProgression(m,level));}
  const saved=fixture(2);upgradeSkill(saved,0,2);assert.throws(()=>upgradeSkill(saved,0,2),/不同技能/);
  r.phase='battle';assert.throws(()=>upgradeSkill(r,0,1),/战前/);
});
test('post-15 choices are persistent distinct triples, additional to growth, with no AP',()=>{
  const r=fixture(17),m=r.party[0],a=growthOffers(m);
  assert.equal(new Set(a.map(o=>o.id)).size,3);assert.deepEqual(growthOffers(JSON.parse(JSON.stringify(m))),a);
  assert.throws(()=>chooseGrowth(r,0,'power'));
  chooseGrowth(r,0,a[0].id);chooseGrowth(r,0,growthOffers(m)[0].id);
  assert.equal(progressionSummary(m,17).choices,0);assert.equal(progressionSummary(m,17).points,15);assert.ok(validProgression(m,17));
  assert.throws(()=>chooseGrowth(r,0,growthOffers(m)[0].id));assert.equal(growthBonuses(m).power,undefined);
  const corrupt=structuredClone(m);corrupt.progression.ranks=[4,4,4,4];assert.equal(validProgression(corrupt,17),false);
  for(let n=0;n<100;n++)assert.ok(growthOffers(m,n).every(o=>o.stat!=='power'&&o.stat!=='crit'));
});
test('accuracy uses summed slots, no artificial floors, and migration is idempotent',()=>{
  const u={slot:0,def:{range:'melee'},stats:{accuracy:95}},t={slot:0,stats:{evasion:0}};
  near(actionHitChance(u,t),.95);t.slot=4;near(actionHitChance(u,t),.75);u.slot=4;near(actionHitChance(u,t),.55);
  u.def.range='ranged';near(actionHitChance(u,t),.79);u.stats.accuracy=120;t.stats.evasion=20;near(actionHitChance(u,t),.84);
  t.stats.evasion=1000;assert.equal(actionHitChance(u,t),0);u.stats.accuracy=2000;assert.equal(actionHitChance(u,t),1);
  const stats=migrateAccuracyBonuses({attack:10,focus:8,move:4});assert.deepEqual(stats,{attack:10,accuracy:8,evasion:4});assert.deepEqual(migrateAccuracyBonuses(stats),stats);
});
function kit(ranks=[4,4,4,3]){
  const u=createUnit({id:'hero',side:'hero',slot:2,def:{id:'lanya',range:'ranged'},baseStats:heroBaseStats('lanya',15,BASE),skills:lanyaSkills(ranks)});u.level=15;
  const b={tick:0,stepSeconds:.02,getSkill:(u,i)=>({...u.skills[i],...u.skills[i].ranks[u.skills[i].rank-1]}),addStatus:(s,t,d)=>applyStatus(t,d,s.id,b.tick)};
  const target={stats:{...BASE,resist:50,reduction:.3}};return {u,b,target};
}
test('Lanya charges consume on launch, ultimate takeover has no free remnants',()=>{
  const {u,b,target}=kit();releaseLanya(b,u,0,b.getSkill(u,0));assert.equal(u.edgeCharges,5);assert.equal(lanyaAutoReady(u,0),false);
  for(let i=0;i<5;i++)assert.equal(lanyaAttackPayload(b,u,target).parts.length,2);
  assert.equal(lanyaAttackPayload(b,u,target).parts.length,1);assert.equal(lanyaAutoReady(u,0),true);
  releaseLanya(b,u,0,b.getSkill(u,0));releaseLanya(b,u,1,b.getSkill(u,1));u.ready[1]=600;
  releaseLanya(b,u,3,b.getSkill(u,3));assert.equal(u.edgeCharges,0);assert.equal(u.ready[1],600);assert.equal(lanyaMechanicReason(u,0),'大招维持中');
  const payload=lanyaAttackPayload(b,u,target);assert.equal(payload.parts[0].damage,60);assert.equal(payload.parts.length,2);
  b.tick=500;expireStatuses(u,b.tick);assert.equal(lanyaAttackPayload(b,u,target).parts.length,1);assert.equal(payload.parts[0].damage,60);
  lanyaMainHit(b,u,payload);assert.equal(u.ready[1],587.5);
  assert.equal(u.edgeCharges,0);
});
test('ultimate never grants unlearned abilities; three-arrow skill has zero AP ratio',()=>{
  const {u,b,target}=kit([0,0,4,3]);releaseLanya(b,u,3,b.getSkill(u,3));const payload=lanyaAttackPayload(b,u,target);
  assert.equal(payload.parts.length,1);assert.equal(payload.refund,0);assert.equal(u.stats.bonusAttackSpeed,.364);
  const skill=b.getSkill(u,2);assert.equal(skill.effects[0].power,0);assert.equal(skill.effects[0].amount,140);
  releaseLanya(b,u,2,skill);assert.equal(u.stats.accuracy,110);assert.equal(u.stats.evasion,9);
});
test('ordinary AS pools add before Lanya total multiplier; targeting has three distinct slots',()=>{
  const base=memberBaseStats({hero:'lanya'},15,BASE),stats={...base,bonusAttackSpeed:base.bonusAttackSpeed+.7};
  combineHeroAttackSpeed(base,[{stat:'attackSpeed',op:'percent',value:.4}],stats);
  near(stats.attackSpeed,.91*(1+.364+.7+.4)*1.1);
  const candidates=Array.from({length:5},(_,slot)=>({id:`t${slot}`,slot}));
  assert.deepEqual(threeTargets(candidates[2],candidates).map(t=>t.slot),[2,1,3]);
  assert.equal(threeTargets(candidates[2],[candidates[2]]).length,1);
});
test('growth panel exposes pending choices and current rank values without assuming every skill has damage',()=>{
  const r=fixture(16);recommendSkills(r,0);const defs=rankedHeroSkills('lanya',[],r.party[0].progression.ranks);
  const html=renderGrowth(r,0,LANYA_HERO,defs);assert.match(html,/被动真伤×4/);assert.match(html,/70%额外攻速/);assert.match(html,/data-act="choose-growth"/);
  assert.ok(html.indexOf('data-act="choose-growth"')<html.indexOf('growth-skills'));
});
