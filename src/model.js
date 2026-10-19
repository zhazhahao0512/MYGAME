import { memberBaseStats,prepareHeroSave } from './heroes/integration.js';
import { initializeProgression } from './heroes/progression.js';
import { migrateAccuracyBonuses } from './heroes/accuracy.js';
export { upgradeSkill,recommendSkills,chooseGrowth,progressionSummary } from './heroes/progression.js';
import { BASE, HEROES, heroById, ITEMS, LEGACY_RARITIES, RULES } from './data.js';
import { normalizeSkillModes } from './combat/casting.js';
import { normalizeTactics } from './combat/tactics.js';
import { resolveStats } from './combat/attributes.js';
import { loadoutModifiers, AUGMENTS, EQUIPMENT_EFFECTS } from './combat/content.js';
import { EQUIPMENT, equipmentById, GOLD_SCALE } from './equipment.js';
export const SAVE_KEY = 'squad-expedition.save.v1';
const fail = message => { throw new Error(message); };
export function random(run) { let t = run.seed += 0x6d2b79f5; t = Math.imul(t ^ t >>> 15,t|1); t ^= t + Math.imul(t ^ t >>> 7,t|61); run.seed >>>= 0; return ((t ^ t >>> 14) >>> 0)/4294967296; }
export function sample(run, entries, count) { const list=[...entries]; for(let i=list.length-1;i>0;i--){const j=Math.floor(random(run)*(i+1));[list[i],list[j]]=[list[j],list[i]];} return list.slice(0,count); }
export function createRun(seed = Date.now() >>> 0) {
  const run={version:2,heroContentVersion:1,seed,floor:1,level:1,xp:0,gold:0,kills:0,earned:0,party:[],augments:[],phase:'initial',candidates:[],shop:[],refreshes:0,chest:null,serial:0,lastRound:null,createdAt:Date.now()};
  run.candidates=sample(run,HEROES.map(h=>h.id),3); return run;
}
export function baseStatsFor(member, level=1) {
  return memberBaseStats(member,level,BASE);
}
export function statsFor(member, level=1, augments=[]) {return resolveStats(baseStatsFor(member,level),loadoutModifiers(member,augments));}
export function chooseAugment(run,id) {
  if(run.phase!=='shop'||run.floor!==1||!run.chest?.claimed||(run.augments||[]).length||!AUGMENTS.some(a=>a.id===id))fail('当前无法领取这项强化');
  run.augments=[id];
}
export function recruit(run,id) {
  if(!['initial','recruit'].includes(run.phase)||!run.candidates.includes(id)) fail('这个英雄不在当前候选中');
  if(run.party.length>=RULES.party||run.party.some(h=>h.hero===id)) fail('无法招募重复英雄');
  const initial=run.phase==='initial'; run.party.push({hero:id,gear:[null,null,null,null],skillModes:normalizeSkillModes(),tactics:normalizeTactics()});
  initializeProgression(run.party.at(-1),run.level,run.seed);
  if(initial){run.phase='recruit';run.candidates=sample(run,HEROES.map(h=>h.id).filter(id=>!run.party.some(h=>h.hero===id)),3);}
  else {run.phase='ready';run.candidates=[];}
}
// Numeric rarity arguments remain a compatibility entry point for legacy test fixtures.
// All live offers use the fixed catalogue; explicit formal IDs are stable across rarities.
export function makeItem(run, forcedRarity, forcedBase) {
  const requested=forcedBase|| (equipmentById(forcedRarity)?forcedRarity:null);
  if((requested&&!equipmentById(requested))||typeof forcedRarity==='number')return makeLegacyItem(run,forcedRarity,forcedBase);
  let pool=EQUIPMENT;
  if(requested)pool=[equipmentById(requested)];
  else {
    const f=run.floor,weights=[Math.max(30,85-f*3),Math.min(50,14+f*2),Math.min(25,1+f)];
    let roll=random(run)*weights.reduce((a,b)=>a+b,0);
    const rarity=forcedRarity||['white','blue','purple'][weights.findIndex(w=>(roll-=w)<0)];
    pool=pool.filter(item=>item.rarity===rarity);
  }
  if(!pool.length)fail('该品级暂无正式装备');
  let roll=random(run)*pool.reduce((sum,item)=>sum+item.weight,0);
  const definition=pool.find(item=>(roll-=item.weight)<0)||pool.at(-1);
  return instantiate(run,definition);
}
function instantiate(run,definition) {
  return {uid:`item-${++run.serial}`,base:definition.id,name:definition.name,mark:definition.mark,rarity:definition.rarity,stats:{...definition.stats},price:definition.price};
}
export function makeLegacyItem(run, index=0, baseId) {
  const base=baseId?ITEMS.find(item=>item.id===baseId):ITEMS[Math.floor(random(run)*ITEMS.length)],rarity=LEGACY_RARITIES[index];
  if(!base||!rarity)fail('旧装备模板不存在');
  return {uid:`item-${++run.serial}`,base:base.id,name:base.name,mark:base.mark,rarity:rarity.id,
    stats:migrateAccuracyBonuses(Object.fromEntries(Object.entries(base.stats).map(([k,v])=>[k,Number((v*rarity.scale).toFixed(3))]))),price:rarity.price*GOLD_SCALE,
    effect:rarity.id==='orange'?(EQUIPMENT_EFFECTS[base.id]?.description||'特殊效果预留，待后续设计'):null};
}
export function makeChoices(run,count,excluded=[]) {
  const choices=[];const keys=new Set(excluded.map(i=>`${i.base}:${i.rarity}`));
  for(let n=0;choices.length<count&&n<500;n++){const item=makeItem(run);const key=`${item.base}:${item.rarity}`;if(!keys.has(key)){choices.push(item);keys.add(key);}}
  return choices;
}
export function finishRound(run, result) {
  if(!['ready','battle'].includes(run.phase)) fail('当前不在战斗阶段');
  run.gold+=result.gold;run.earned+=result.gold;run.kills+=result.kills;run.xp+=result.kills;
  run.level=Math.max(run.level,1+Math.floor(run.xp/20));run.lastRound={...result,floor:run.floor};
  if(!result.won){run.phase='defeat';return;}
  run.phase='shop';run.shop=makeChoices(run,4);run.refreshes=0;
  run.chest={options:makeChoices(run,3),refreshUsed:false,claimed:false};
}
export const refreshCost = run => 80+run.refreshes*40;
export function refreshShop(run) {
  if(run.phase!=='shop') fail('只能在商店刷新');
  const cost=refreshCost(run);if(run.gold<cost) fail('金币不足');
  run.gold-=cost;run.refreshes++;run.shop=makeChoices(run,4);
}
export function refreshChest(run,index) {
  if(run.phase!=='shop'||!run.chest||run.chest.claimed||run.chest.refreshUsed||!run.chest.options[index]) fail('宝箱刷新机会已用完');
  const others=run.chest.options.filter((_,i)=>i!==index);
  run.chest.options[index]=makeChoices(run,1,[...others,run.chest.options[index]])[0];run.chest.refreshUsed=true;
}
export const salePrice = item => Math.floor(item.price/2);
export function getOffer(run,source,index) {
  if(run.phase!=='shop') fail('只能在商店调整装备');
  if(source!=='shop'&&source!=='chest') fail('装备来源无效');
  if(source==='chest'&&run.chest?.claimed) fail('宝箱已经领取');
  const item=source==='shop'?run.shop[index]:run.chest?.options[index];if(!item) fail('装备已不存在');return item;
}
export function validateLoadout(gear) { return gear.length===4 && gear.filter(i=>i?.rarity==='orange').length<=1; }
export function previewAcquisition(run,source,index,heroIndex,slot) {
  const item=getOffer(run,source,index);const member=run.party[heroIndex];
  if(!member||!Number.isInteger(slot)||slot<0||slot>=4) fail('请选择有效装备槽');
  const old=member.gear[slot], next=[...member.gear];next[slot]=item;
  const cost=source==='shop'?item.price:0;
  const refund=old?salePrice(old):0,goldAfter=run.gold+refund-cost;
  const reason=!validateLoadout(next)?'每名英雄最多穿戴一件橙装，请替换原有橙装':goldAfter<0?'金币不足':'';
  const before=statsFor(member,run.level,run.augments),after=statsFor({...member,gear:next},run.level,run.augments);
  const changes=Object.keys(BASE).filter(key=>Math.abs(after[key]-before[key])>1e-8).map(key=>({key,before:before[key],after:after[key]}));
  return {item,old,gear:next,cost,refund,goldAfter,reason,changes};
}
export function acquire(run,source,index,heroIndex,slot) {
  const quote=previewAcquisition(run,source,index,heroIndex,slot);
  if(quote.reason)fail(quote.reason);
  run.gold=quote.goldAfter;run.party[heroIndex].gear=quote.gear;
  if(source==='shop')run.shop[index]=null;else run.chest.claimed=true;
}
export function sellReward(run,index) {const item=getOffer(run,'chest',index);run.gold+=salePrice(item);run.chest.claimed=true;}
export function sellGear(run,heroIndex,slot) {
  if(run.phase!=='shop')fail('只能在商店出售装备');const member=run.party[heroIndex];const item=member?.gear[slot];if(!item)fail('这里没有装备');run.gold+=salePrice(item);member.gear[slot]=null;
}
export function previewTransfer(run,fromHero,fromSlot,toHero,toSlot) {
  if(run.phase!=='shop')fail('只能在商店转移装备');
  if(![fromSlot,toSlot].every(n=>Number.isInteger(n)&&n>=0&&n<4))fail('装备槽无效');
  const from=run.party[fromHero],to=run.party[toHero];if(!from||!to||!from.gear[fromSlot])fail('请选择装备');
  const a=[...from.gear],b=from===to?a:[...to.gear];[a[fromSlot],b[toSlot]]=[b[toSlot],a[fromSlot]];
  const reason=!validateLoadout(a)||!validateLoadout(b)?'交换后每名英雄仍只能穿戴一件橙装':'';
  const changes=(from===to?[[from,a]]:[[from,a],[to,b]]).map(([member,gear])=>{
    const before=statsFor(member,run.level,run.augments),after=statsFor({...member,gear},run.level,run.augments);
    return {hero:member.hero,stats:Object.keys(BASE).filter(key=>Math.abs(after[key]-before[key])>1e-8).map(key=>({key,before:before[key],after:after[key]}))};
  });
  return {item:from.gear[fromSlot],old:to.gear[toSlot],a,b,reason,changes};
}
export function transferGear(run,fromHero,fromSlot,toHero,toSlot) {
  const quote=previewTransfer(run,fromHero,fromSlot,toHero,toSlot);
  if(quote.reason)fail(quote.reason);
  run.party[fromHero].gear=quote.a;run.party[toHero].gear=quote.b;
}
export function swapHeroes(run,from,to) {
  if(run.phase!=='shop')fail('只能在商店调整站位');
  if(![from,to].every(n=>Number.isInteger(n)&&n>=0&&n<run.party.length))fail('请选择有效英雄');
  [run.party[from],run.party[to]]=[run.party[to],run.party[from]];
}
export function moveHero(run,index,direction) {
  if(run.phase!=='shop')fail('只能在商店调整站位');const dest=index+direction;
  if(dest<0||dest>=run.party.length)return;swapHeroes(run,index,dest);
}
export function nextFloor(run) {
  if(run.phase!=='shop'||!run.chest?.claimed)fail('请先领取或出售宝箱奖励');
  if(run.floor===RULES.floors){run.phase='victory';return;}
  run.floor++;run.shop=[];run.chest=null;
  if(run.floor<=4){run.phase='recruit';run.candidates=sample(run,HEROES.map(h=>h.id).filter(id=>!run.party.some(h=>h.hero===id)),3);}
  else run.phase='ready';
}

