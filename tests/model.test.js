import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../src/model.js';
import { HEROES } from '../src/data.js';
const ready=()=>{const r=M.createRun(20261015);M.recruit(r,r.candidates[0]);M.recruit(r,r.candidates[0]);return r;};
const shop=()=>{const r=ready();M.finishRound(r,{won:true,kills:25,gold:750,seconds:25});return r;};

test('initial choice plus four recruitment rounds yields five unique heroes with three candidates each',()=>{
  const r=ready();assert.equal(r.party.length,2);
  for(let floor=1;floor<=4;floor++){
    assert.equal(r.floor,floor);M.finishRound(r,{won:true,gold:0,kills:0});M.sellReward(r,0);M.nextFloor(r);
    if(floor<4){assert.equal(r.candidates.length,3);assert.equal(new Set(r.candidates).size,3);assert.ok(r.candidates.every(id=>!r.party.some(h=>h.hero===id)));M.recruit(r,r.candidates[0]);}
  }
  assert.equal(r.party.length,5);assert.equal(new Set(r.party.map(h=>h.hero)).size,5);assert.equal(r.phase,'ready');
});
test('chest grants one single-option reroll and preserves other options across save restoration',()=>{
  const r=shop(),before=structuredClone(r.chest.options);M.refreshChest(r,1);
  assert.deepEqual(r.chest.options[0],before[0]);assert.deepEqual(r.chest.options[2],before[2]);
  assert.notEqual(r.chest.options[1].uid,before[1].uid);assert.throws(()=>M.refreshChest(r,0));
  const restored=M.parseSave(JSON.stringify(r));assert.deepEqual(restored.chest,r.chest);assert.throws(()=>M.refreshChest(restored,2));
});
test('chest items can be sold exactly once, and a pending chest blocks departure',()=>{
  const r=shop();assert.throws(()=>M.nextFloor(r));const expected=r.gold+M.salePrice(r.chest.options[0]);
  M.sellReward(r,0);assert.equal(r.gold,expected);assert.throws(()=>M.sellReward(r,1));M.nextFloor(r);assert.equal(r.floor,2);
});
test('orange limit is per hero, replacement in the same slot is legal and invalid purchase is atomic',()=>{
  const r=shop();r.gold=5000;r.party[0].gear[0]=M.makeItem(r,5);r.shop[0]=M.makeItem(r,5);
  const before=JSON.stringify(r);assert.throws(()=>M.acquire(r,'shop',0,0,1),/橙装/);assert.equal(JSON.stringify(r),before);
  M.acquire(r,'shop',0,0,0);assert.equal(r.party[0].gear.filter(Boolean).length,1);
  r.shop[1]=M.makeItem(r,5);M.acquire(r,'shop',1,1,0);assert.equal(r.party[1].gear[0].rarity,'orange');
});
test('full-slot replacement sells exactly the old item, deducts price, and does not create a bag',()=>{
  const r=shop();r.gold=2000;r.party[0].gear[2]=M.makeItem(r,2);const old=r.party[0].gear[2],item=r.shop[0],expected=r.gold-item.price+M.salePrice(old);
  M.acquire(r,'shop',0,0,2);assert.equal(r.gold,expected);assert.equal(r.party[0].gear[2].uid,item.uid);assert.equal(r.shop[0],null);assert.equal(r.inventory,undefined);assert.throws(()=>M.acquire(r,'shop',0,0,3));
});
test('failed affordability check leaves items and money unchanged',()=>{
  const r=shop();r.gold=0;const before=JSON.stringify(r);assert.throws(()=>M.acquire(r,'shop',0,0,0),/金币/);assert.equal(JSON.stringify(r),before);
});
test('equipment preview is read-only, includes replacement sale, and agrees with committed capped stats',()=>{
  const r=shop();r.gold=1000;
  r.party[0].gear[0]={...M.makeItem(r,0),stats:{attack:20,crit:1}};
  r.shop[0]={...M.makeItem(r,1),stats:{power:30,crit:2}};
  const before=structuredClone(r),stats=M.statsFor(r.party[0],r.level);
  const quote=M.previewAcquisition(r,'shop',0,0,0);
  assert.deepEqual(r,before);assert.equal(quote.reason,'');
  assert.equal(quote.goldAfter,1000+M.salePrice(r.party[0].gear[0])-r.shop[0].price);
  assert.ok(quote.changes.some(c=>c.key==='attack'&&c.after<c.before));
  assert.ok(quote.changes.some(c=>c.key==='power'&&c.after>c.before));
  assert.ok(!quote.changes.some(c=>c.key==='crit'),'already capped crit does not show a false increase');
  M.acquire(r,'shop',0,0,0);assert.equal(r.gold,quote.goldAfter);
  const after=M.statsFor(r.party[0],r.level);
  for(const change of quote.changes){assert.equal(change.before,stats[change.key]);assert.equal(change.after,after[change.key]);}
});
test('equipment preview reports blocking rules before confirmation and acquisition still revalidates',()=>{
  const r=shop();r.party[0].gear[0]=M.makeItem(r,5);r.shop[0]=M.makeItem(r,5);r.gold=5000;
  assert.match(M.previewAcquisition(r,'shop',0,0,1).reason,/橙装/);
  assert.equal(M.previewAcquisition(r,'shop',0,0,0).reason,'');
  const quote=M.previewAcquisition(r,'shop',0,1,0);assert.equal(quote.reason,'');
  r.gold=0;const before=structuredClone(r);
  assert.match(M.previewAcquisition(r,'shop',0,1,0).reason,/金币/);
  assert.throws(()=>M.acquire(r,'shop',0,1,0),/金币/);assert.deepEqual(r,before);
});
test('transfer swaps equipped items, rejects a resulting second orange without partial mutations',()=>{
  const r=shop();r.party[0].gear[0]=M.makeItem(r,5);r.party[1].gear[0]=M.makeItem(r,5);r.party[1].gear[1]=M.makeItem(r,2);
  const before=JSON.stringify(r);assert.throws(()=>M.transferGear(r,0,0,1,1));assert.equal(JSON.stringify(r),before);
  const a=r.party[0].gear[0].uid,b=r.party[1].gear[0].uid;M.transferGear(r,0,0,1,0);assert.equal(r.party[0].gear[0].uid,b);assert.equal(r.party[1].gear[0].uid,a);
});
test('equipment can only be changed in shop and stats are recomputed after removal',()=>{
  const r=shop(),base=M.statsFor(r.party[0],r.level);r.shop[0]={...M.makeItem(r,0),stats:{attack:10}};M.acquire(r,'shop',0,0,0);
  assert.equal(M.statsFor(r.party[0],r.level).attack,base.attack+10);M.sellGear(r,0,0);assert.equal(M.statsFor(r.party[0],r.level).attack,base.attack);
  r.phase='ready';assert.throws(()=>M.transferGear(r,0,0,1,0));assert.throws(()=>M.sellGear(r,0,0));assert.throws(()=>M.moveHero(r,0,1));
});
test('refresh prices increase per shop, old stock is discarded, and price resets next round',()=>{
  const r=shop();r.gold=1000;const previous=r.shop.map(i=>i.uid);M.refreshShop(r);assert.equal(r.gold,920);assert.equal(M.refreshCost(r),120);assert.ok(r.shop.every(i=>!previous.includes(i.uid)));
  M.sellReward(r,0);M.nextFloor(r);M.recruit(r,r.candidates[0]);M.finishRound(r,{won:true,kills:0,gold:0});assert.equal(M.refreshCost(r),80);
});
test('no clear gold bonus is awarded; final chest precedes victory',()=>{
  const r=ready();r.floor=20;M.finishRound(r,{won:true,kills:5,gold:15});assert.equal(r.gold,15);assert.equal(r.phase,'shop');M.sellReward(r,0);M.nextFloor(r);assert.equal(r.phase,'victory');
});
test('save validation rejects corrupted state and restores battle at a clean checkpoint',()=>{
  assert.equal(M.parseSave('invalid JSON'),null);const r=ready();r.phase='battle';assert.equal(M.parseSave(JSON.stringify(r)).phase,'ready');
  r.party[0].gear.push(null);assert.equal(M.parseSave(JSON.stringify(r)),null);
  const bad=shop();bad.chest.options=[];assert.equal(M.parseSave(JSON.stringify(bad)),null);
});
test('same seed produces the same recruitment and shop results',()=>{
  assert.deepEqual(M.createRun(81).candidates,M.createRun(81).candidates);assert.deepEqual(shop().shop,shop().shop);assert.equal(HEROES.length>=7,true);
});

