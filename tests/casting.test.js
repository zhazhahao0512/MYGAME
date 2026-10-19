import test from 'node:test';
import assert from 'node:assert/strict';
import {Battle} from '../src/battle.js';
import * as M from '../src/model.js';
import {normalizeSkillModes,chooseManagedSkill,evaluateSkill} from '../src/combat/casting.js';
const ability=(id,cost,amount,extra={})=>({id,key:id,name:id,cost,cooldown:10,castTime:0,target:'enemy',priority:10,effects:[{type:'damage',amount,attack:0,power:0,damageType:'magic'}],...extra});
function arena(){
 const run=M.createRun(17);run.phase='ready';run.party=[{hero:'stone',gear:[null,null,null,null],skillModes:normalizeSkillModes()}];
 const b=new Battle(run),u=b.party[0];
 for(const actor of b.units()){actor.nextAttack=Infinity;actor.ready=actor.skills.map(()=>Infinity);actor.stats.hpRegen=0;actor.stats.manaRegen=0;actor.triggers=[];}
 u.stats.mana=200;u.mana=150;u.stats.power=0;u.guaranteedManaRegen=0;
 for(const e of b.enemies){e.stats.resist=0;e.hp=e.stats.hp=2000;}
 return {b,u,run};
}
test('new heroes and legacy/invalid mode fields default to managed; saves and swaps keep independent choices',()=>{
 const r=M.createRun(42);M.recruit(r,r.candidates[0]);M.recruit(r,r.candidates[0]);
 assert.deepEqual(r.party[0].skillModes,['managed','managed','managed','managed']);
 r.party[0].skillModes=['manual','auto','managed','manual'];r.phase='shop';
 r.phase='ready';M.finishRound(r,{won:true,gold:1,kills:0});
 const first=r.party[0].hero;M.swapHeroes(r,0,1);let copy=M.parseSave(JSON.stringify(r));
 assert.deepEqual(copy.party.find(m=>m.hero===first).skillModes,['manual','auto','managed','manual']);
 delete copy.party[0].skillModes;copy.party[0].auto=false;copy.party[1].skillModes=['broken','manual'];
 copy=M.parseSave(JSON.stringify(copy));assert.deepEqual(copy.party[0].skillModes,normalizeSkillModes());
 assert.deepEqual(copy.party[1].skillModes,['managed','manual','managed','managed']);assert.equal('auto' in copy.party[0],false);
});
test('manual never casts itself; auto spends immediately even on a useless shield; managed waits',()=>{
 for(const mode of ['manual','auto','managed']){
  const {b,u}=arena();u.skills=[ability('shield',20,0,{target:'self',effects:[{type:'shield',amount:30}]})];u.ready=[0];u.skillModes=[mode];
  b.step();assert.equal(u.mana,mode==='auto'?130:150);assert.equal(u.shield,mode==='auto'?30:0);
 }
});
test('managed reserves for a valuable skill that cannot yet be paid and avoids the cheap-skill starvation loop',()=>{
 const {b,u}=arena();u.skills=[ability('cheap',34,10),ability('burst',100,1000)];u.ready=[0,200];u.skillModes=['managed','managed'];u.mana=110;u.stats.manaRegen=u.guaranteedManaRegen=4.94;
 assert.equal(chooseManagedSkill(b,u),null);assert.equal(u.castPlan.index,1);assert.ok(Math.abs(u.castPlan.reserve-80.24)<1e-8);
 u.mana=120;assert.equal(chooseManagedSkill(b,u),0);
 u.mana=60;u.ready[1]=0;assert.equal(chooseManagedSkill(b,u),null);assert.equal(u.castPlan.index,1);
 for(let n=0;n<450;n++)b.step();assert.ok(b.events.history.some(e=>e.type==='castStart'&&e.skill==='burst'));
});
test('auto/manual honor player intent and can spend managed reserve; mode switch clears only pending plans',()=>{
 const {b,u,run}=arena();u.skills=[ability('cheap',34,10),ability('burst',100,1000)];u.ready=[0,200];u.skillModes=['managed','managed'];u.mana=110;u.stats.manaRegen=u.guaranteedManaRegen=4.94;
 chooseManagedSkill(b,u);b.setSkillMode(0,0,'auto');b.step();assert.ok(u.mana<80.24);
 assert.deepEqual(run.party[0].skillModes,['auto','managed']);
 u.ready[0]=0;u.mana=110;u.castPlan={index:1,reserve:100};assert.ok(b.requestCast(u,0));assert.equal(u.mana,76);
 const ready=[...u.ready],shield=u.shield;b.setSkillMode(0,1,'manual');assert.deepEqual(u.ready,ready);assert.equal(u.shield,shield);assert.equal(u.castPlan,null);
});
test('no impossible reservation when capacity or regeneration cannot fund the goal, and no target means no waste',()=>{
 for(const capacity of [80,200]){
  const {b,u}=arena();u.skills=[ability('cheap',20,20),ability('burst',100,1000)];u.ready=[0,0];u.skillModes=['managed','managed'];u.stats.mana=capacity;u.mana=40;
  assert.equal(chooseManagedSkill(b,u),0);
  for(const e of b.enemies)e.hp=0;assert.equal(chooseManagedSkill(b,u),null);assert.equal(u.castPlan,null);
 }
});
test('actual current rank, target count, resistances and mana overrides affect managed benefit without RNG use',()=>{
 const {b,u}=arena();u.skills=[ability('ranked',10,10,{rank:1,ranks:[{effects:[{type:'damage',amount:10,attack:0,power:0}]},{effects:[{type:'damage',amount:100,attack:0,power:0}]}]}),ability('flat',10,30)];u.ready=[0,0];u.skillModes=['managed','managed'];
 const seed=b.rng.seed,lock=u.targetId;assert.equal(chooseManagedSkill(b,u),1);
 u.skills[0].rank=2;assert.equal(chooseManagedSkill(b,u),0);assert.equal(b.rng.seed,seed);assert.equal(u.targetId,lock);
 const single=evaluateSkill(b,u,0).value;u.skills[0].target='allEnemies';assert.equal(evaluateSkill(b,u,0).value,5*single);
 for(const e of b.enemies)e.stats.resist=100;assert.equal(evaluateSkill(b,u,0).value,2.5*single);
 u.skills[0].rank=0;assert.equal(b.skillReason(u,0),'未学习');assert.equal(evaluateSkill(b,u,0),null);
});
test('emergency healing breaks an offensive reserve, but overheal and redundant protection are not free benefit',()=>{
 const {b,u}=arena();u.skills=[ability('heal',30,0,{target:'allyWeakest',effects:[{type:'heal',amount:100}]}),ability('burst',100,1000)];u.ready=[0,200];u.skillModes=['managed','managed'];u.mana=100;u.stats.manaRegen=u.guaranteedManaRegen=5;
 u.castPlan={index:1,reserve:80};u.hp=20;u.lastDamagedTick=b.tick;
 assert.equal(chooseManagedSkill(b,u),0);assert.equal(evaluateSkill(b,u,0).band,1);
 u.hp=u.stats.hp;assert.equal(evaluateSkill(b,u,0),null);
});
test('zero cost, empty candidate set and expiring mana regen are safe',()=>{
 const {b,u}=arena();u.skills=[ability('free',0,30),ability('paid',100,500)];u.ready=[0,200];u.skillModes=['managed','managed'];u.mana=100;u.stats.manaRegen=20;u.guaranteedManaRegen=2;
 chooseManagedSkill(b,u);if(u.castPlan.index===1)assert.equal(u.castPlan.reserve,92);
 assert.ok(Number.isFinite(evaluateSkill(b,u,0).value));u.skillModes=['manual','manual'];assert.equal(chooseManagedSkill(b,u),null);
});
test('one short click command waits for action, rechecks mana, and never retargets a cast already started',()=>{
 const {b,u}=arena();u.skills=[ability('slow',20,100,{castTime:.4}),ability('next',30,50)];u.ready=[0,0];u.skillModes=['manual','manual'];
 assert.ok(b.requestCast(u,0));const action=u.casting;assert.ok(b.requestCast(u,1));assert.equal(u.pendingCast.index,1);assert.equal(u.casting,action);
 u.mana=0;for(let i=0;i<21;i++)b.step();assert.equal(u.pendingCast,null);assert.equal(u.lastCommandReason,'法力不足');
 assert.equal(b.events.history.filter(e=>e.type==='castStart').length,1);
});
test('click queue expires, control and mode changes cancel it, and cooldown never queues a second cast',()=>{
 for(const cancel of ['expire','stun','mode']){
  const {b,u}=arena();u.skills=[ability('slow',20,50,{castTime:2}),ability('next',20,50)];u.ready=[0,0];u.skillModes=['manual','manual'];
  assert.ok(b.requestCast(u,0));assert.ok(b.requestCast(u,1));
  if(cancel==='stun')b.addStatus(b.enemies[0],u,'stun');
  if(cancel==='mode')b.setSkillMode(0,1,'managed');
  if(cancel==='expire')for(let i=0;i<76;i++)b.step();else b.step();
  assert.equal(u.pendingCast,null);assert.equal(b.requestCast(u,0),false);
 }
});
test('same seed and mode choices yield the same combat and observing a policy does not draw random numbers',()=>{
 function result(){const {b,u}=arena();u.nextAttack=0;u.skillModes=['managed','auto','manual','managed'];for(let i=0;i<4;i++)u.ready[i]=0;for(let i=0;i<400;i++)b.step();return {mana:u.mana,hp:u.hp,events:b.events.history,seed:b.rng.seed};}
 assert.deepEqual(result(),result());
});

test('managed protection ignores hidden hit/crit outcomes of projectiles already in flight',()=>{
 const {b,u}=arena();u.skills=[ability('guard',10,0,{target:'self',effects:[{type:'shield',amount:100}]})];u.ready=[0];u.hp=20;
 const shot=b.fire(b.enemies[0],u);const before=evaluateSkill(b,u,0);shot.hit=!shot.hit;shot.crit=!shot.crit;shot.damage=99999;
 assert.deepEqual(evaluateSkill(b,u,0),before);
});
