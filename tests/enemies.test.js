import test from 'node:test';
import assert from 'node:assert/strict';
import {Battle} from '../src/battle.js';
import * as M from '../src/model.js';
import {CHALLENGE_TYPES} from '../src/combat/tactics.js';
function runAt(floor=1,level=1){const run=M.createRun(42);run.floor=floor;run.level=level;run.phase='ready';run.party=['lishan','lanya','jinli','lingxi','shuoying'].slice(0,Math.min(5,floor+1)).map(hero=>({hero,gear:[null,null,null,null]}));run.party.forEach((_,i)=>M.recommendSkills(run,i));return run;}
test('enemy difficulty is fixed to floor, not player level, upgrades or purchased power',()=>{
 const a=new Battle(runAt(8,6)),run=runAt(8,30);run.party[0].gear[0]=M.makeItem(run,'blue_tempered_sword');
 const b=new Battle(run);assert.deepEqual(a.enemies.map(u=>u.stats),b.enemies.map(u=>u.stats));
 for(let f=2;f<=20;f++){const lower=new Battle(runAt(f-1)),higher=new Battle(runAt(f));assert.ok(higher.enemies[2].stats.hp>lower.enemies[2].stats.hp);}
});
test('normal frontliners require sustained real attacks and boss/challenge durability stays distinct',()=>{
 const b=new Battle(runAt());for(const e of b.enemies.slice(1))e.hp=0;b.nextSpawn=Infinity;
 const target=b.enemies[0];let first=null,death=null;const deal=b.dealDamage.bind(b);
 b.dealDamage=(s,t,shot)=>{const hp=t.hp;deal(s,t,shot);if(t===target&&t.hp<hp){first??=b.time;if(!t.hp)death=b.time;}};
 for(let i=0;i<1000&&target.hp>0;i++)b.step();assert.notEqual(death,null);assert.ok(death-first>=2&&death-first<15,`frontliner engagement ${death-first}s`);
 const late=new Battle(runAt(20,15)),boss=late.enemies[0],regular=late.enemies[1];
 assert.ok(boss.stats.hp>regular.stats.hp*2);assert.ok(late.spawn(1,CHALLENGE_TYPES[0]).stats.hp>regular.stats.hp*1.5);
});
test('opening remains playable for a low-output pair with only legal level-one skills and no gear',()=>{
 const run=runAt();run.party=['jinli','lishan'].map(hero=>({hero,gear:[null,null,null,null]}));run.party.forEach((_,i)=>M.recommendSkills(run,i));
 const b=new Battle(run);for(let i=0;i<6000&&['combat','cleanup'].includes(b.phase);i++)b.step();
 assert.equal(b.phase,'won');assert.ok(b.kills>=10);assert.ok(b.time>40,'end of spawning still requires cleanup');
});
test('durable enemies still grant one reward and calibrated kill XP; existing levels never decrease',()=>{
 const run=runAt();M.finishRound(run,{won:true,gold:360,kills:12,seconds:50});assert.equal(run.level,2);assert.equal(run.xp,12);assert.equal(run.gold,360);
 run.phase='ready';run.level=30;M.finishRound(run,{won:true,gold:30,kills:1,seconds:50});assert.equal(run.level,30);
 const b=new Battle(runAt()),target=b.enemies[0];b.dealDamage(b.party[0],target,{damage:1e6,vamp:0});b.dealDamage(b.party[0],target,{damage:1e6,vamp:0});assert.equal(b.kills,1);assert.equal(b.gold,30);
});

test('challenge stats clearly exceed same-archetype ordinary enemies',()=>{
 const b=new Battle(runAt(4,3));
 for(const [type,slot] of [[CHALLENGE_TYPES[0],0],[CHALLENGE_TYPES[1],4],[CHALLENGE_TYPES[2],2]]){
  const normal=b.enemies[slot],elite=b.spawn(slot,type);
  assert.ok(elite.stats.hp>=normal.stats.hp*2.99);assert.ok(elite.stats.attack>=normal.stats.attack*1.79);assert.ok(elite.reward>normal.reward);
 }
});
test('attack color and melee/ranged identity are captured at launch',()=>{
 const b=new Battle(runAt()),u=b.party[0];u.def={...u.def,color:'#123456',range:'melee'};
 const shot=b.fire(u,b.enemies[0]);u.def={...u.def,color:'#abcdef',range:'ranged'};
 assert.equal(shot.visualColor,'#123456');assert.equal(shot.attackRange,'melee');assert.equal(b.visualSource(u,shot).visualColor,'#123456');
});