function validItem(item) {
  return item===null || !!(item && typeof item.uid==='string' && (equipmentById(item.base)||ITEMS.some(i=>i.id===item.base)) && LEGACY_RARITIES.some(r=>r.id===item.rarity)
    && typeof item.name==='string' && typeof item.mark==='string' && Number.isFinite(item.price)&&item.price>=0&&item.stats&&Object.entries(item.stats).every(([k,v])=>Object.hasOwn(BASE,k)&&Number.isFinite(v)));
}
export function parseSave(raw) {
  try {
    const run=JSON.parse(raw);
    if(!run||![1,2].includes(run.version)||!Number.isInteger(run.floor)||run.floor<1||run.floor>20||!['initial','recruit','ready','battle','shop','victory','defeat'].includes(run.phase))return null;
    if(run.augments===undefined)run.augments=[];
    if(!Array.isArray(run.augments)||run.augments.length>1||run.augments.some(id=>!AUGMENTS.some(a=>a.id===id)))return null;
    if(!['gold','xp','level','seed','serial','kills','earned','refreshes'].every(k=>Number.isFinite(run[k])&&run[k]>=0))return null;
    if(!Array.isArray(run.party)||run.party.length>5||new Set(run.party.map(h=>h.hero)).size!==run.party.length)return null;
    if(!run.party.every(h=>heroById(h.hero)&&Array.isArray(h.gear)&&validateLoadout(h.gear)&&h.gear.every(validItem)))return null;
    if(!Array.isArray(run.candidates)||run.candidates.some(id=>!heroById(id))||!Array.isArray(run.shop)||!run.shop.every(validItem))return null;
    if(['initial','recruit'].includes(run.phase)&&(run.candidates.length!==3||new Set(run.candidates).size!==3||run.candidates.some(id=>run.party.some(h=>h.hero===id))))return null;
    if(run.phase!=='initial'&&run.party.length===0)return null;
    if(run.phase==='shop'&&(run.shop.length!==4||!run.chest||!Array.isArray(run.chest.options)||run.chest.options.length!==3||!run.chest.options.every(i=>i&&validItem(i))||typeof run.chest.claimed!=='boolean'||typeof run.chest.refreshUsed!=='boolean'))return null;
    const owned=run.party.flatMap(h=>h.gear).filter(Boolean);
    if(new Set(owned.map(i=>i.uid)).size!==owned.length)return null;
    const allItems=[...owned,...run.shop,...(run.chest?.options||[])].filter(Boolean);
    if(run.version===1){
      // Version 1 used a ten-times smaller currency unit; no stat rescaling.
      if(allItems.some(i=>equipmentById(i.base)))return null;
      run.gold*=GOLD_SCALE;run.earned*=GOLD_SCALE;
      if(run.lastRound?.gold!==undefined)run.lastRound.gold*=GOLD_SCALE;
      for(const item of allItems)item.price*=GOLD_SCALE;
      run.version=2;
    }
    for(const item of allItems){
      const d=equipmentById(item.base);
      if(d){item.name=d.name;item.mark=d.mark;item.rarity=d.rarity;item.stats={...d.stats};item.price=d.price;delete item.effect;}
    }
    run.serial=Math.max(run.serial,...allItems.map(i=>Number(/^item-(\d+)$/.exec(i.uid)?.[1]||0)));
    if(!prepareHeroSave(run))return null;
    for(const item of [...run.party.flatMap(m=>m.gear),...run.shop,...(run.chest?.options||[])].filter(Boolean))item.stats=migrateAccuracyBonuses(item.stats);
    for(const member of run.party){member.tactics=normalizeTactics(member.tactics);member.skillModes=normalizeSkillModes(member.skillModes);delete member.auto;}
    if(run.phase==='battle')run.phase='ready';return run;
  } catch{return null;}
}