test('transfer preview is read-only, includes both heroes, and matches confirmed swap',()=>{
  const r=shop();r.party[0].gear[0]={...M.makeItem(r,1),stats:{attack:10}};r.party[1].gear[2]={...M.makeItem(r,1),stats:{power:20}};
  const before=structuredClone(r),quote=M.previewTransfer(r,0,0,1,2);
  assert.deepEqual(r,before);assert.equal(quote.reason,'');assert.equal(quote.changes.length,2);
  M.transferGear(r,0,0,1,2);
  for(const group of quote.changes){const member=r.party.find(h=>h.hero===group.hero),stats=M.statsFor(member,r.level,r.augments);for(const change of group.stats)assert.equal(stats[change.key],change.after);}
  assert.equal(r.gold,before.gold);assert.equal(r.party[0].gear[0].uid,before.party[1].gear[2].uid);
});
test('hero swap retains complete loadouts and rejects invalid positions or combat',()=>{
  const r=shop();r.party[0].gear[0]=M.makeItem(r,5);r.party[0].auto=false;
  const before=structuredClone(r.party);M.swapHeroes(r,0,1);assert.deepEqual(r.party,[before[1],before[0]]);
  const current=structuredClone(r);for(const index of [-1,8,NaN,0.5])assert.throws(()=>M.swapHeroes(r,0,index));assert.deepEqual(r,current);
  r.phase='battle';assert.throws(()=>M.swapHeroes(r,0,1),/商店/);
});
