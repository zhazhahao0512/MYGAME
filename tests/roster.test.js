import test from 'node:test';
import assert from 'node:assert/strict';
import {Battle} from '../src/battle.js';
import {HEROES} from '../src/data.js';
import * as M from '../src/model.js';
import {skillsFor} from '../src/combat/content.js';
import {setSource} from '../src/combat/unit.js';
import {initializeProgression,recommendedRanks,rankReason,growthOffers,chooseGrowth} from '../src/heroes/progression.js';
import {heroDamageOptions,incomingPressure} from '../src/heroes/mechanics.js';
import {evaluateSkill,chooseManagedSkill} from '../src/combat/casting.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
function configure(u,values){setSource(u,'fixture',{modifiers:Object.entries(values).map(([stat,value])=>({stat,value,op:'override',priority:100}))});}
function arena(ids=['lishan','jinli','shuoying','lingxi','lanya'],level=15){
 const r=M.createRun(42);r.level=level;r.phase='ready';r.candidates=[];
 r.party=ids.map(hero=>({hero,gear:Array(4).fill(null),skillModes:Array(4).fill('manual')}));r.party.forEach((_,i)=>M.recommendSkills(r,i));
 const b=new Battle(r,{duration:180});
 for(const u of b.units()){configure(u,{hpRegen:0,manaRegen:0,accuracy:1000,crit:0});u.nextAttack=Infinity;u.ready.fill(Infinity);}
 for(const e of b.enemies){configure(e,{hp:10000,armor:0,resist:0,attack:0,hpRegen:0,manaRegen:0});e.hp=10000;}
 return {r,b,u:b.party[0],t:b.enemies[0]};
}
const advance=(b,s)=>{for(let i=0;i<Math.ceil(s/b.stepSeconds);i++)b.step();};
function cast(b,u,i){u.ready[i]=0;u.mana=u.stats.mana;assert.equal(b.cast(u,i),true);return b.getSkill(u,i);}
const hurt=(b,source,target,damage,damageType='true')=>b.dealDamage(source,target,{damage,damageType,vamp:0,crit:false});
test('exactly five formal heroes have real independent kits and legal per-hero recommendations',()=>{
 assert.deepEqual(HEROES.map(h=>h.id),['lanya','lishan','jinli','shuoying','lingxi']);
 assert.throws(()=>skillsFor('stone'),/未知英雄/);
 for(const h of HEROES){
  assert.equal(skillsFor(h.id,[4,4,4,3]).length,4);
  for(let level=1;level<=15;level++){const r=recommendedRanks(level,h.id);assert.equal(r.reduce((a,b)=>a+b),level);if(level===2)assert.equal(Math.max(...r),1);if(level<5)assert.equal(r[3],0);}
  const r=arena([h.id],2).r;assert.throws(()=>M.upgradeSkill(r,0,0),/没有技能点/);
 }
 assert.equal(rankReason([3,1,0,1],5,0),'没有技能点');assert.equal(rankReason([3,1,0,0],5,0),'6级可升四级');
});
test('manual allocation is retained when filling recommendations and remains legal through level 15',()=>{
 const r=M.createRun(1);r.phase='ready';r.party=[{hero:'lingxi',gear:Array(4).fill(null)}];initializeProgression(r.party[0],1,r.seed);
 M.upgradeSkill(r,0,2);r.level=2;M.recommendSkills(r,0);assert.deepEqual(r.party[0].progression.ranks,[1,0,1,0]);
 for(let level=3;level<=15;level++){r.level=level;M.recommendSkills(r,0);assert.ok(M.parseSave(JSON.stringify(r)));}
 assert.deepEqual(r.party[0].progression.ranks,[4,4,4,3]);
});
test('legacy roster collisions migrate to five unique heroes without losing gear, growth choices or currency',()=>{
 const r=M.createRun(7);r.heroContentVersion=1;r.level=16;r.phase='ready';r.candidates=[];r.gold=987;
 r.party=['stone','blade','wind','ember','tide'].map(hero=>({hero,gear:[M.makeItem(r,'white_iron_sword'),null,null,null],skillModes:['auto','manual','managed','manual']}));
 for(const m of r.party){initializeProgression(m,16,r.seed,{legacy:true});m.progression.choices.push(growthOffers(m)[0].id);}
 const restored=M.parseSave(JSON.stringify(r));assert.ok(restored);assert.equal(new Set(restored.party.map(m=>m.hero)).size,5);
 assert.deepEqual(restored.party.map(m=>m.gear),r.party.map(m=>m.gear));assert.equal(restored.gold,987);
 assert.deepEqual(restored.party.map(m=>m.progression.choices),r.party.map(m=>m.progression.choices));
 assert.deepEqual(M.parseSave(JSON.stringify(restored)),restored);
 r.party[0].hero='unknown';assert.equal(M.parseSave(JSON.stringify(r)),null);
});
test('recruitment shrinks to two then one candidates and saves at both stages',()=>{
 const r=M.createRun(10);M.recruit(r,r.candidates[0]);M.recruit(r,r.candidates[0]);
 for(let floor=1;floor<=3;floor++){M.finishRound(r,{won:true,kills:0,gold:0});M.sellReward(r,0);M.nextFloor(r);assert.equal(r.candidates.length,Math.min(3,5-r.party.length));assert.ok(M.parseSave(JSON.stringify(r)));M.recruit(r,r.candidates[0]);}
 assert.equal(r.party.length,5);assert.equal(new Set(r.party.map(m=>m.hero)).size,5);
});
test('Lishan stores actual HP plus shield loss, caps resolve, and consumes it only on skill 1',()=>{
 const {b,u,t}=arena(['lishan']);hurt(b,t,u,100);near(u.heroState.resolve,18);
 cast(b,u,0);near(u.shield,210+.09*u.stats.hp+18);near(u.heroState.resolve,0);
 hurt(b,t,u,100);near(u.heroState.resolve,18);const hp=u.hp;hurt(b,t,u,50,'shield_piercing_magic');near(u.hp,hp-50);near(u.heroState.resolve,27);
 cast(b,u,3);hurt(b,t,u,100);near(u.heroState.resolve,63);assert.equal(b.skillReason(u,3),'承压状态中');
 hurt(b,t,u,100000);assert.equal(u.hp,0);assert.ok(u.heroState.resolve<=u.stats.hp*.08);
});
test('finite hero shields refresh independently, consume earliest expiry, and never erase unrelated shielding',()=>{
 const {b,u,t}=arena(['lishan']);u.shield=70;cast(b,u,3);const ult=260+.12*u.stats.hp;cast(b,u,0);const first=210+.09*u.stats.hp;
 hurt(b,t,u,100);near(u.shield,70+ult+first-100);advance(b,4);near(u.shield,70+ult);advance(b,4);near(u.shield,70);
});
test('taunt redirects only subsequent single-target actions and ends when its source dies',()=>{
 const {b,u,t}=arena(['lishan','lingxi']);configure(t,{attack:20,hpRegen:0,manaRegen:0,accuracy:1000});
 const ally=b.party[1];t.targetId=ally.id;t.baseRules.attackTarget='slot3';t.rules.attackTarget='slot3';
 const old=b.fire(t,ally,{duration:2});cast(b,u,1);advance(b,.2);
 assert.equal(b.target(t),u);assert.equal(old.target,ally.id);assert.equal(b.previewSkillTargets(t,{target:'enemy'})[0],u);
 u.hp=0;assert.notEqual(b.target(t),u);
});
test('Jinli 2 then 1 detonates once per living target and missed primary hits never mark',()=>{
 const {b,u,t}=arena(['jinli']);cast(b,u,1);advance(b,.4);assert.equal(t.heroState.marks.get(u.id).count,2);
 cast(b,u,0);advance(b,.52);near(10000-t.hp,120+280+114);assert.equal(t.heroState.marks.has(u.id),false);
 assert.equal(b.effects.filter(e=>e.originId==='jinli-passive'&&e.target===t.id).length,1);
 const shot=b.fire(u,t,{skill:true,...b.getSkill(u,1).effects[0]});shot.hit=false;b.settle(shot);assert.equal(t.heroState.marks.has(u.id),false);
});
test('marks expire at eight seconds, do not migrate to replacement instances, and use launch AP',()=>{
 const {b,u,t}=arena(['jinli']);const e=b.getSkill(u,1).effects[0];b.settle(b.fire(u,t,{skill:true,...e}));advance(b,8);assert.equal(t.heroState.marks.size,0);
 b.settle(b.fire(u,t,{skill:true,...e}));const shot=b.fire(u,t,{skill:true,...b.getSkill(u,0).effects[0]});u.stats.power=900;b.settle(shot);near(b.effects.findLast(e=>e.originId==='jinli-passive').amount,114);
 t.hp=0;b.enemies[0]=b.spawn(0);assert.equal(b.enemies[0].heroState,undefined);
});
test('Shuoying conditional accuracy affects only 1/4 against the marked instance, not ordinary attacks',()=>{
 const {b,u,t}=arena(['shuoying']);u.stats.accuracy=95;u.slot=1;t.slot=4;t.stats.evasion=0;b.commandTarget(0,t.id);
 cast(b,u,1);const e=b.getSkill(u,0).effects[0];assert.equal(heroDamageOptions(b,u,t,e).accuracy,24);
 assert.equal(heroDamageOptions(b,u,t,{attack:1}).accuracy,undefined);assert.equal(heroDamageOptions(b,u,b.enemies[1],e).accuracy,undefined);
 near(b.snapshot(u,t,0,true,e).damage,400);advance(b,5);assert.equal(heroDamageOptions(b,u,t,e).accuracy,undefined);
});
test('assassin snapshots missing HP and strict low-HP threshold, no kill reset or AP in basics',()=>{
 const {b,u,t}=arena(['shuoying']);const e=b.getSkill(u,3).effects[0];
 for(const [fraction,raw] of [[1,600],[.5,750],[.4,780],[.3,907.2]]){t.hp=t.stats.hp*fraction;near(b.snapshot(u,t,0,true,e).damage,raw);}
 t.hp=3000;const shot=b.fire(u,t,{skill:true,...e});t.hp=9000;u.stats.power=100;b.settle(shot);near(t.hp,9000-907.2);
 near(b.snapshot(u,t,1,false,{canMiss:false}).damage,u.stats.attack);
});
test('Lingxi checks low HP for every heal tick and cannot convert overheal into shielding',()=>{
 const {b,u}=arena(['lingxi']);u.hp=u.stats.hp*.39;const start=u.hp;
 cast(b,u,0);advance(b,.2);near(u.hp,start+260*1.12);advance(b,3);near(u.hp,start+260*1.12+3*38);assert.equal(u.shield,0);
 u.hp=u.stats.hp;cast(b,u,0);advance(b,3.2);near(u.hp,u.stats.hp);
});
test('group healing selects at release, caps at three distinct recipients, and continues after caster death',()=>{
 const {b,u}=arena(['lingxi','lishan','jinli','shuoying','lanya']);for(const a of b.party)a.hp=a.stats.hp*.5;
 cast(b,u,3);b.party[4].hp=b.party[4].stats.hp*.2;advance(b,.36);
 assert.equal(b.party.filter(a=>a.heroState?.heals.size).length,3);assert.ok(b.party[4].heroState?.heals.size);
 const target=b.party[4],hp=target.hp;u.hp=0;advance(b,1);near(target.hp,hp+50*1.12);
});
test('protection multiplies other reductions and never changes old projectiles or true damage',()=>{
 const {b,u,t}=arena(['lingxi']);const old=b.fire(t,u,{skill:true,amount:100,attack:0,power:0,damageType:'magic',canMiss:false});
 const damage=old.damage;cast(b,u,1);near(old.damage,damage);
 const next=b.snapshot(t,u,0,true,{amount:100,attack:0,power:0,damageType:'magic',canMiss:false});near(next.damage,damage*.81);
 near(b.snapshot(t,u,0,true,{amount:100,attack:0,power:0,damageType:'true'}).damage,100);
 advance(b,4);near(b.snapshot(t,u,0,true,{amount:100,attack:0,power:0,damageType:'magic'}).damage,damage);
});
test('managed heroes use conditional mechanics without RNG reads and support does not spend healing at full HP',()=>{
 const {b,u,t}=arena(['lingxi','lishan']);u.ready=[0,0,0,0];u.skillModes.fill('managed');const seed=b.rng.seed;
 assert.equal(evaluateSkill(b,u,0),null);assert.equal(evaluateSkill(b,u,3),null);
 const ally=b.party[1];ally.hp=200;configure(t,{attack:200,hpRegen:0,manaRegen:0,accuracy:1000});t.targetId=ally.id;
 assert.ok(incomingPressure(b,ally)>0);assert.equal(evaluateSkill(b,u,0).band,1);assert.equal(chooseManagedSkill(b,u),0);assert.equal(b.rng.seed,seed);
});
