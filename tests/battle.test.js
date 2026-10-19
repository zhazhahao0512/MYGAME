import test from 'node:test';
import assert from 'node:assert/strict';
import {Battle,STEP,hitChance,cooldown} from '../src/battle.js';
import {createRun,recruit} from '../src/model.js';
import {setSource} from '../src/combat/unit.js';
import {HEROES} from '../src/data.js';
function battle(options){const r=createRun(5);recruit(r,r.candidates[0]);recruit(r,r.candidates[0]);return new Battle(r,options);}
test('focus versus movement and ability haste follow agreed formulas',()=>{
  assert.equal(hitChance(100,200),.5);assert.equal(hitChance(120,200),.6);assert.equal(hitChance(200,100),1);assert.equal(hitChance(-5,100),0);assert.equal(cooldown(10,100),5);
});
test('damage snapshots at launch, settles only on impact, respects current shields, and lifesteal uses actual HP loss',()=>{
  const b=battle(),source=b.party[0],target=b.enemies[0];source.stats.attack=100;source.stats.crit=0;source.stats.lifeSteal=.1;source.stats.omni=0;source.stats.healing=0;source.hp=100;target.stats.armor=0;target.hp=500;
  const shot=b.fire(source,target,{duration:.1});assert.equal(target.hp,500);source.stats.attack=999;target.shield=30;
  b.settle(shot);assert.equal(target.hp,430);assert.equal(target.shield,0);assert.equal(source.hp,107);
});
test('a projectile bound to a dead enemy never hits the replacement in the same position',()=>{
  const b=battle(),old=b.enemies[0],shot=b.fire(b.party[0],old);old.hp=0;b.enemies[0]=b.spawn(0);const hp=b.enemies[0].hp;
  assert.notEqual(old.id,b.enemies[0].id);b.settle(shot);assert.equal(b.enemies[0].hp,hp);
});
test('a 0.1 second attack settles exactly at its fifth fixed step and cannot settle twice',()=>{
  const b=battle();
  for(const unit of [...b.party,...b.enemies]){unit.nextAttack=Infinity;unit.ready=[Infinity,Infinity,Infinity,Infinity];unit.stats.hpRegen=0;}
  const source=b.party[0],target=b.enemies[0];source.stats.attack=10;source.stats.crit=0;target.stats.armor=0;
  const hp=target.hp,shot=b.fire(source,target,{duration:.1});
  for(let i=0;i<4;i++)b.step();assert.equal(target.hp,hp);b.step();assert.equal(target.hp,hp-10);
  b.settle(shot);b.step();assert.equal(target.hp,hp-10);
});
test('timer expiry wins a same-tick race against scheduled respawn',()=>{
  const b=battle({duration:.1});b.enemies[0].hp=0;b.nextSpawn=5;const id=b.enemies[0].id;
  for(let i=0;i<5;i++)b.step();assert.equal(b.phase,'cleanup');assert.equal(b.enemies[0].id,id);assert.equal(b.enemies[0].hp,0);
});
test('dead enemies grant kill rewards only once',()=>{
  const b=battle(),source=b.party[0],target=b.enemies[0];source.stats.attack=999;source.stats.crit=0;target.hp=1;
  b.settle(b.fire(source,target));b.settle(b.fire(source,target));assert.equal(b.kills,1);assert.equal(b.gold,30);
});
test('manual ultimate consumes mana and cooldown once and rejects immediate second activation',()=>{
  const b=battle(),unit=b.party[0];unit.auto=false;unit.ready[3]=0;unit.mana=100;assert.equal(b.cast(unit,3),true);assert.equal(unit.mana,70);assert.equal(b.cast(unit,3),false);assert.equal(unit.mana,70);assert.equal(b.shots.length,5);
});
test('no unbounded heal-overflow and no healing on dead unit',()=>{
  const b=battle();b.party[1].hp=0;for(let i=0;i<100;i++)b.step();assert.equal(b.party[1].hp,0);assert.ok(b.party[0].hp<=b.party[0].stats.hp);
});
test('visual effects publish only settled impacts and remain bounded without altering combat',()=>{
  const b=battle(),target=b.enemies[0],source=b.party[0];source.stats.crit=0;
  const shot=b.fire(source,target,{duration:.1});assert.equal(b.effects.length,0);
  b.settle(shot);assert.equal(b.effects[0].type,'damage');assert.equal(b.effects[0].target,target.id);
  const count=b.effects.length;b.settle(shot);assert.equal(b.effects.length,count);
  const seed=b.rng.seed;
  for(let i=0;i<400;i++)b.emitEffect('heal',source,1);
  assert.equal(b.effects.length,256);assert.equal(b.rng.seed,seed);
});
test('consuming or ignoring visual events produces identical combat outcomes',()=>{
  const a=battle(),b=battle();
  for(let i=0;i<1500;i++){a.step();b.step();a.effects.length=0;}
  assert.deepEqual(a.result(),b.result());assert.deepEqual(a.party.map(u=>u.hp),b.party.map(u=>u.hp));assert.equal(a.rng.seed,b.rng.seed);
});
test('five versus five at 0.1s attacks and 0.8s skills completes deterministic bounded simulation',()=>{
  const r=createRun(42);r.party=HEROES.slice(0,5).map(h=>({hero:h.id,gear:[null,null,null,null],auto:true}));r.phase='ready';
  function simulate(){const b=new Battle(r,{duration:30});for(const u of [...b.party,...b.enemies]){setSource(u,'stress',{modifiers:Object.entries({attackSpeed:10,hp:1e7,manaRegen:1000,haste:1400}).map(([stat,value])=>({id:stat,stat,op:'override',value,priority:100}))});u.hp=u.stats.hp;}let maxShots=0;for(let i=0;i<1500;i++){b.step();maxShots=Math.max(maxShots,b.shots.length);}return {hp:b.party.map(u=>u.hp),shots:maxShots,tick:b.tick};}
  const start=performance.now(),a=simulate(),b=simulate();assert.deepEqual(a,b);assert.equal(a.tick,30/STEP);assert.ok(a.shots<150);assert.ok(performance.now()-start<5000);
});
