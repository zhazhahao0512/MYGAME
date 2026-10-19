import test from 'node:test';
import assert from 'node:assert/strict';
import {Battle,STEP} from '../src/battle.js';
import {BATTLE_V2,CHALLENGE_TYPES,normalizeTactics} from '../src/combat/tactics.js';
import * as M from '../src/model.js';
import {setSource,removeSource} from '../src/combat/unit.js';
function setup(options={}){
 const run=M.createRun(42);M.recruit(run,run.candidates[0]);M.recruit(run,run.candidates[0]);
 const b=new Battle(run,{duration:30,...options});
 for(const u of b.units()){u.nextAttack=Infinity;u.ready.fill(Infinity);u.stats.hpRegen=0;}
 return b;
}
test('five strategies rank actual hit chance, HP ratio, absolute HP and fixed slot distances',()=>{
 const b=setup(),u=b.party[0];
 for(const e of b.enemies){e.hp=50;e.stats.hp=100;e.stats.evasion=200;}
 b.enemies[3].hp=20;b.enemies[3].stats.hp=1000;b.enemies[2].hp=10;b.enemies[4].stats.evasion=0;
 const seed=b.rng.seed;
 for(const [mode,expected] of [['hit',4],['ratio',3],['health',2],['near',0],['far',4]]){
  assert.ok(b.setTactics(0,{mode}));assert.equal(b.target(u).slot,expected);
 }
 assert.equal(b.rng.seed,seed,'deterministic strategy queries do not draw random values');
});
test('manual instruction binds current instance, then persists region and strategy after death',()=>{
 const b=setup(),u=b.party[0];b.setTactics(0,{mode:'health'});
 b.enemies[2].hp=30;b.enemies[3].hp=50;b.enemies[4].hp=20;b.enemies[0].hp=1;
 assert.ok(b.commandTarget(0,b.enemies[3].id));assert.equal(b.target(u).slot,3);
 b.enemies[3].hp=0;assert.equal(b.target(u).slot,4,'nearby region is filtered before global lowest HP');
 b.enemies[4].hp=0;assert.equal(b.target(u).slot,2);
 b.enemies[2].hp=0;assert.equal(b.target(u).slot,0,'fallback cannot idle while remote enemies live');
 assert.equal(b.run.party[0].tactics.preferredSlot,3);
 const current=b.enemies[0];b.enemies[3]=b.spawn(3);assert.equal(b.target(u).id,current.id,'new spawns do not steal live locks');
 current.hp=0;assert.equal(b.target(u).slot,3);
 b.setTactics(0,{preferredSlot:null});assert.equal(u.tactics.mode,'health');
});
test('commands do not reset attack timers, mana or projectiles; invalid commands are rejected',()=>{
 const b=setup(),u=b.party[0],old=b.enemies[0],shot=b.fire(u,old);
 u.nextAttack=shot.end;const before={mana:u.mana,next:u.nextAttack,ready:[...u.ready]};
 assert.equal(b.commandTarget(0,b.enemies[4].id),true);
 assert.equal(shot.target,old.id);assert.equal(u.nextAttack,before.next);assert.equal(u.mana,before.mana);assert.deepEqual(u.ready,before.ready);
 assert.equal(b.setTactics(0,{mode:'bad'}),false);assert.equal(b.setTactics(0,{preferredSlot:5}),false);assert.equal(b.commandTarget(0,'missing'),false);
});
test('status rule overrides supersede defaults and invalidate old locks when removed',()=>{
 const b=setup(),u=b.party[0];b.setTactics(0,{mode:'far'});assert.equal(b.target(u).slot,4);
 setSource(u,'taunt-test',{rules:[{rule:'attackTarget',value:'slot3',priority:10}]});
 assert.equal(b.target(u).slot,2);removeSource(u,'taunt-test');assert.equal(b.target(u).slot,4);
});
test('tactics survive checkpoint reload, shop swaps and next battle, old saves get defaults',()=>{
 const b=setup();b.commandTarget(0,b.enemies[4].id);b.setTactics(0,{mode:'ratio'},b.enemies[4].id);
 const run=b.run;
 run.phase='ready';const restored=M.parseSave(JSON.stringify(run));assert.deepEqual(restored.party[0].tactics,{mode:'ratio',preferredSlot:4});
 restored.phase='shop';M.swapHeroes(restored,0,1);const next=new Battle(restored);assert.equal(next.party[1].tactics.preferredSlot,4);assert.equal(next.party[1].targetId,null);
 delete run.party[0].tactics;run.party[1].tactics={mode:'unknown',preferredSlot:-1};
 assert.deepEqual(M.parseSave(JSON.stringify(run)).party.map(m=>m.tactics),[normalizeTactics(),normalizeTactics()]);
 assert.deepEqual(M.createRun(42).party,[]);
});
test('deaths retain fixed slots until batch time; new instances never receive old projectile damage',()=>{
 const b=setup(),ids=b.enemies.map(u=>u.id),old=b.enemies[0],shot=b.fire(b.party[0],old,{duration:10});old.hp=0;
 for(let i=0;i<Math.round(BATTLE_V2.spawnSeconds/STEP)-1;i++)b.step();
 assert.deepEqual(b.enemies.map(u=>u.id),ids);b.step();assert.notEqual(b.enemies[0].id,ids[0]);assert.deepEqual(b.enemies.slice(1).map(u=>u.id),ids.slice(1));
 const hp=b.enemies[0].hp;b.settle(shot);assert.equal(b.enemies[0].hp,hp);
});
test('challenges enter vacancies immediately, reject full boards and duplicate clicks without cost',()=>{
 const b=setup(),id=b.challengeOffers[0].id,ids=b.enemies.map(u=>u.id),seed=b.offerRng.seed;
 assert.equal(b.canAcceptChallenge(id),false);assert.equal(b.acceptChallenge(id),false);assert.deepEqual(b.enemies.map(u=>u.id),ids);assert.equal(b.offerRng.seed,seed);
 const offer=b.challengeOffers[0],slot=offer.type.positions[0],old=b.enemies[slot],shot=b.fire(b.party[0],old,{duration:10});old.hp=0;
 const next=b.nextSpawn;assert.ok(b.canAcceptChallenge(id));assert.ok(b.acceptChallenge(id));assert.equal(b.acceptChallenge(id),false);
 assert.notEqual(b.enemies[slot].id,old.id);assert.equal(b.enemies[slot].challenge,true);assert.equal(b.nextSpawn,next);assert.equal(b.tick,0);assert.equal(b.gold,0);
 const hp=b.enemies[slot].hp;b.settle(shot);assert.equal(b.enemies[slot].hp,hp,'old shot does not hit immediate replacement');
});
test('recommended positions fall back to another vacancy and rewards happen once on kill',()=>{
 const b=setup();b.challengeOffers[0].type=CHALLENGE_TYPES[0];b.enemies[4].hp=0;
 assert.ok(b.acceptChallenge(b.challengeOffers[0].id));const u=b.enemies[4];assert.equal(u.name,CHALLENGE_TYPES[0].name);assert.equal(b.living('enemy').length,5);
 b.dealDamage(b.party[0],u,{damage:1e9,vamp:0});b.dealDamage(b.party[0],u,{damage:1e9,vamp:0});assert.equal(b.gold,180);assert.equal(b.kills,1);
});
test('expiry and round deadline reject stale offers; regular batches fill all vacancies',()=>{
 const b=setup(),offer=b.challengeOffers[0];b.enemies.forEach(u=>u.hp=0);b.tick=offer.expiresAt;
 assert.equal(b.acceptChallenge(offer.id),false);b.refreshSpawns();assert.ok(b.challengeOffers.every(o=>o.id!==offer.id));assert.equal(b.living('enemy').length,5);
 const c=setup();c.enemies[0].hp=0;c.tick=c.durationTicks;assert.equal(c.acceptChallenge(c.challengeOffers[0].id),false);
});
test('timer expiry beats replenishment and new challenges; live challenges still require cleanup',()=>{
 const b=setup({duration:.1});b.enemies[0].hp=0;b.challengeOffers[0].type=CHALLENGE_TYPES[0];assert.ok(b.acceptChallenge(b.challengeOffers[0].id));
 b.nextSpawn=5;b.enemies[1].hp=0;const id=b.enemies[1].id;
 for(let i=0;i<5;i++)b.step();assert.equal(b.phase,'cleanup');assert.equal(b.enemies[1].id,id);assert.equal(b.challengeOffers.length,0);
 assert.equal(b.acceptChallenge('anything'),false);assert.ok(b.enemies[0].hp>0);
 for(const e of b.enemies)e.hp=0;b.step();assert.equal(b.phase,'won');
});