export const upgradesFor = item => EQUIPMENT.filter(d=>d.recipe?.includes(item?.base));
export function previewCombine(run,id,hero,slot,anchorUid) {
  if(run.phase!=='shop')fail('只能在商店合成装备');
  const definition=equipmentById(id),anchor=run.party[hero]?.gear[slot];
  if(!definition?.recipe||!anchor||anchor.uid!==anchorUid||!definition.recipe.includes(anchor.base))fail('材料已变化，请重新选择');
  const available=[{hero,slot,item:anchor},...run.party.flatMap((h,hi)=>h.gear.flatMap((item,si)=>item&&(hi!==hero||si!==slot)?[{hero:hi,slot:si,item}]:[]))];
  const used=new Set(),materials=[],missing=[];
  for(const base of definition.recipe){
    const entry=available.find(e=>e.item.base===base&&!used.has(e.item.uid));
    if(entry){used.add(entry.item.uid);materials.push(entry);}else missing.push(equipmentById(base).name);
  }
  const reason=missing.length?`缺少：${missing.join('、')}`:run.gold<definition.combineFee?'金币不足':'';
  return {definition,materials,missing,reason,cost:definition.combineFee,goldAfter:run.gold-definition.combineFee,hero,slot,anchorUid,uids:materials.map(m=>m.item.uid)};
}
export function combineEquipment(run,id,hero,slot,anchorUid,expectedUids) {
  const quote=previewCombine(run,id,hero,slot,anchorUid);
  if(quote.reason)fail(quote.reason);
  if(!Array.isArray(expectedUids)||expectedUids.length!==quote.uids.length||expectedUids.some((uid,i)=>uid!==quote.uids[i]))fail('合成材料已变化，请重新确认');
  const item=instantiate(run,quote.definition);
  for(const m of quote.materials)run.party[m.hero].gear[m.slot]=null;
  run.party[hero].gear[slot]=item;run.gold=quote.goldAfter;
  return item;
}
