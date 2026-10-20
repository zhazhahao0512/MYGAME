import test from 'node:test';
import assert from 'node:assert/strict';
import {Battle} from '../src/battle.js';
import {createRun} from '../src/model.js';
import {PopupBudget,eventParts,feedbackStyle,FEEDBACK_COLORS} from '../src/renderer/feedback.js';
const fixture=()=>{const run=createRun(991);run.party=[{hero:'lishan',gear:[null,null,null,null],auto:true}];const b=new Battle(run);const source=b.party[0],target=b.enemies[0];source.hp=50;source.stats.crit=0;source.stats.attack=100;source.stats.healing=.5;source.stats.lifeSteal=.1;source.stats.omni=.2;target.hp=500;target.stats.armor=0;target.stats.resist=0;return {b,source,target};};
const event=(extra={})=>({id:1,tick:10,type:'damage',source:'hero-1',target:'enemy-1',side:'enemy',slot:0,origin:'attack',originId:'attack',amount:30,hpLoss:30,shieldLoss:0,crit:false,...extra});
test('shield absorption and HP loss stay separate; critical shield text remains blue',()=>{
 const {b,source,target}=fixture();target.shield=70;const shot=b.fire(source,target);shot.crit=true;b.settle(shot);
 const damage=b.effects.find(e=>e.type==='damage');assert.equal(damage.hpLoss,30);assert.equal(damage.shieldLoss,70);assert.equal(damage.source,source.id);
 const parts=eventParts(damage);assert.equal(parts.length,2);assert.equal(feedbackStyle(parts[0]).color,FEEDBACK_COLORS.critical);assert.equal(feedbackStyle(parts[1]).color,FEEDBACK_COLORS.shield);assert.match(feedbackStyle(parts[1]).text,/暴击 盾 −70/);
 const heal=b.effects.find(e=>e.type==='heal');assert.ok(Math.abs(heal.amount-13.5)<1e-8);assert.equal(heal.healingKind,'vamp');assert.equal(b.events.history.filter(e=>e.type==='heal').length,1);
});
test('pure shield hits cannot create lifesteal; full health has no false healing text',()=>{
 const {b,source,target}=fixture();target.shield=200;b.settle(b.fire(source,target));assert.equal(eventParts(b.effects[0]).length,1);assert.equal(b.effects.some(e=>e.type==='heal'),false);
 source.hp=source.stats.hp;target.shield=0;b.effects=[];b.settle(b.fire(source,target));assert.equal(b.effects.some(e=>e.type==='heal'),false);
});
test('skill vamp snapshots only omni; healing clips to missing health and identifies the skill',()=>{
 const {b,source,target}=fixture();const shot=b.fire(source,target,{skill:true,attack:1,power:0,originId:'stone-Q',skillKey:'Q'});
 source.stats.omni=0;source.stats.healing=9;source.hp=source.stats.hp-5;b.settle(shot);
 const heal=b.effects.find(e=>e.type==='heal');assert.equal(heal.amount,5);assert.equal(heal.healingKind,'omni');assert.equal(heal.skillKey,'Q');assert.match(feedbackStyle(eventParts(heal)[0]).text,/Q 全能 \+5/);
});
test('overkill and dead attackers cannot generate excess vamp',()=>{
 const {b,source,target}=fixture();target.hp=3;b.settle(b.fire(source,target));assert.ok(Math.abs(b.effects.find(e=>e.type==='heal').amount-1.35)<1e-8);
 const next=b.enemies[1];b.effects=[];const shot=b.fire(source,next);source.hp=0;b.settle(shot);assert.equal(b.effects.some(e=>e.type==='heal'),false);
});
test('natural regeneration batches actual recovery without adding heal triggers',()=>{
 const {b,source}=fixture();source.skills=[];source.triggers=[];source.nextAttack=9999;source.stats.hpRegen=10;source.stats.healing=0;source.hp=source.stats.hp-2;
 for(const enemy of b.enemies){enemy.skills=[];enemy.nextAttack=9999;}
 for(let n=0;n<50;n++)b.step();const regen=b.effects.filter(e=>e.healingKind==='regen');assert.equal(regen.length,1);assert.ok(Math.abs(regen[0].amount-2)<1e-8);assert.equal(b.events.history.some(e=>e.type==='heal'),false);
});
test('matching impacts merge actual amounts; different crit/source/target/kind never merge',()=>{
 const pool=new PopupBudget();pool.add(event({amount:.6,hpLoss:.6}));pool.add(event({id:2,tick:15,amount:.6,hpLoss:.6}));assert.equal(pool.groups.length,1);assert.equal(pool.groups[0].count,2);assert.equal(pool.groups[0].amount,1.2);assert.match(feedbackStyle(pool.groups[0]).text,/−1 ×2/);
 for(const extra of [{crit:true},{source:'hero-2'},{target:'enemy-2'},{originId:'stone-Q',origin:'skill',skillKey:'Q'}]){const p=new PopupBudget();p.add(event());p.add(event(extra));assert.equal(p.groups.length,2);}
 const p=new PopupBudget();p.add(event({shieldLoss:5}));assert.deepEqual(p.groups.map(g=>g.kind),['damage','absorb']);
});
test('aggregation uses simulation time, drops old instances, and freezes without new ticks',()=>{
 const p=new PopupBudget();p.add(event());p.add(event({tick:26}));assert.equal(p.groups.length,2);
 p.expire(30,new Set(['enemy-1']));const frozen=structuredClone(p.groups);p.expire(30,new Set(['enemy-1']));assert.deepEqual(p.groups,frozen);
 p.expire(30,new Set(['enemy-new']));assert.equal(p.groups.length,0);
});
test('per-unit and mobile budgets are bounded and selected feedback takes priority',()=>{
 const p=new PopupBudget();for(let i=0;i<100;i++)p.add(event({id:i,source:`hero-${i}`,target:`enemy-${i%10}`,tick:10+i%10}),'hero-0',12);
 assert.ok(p.groups.length<=12);for(const target of new Set(p.groups.map(g=>g.target)))assert.ok(p.groups.filter(g=>g.target===target).length<=2);assert.ok(p.groups.some(g=>g.source==='hero-0'));
});
test('consuming aggregated feedback cannot alter RNG, health, triggers or battle outcome',()=>{
 const a=fixture().b,b=fixture().b,p=new PopupBudget();let serial=0;
 for(let n=0;n<1200;n++){a.step();b.step();p.expire(a.tick,new Set(a.units().map(u=>u.id)));for(const e of a.effects){if(e.id>serial){p.add(e,a.party[0].id,12);serial=e.id;}}}
 assert.deepEqual(a.result(),b.result());assert.equal(a.rng.seed,b.rng.seed);assert.deepEqual(a.units().map(u=>[u.id,u.hp,u.mana,u.shield]),b.units().map(u=>[u.id,u.hp,u.mana,u.shield]));assert.deepEqual(a.events.history,b.events.history);
});
