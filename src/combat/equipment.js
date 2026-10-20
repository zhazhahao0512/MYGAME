import { passiveFor } from '../equipment.js';
import { setSource, removeSource, removeStatus } from './unit.js';

export const getPassive = (unit,id) => unit?.equipment?.effects.get(id);
export const hasPassive = (unit,id) => !!getPassive(unit,id);
export const passiveParams = (unit,id) => getPassive(unit,id)?.parameters;
export function initializeEquipment(unit,gear) {
  const effects=new Map();
  for(const item of gear){
    const effect=passiveFor(item);if(!effect)continue;
    const old=effects.get(effect.id);
    if(old?.rank===effect.rank&&JSON.stringify(old.parameters)!==JSON.stringify(effect.parameters))throw new Error(`Conflicting passive rank: ${effect.id}`);
    if(!old||effect.rank>old.rank)effects.set(effect.id,structuredClone(effect));
  }
  unit.equipment={effects,hits:0,focusTarget:null,spellReady:0,ready:new Map(),history:{},ward:0,wardExpires:0,lowHealth:false};
  unit.timedShields=new Map();
}
function mirrorWard(unit){
  if(!unit.equipment)return;
  const ward=unit.timedShields?.get('four_hit_shield');
  unit.equipment.ward=ward?.amount||0;unit.equipment.wardExpires=ward?.expiresAt||0;
}
export function syncEquipment(unit,tick) {
  if(!unit)return;
  for(const [id,shield] of unit.timedShields||[])if(shield.expiresAt<=tick){unit.shield=Math.max(0,unit.shield-shield.amount);unit.timedShields.delete(id);}
  mirrorWard(unit);
  const e=unit.equipment;if(!e)return;
  const low=unit.hp>0&&unit.hp<unit.stats.hp*.5;
  if(e.lowHealth!==low){
    e.lowHealth=low;
    for(const [id,stat,value] of [
      ['low_health_attack','attack',passiveParams(unit,'low_health_attack')?.attack],
      ['low_health_regeneration','hpRegen',passiveParams(unit,'low_health_regeneration')?.hpRegen],
    ])if(value){
      if(low)setSource(unit,`equipment:${id}`,{modifiers:[{stat,op:'flat',value}]});
      else removeSource(unit,`equipment:${id}`);
    }
  }
}
export function fixedEquipmentRegen(unit){
  const low=unit.equipment?.lowHealth?(passiveParams(unit,'low_health_regeneration')?.hpRegen||0):0;
  const mixed=[...unit.statuses.values()].some(s=>s.definition.id==='equipment:mixed_damage_regeneration')?(passiveParams(unit,'mixed_damage_regeneration')?.hpRegen||0):0;
  return low+mixed;
}
export function changeEquipmentTarget(unit,id) {
  const e=unit.equipment;if(!e||e.focusTarget===id)return;
  e.focusTarget=id;removeStatus(unit,`equipment:focused_haste:${unit.id}`);
}
export function absorbEquipmentShield(unit,amount) {
  // Consume earliest expiry first, before the remaining indefinite skill shields.
  const ordered=[...(unit.timedShields?.values()||[])].sort((a,b)=>a.expiresAt-b.expiresAt||a.id.localeCompare(b.id)||a.source.localeCompare(b.source));
  for(const shield of ordered){const used=Math.min(amount,shield.amount);shield.amount-=used;amount-=used;if(shield.amount<=0)unit.timedShields.delete(shield.id);if(amount<=0)break;}
  mirrorWard(unit);
}
function grantShield(battle,source,target,id,effect){
  syncEquipment(target,battle.tick);
  target.timedShields??=new Map();
  const old=target.timedShields.get(id),p=effect.parameters;
  if(old&&old.rank>effect.rank)return;
  const amount=old?.rank===effect.rank?Math.max(old.amount,p.shield):p.shield;
  const added=amount-(old?.amount||0);
  target.shield+=added;
  target.timedShields.set(id,{id,source:source.id,rank:effect.rank,amount,expiresAt:battle.tick+Math.ceil(p.duration/battle.stepSeconds)});
  mirrorWard(target);
  if(added>0){
    battle.emitEffect('shield',target,added,false,{origin:'equipment',originId:id,source:source.id});
    // Retain R047's legacy ward event; new support protection never chains it.
    if(id==='four_hit_shield')battle.emit('shield',source,target,added);
  }
}
function buff(battle,unit,id,stat,value,duration,stacking='refresh',maxStacks=1){
  battle.addStatus(unit,unit,{id:`equipment:${id}`,name:getPassive(unit,id)?.name||id,duration,stacking,maxStacks,modifiers:[{stat,op:stat==='attackSpeed'?'percent':'flat',value}]});
}
function ready(battle,unit,id){return (unit.equipment.ready.get(id)||0)<=battle.tick;}
function spend(battle,unit,id){unit.equipment.ready.set(id,battle.tick+Math.ceil(passiveParams(unit,id).cooldown/battle.stepSeconds));}
function fixedHeal(battle,source,target,id,amount){return battle.heal(source,target,amount,{origin:'equipment',originId:id,suppressTriggers:true});}
function restoreMana(battle,source,target,id,amount){
  const restored=Math.max(0,Math.min(amount,target.stats.mana-target.mana));target.mana+=restored;
  if(restored>0)battle.emitEffect('mana',target,restored,false,{source:source.id,origin:'equipment',originId:id});
}
export function procSnapshot(battle,source,target,amount,damageType,id) {
  return {...battle.snapshot(source,target,0,true,{amount,attack:0,power:0,damageType,canMiss:false,canCrit:false}),
    vamp:0,lifeSteal:0,omni:0,crit:false,suppressHitTriggers:true,origin:'equipment',originId:id};
}
export function basicHit(battle,source,target,shot) {
  const e=source?.equipment;if(!e)return;
  e.hits++;
  const triple=passiveParams(source,'triple_hit_damage');
  if(triple&&e.hits%triple.every===0&&target.hp>0&&shot.comboDamage)battle.dealDamage(source,target,shot.comboDamage);
  if(source.hp<=0)return;
  const crit=passiveParams(source,'critical_haste'),focus=passiveParams(source,'focused_haste'),regen=passiveParams(source,'post_hit_regeneration');
  if(shot.crit&&crit)buff(battle,source,'critical_haste','attackSpeed',crit.attackSpeed,crit.duration);
  if(focus&&e.focusTarget===target.id)buff(battle,source,'focused_haste','attackSpeed',focus.perStack,focus.duration,'stack',focus.maxStacks);
  if(regen)buff(battle,source,'post_hit_regeneration','hpRegen',regen.hpRegen,regen.duration);
  const ward=getPassive(source,'four_hit_shield');
  if(ward&&e.hits%ward.parameters.every===0)grantShield(battle,source,source,ward.id,ward);
}
export function mitigateEquipmentDamage(target,snapshot){
  let damage=Math.max(0,snapshot.damage);
  if(snapshot.damageType==='magic'){
    const guard=passiveParams(target,'magic_damage_guard'),large=passiveParams(target,'large_magic_hit_guard');
    if(guard)damage*=1-guard.reduction;
    if(large)damage-=large.reduction*Math.max(0,damage-large.threshold*target.stats.hp);
  }
  if(snapshot.damageType==='physical'&&snapshot.origin==='attack'&&!snapshot.skill){
    damage-=passiveParams(target,'flat_basic_physical_block')?.block||0;
  }
  return Math.max(0,damage);
}
export function equipmentDamaged(battle,source,target,snapshot,actual){
  if(actual<=0||!source||source.side===target.side||target.hp<=0)return;
  const type=snapshot.damageType,power=passiveParams(target,'physical_hit_power'),mixed=passiveParams(target,'mixed_damage_regeneration');
  if(power&&(power.damageTypes||['physical']).includes(type))buff(battle,target,'physical_hit_power','power',power.power,power.duration);
  if(mixed&&['physical','magic'].includes(type)){
    const h=target.equipment.history;h[type]=battle.tick;
    const window=Math.round(mixed.historyWindow/battle.stepSeconds);
    if(h.physical!==undefined&&h.magic!==undefined&&battle.tick-h.physical<=window&&battle.tick-h.magic<=window)buff(battle,target,'mixed_damage_regeneration','hpRegen',mixed.hpRegen,mixed.duration);
  }
  if(target.side!=='hero')return;
  for(const owner of battle.party){
    const shield=getPassive(owner,'ally_low_health_shield');
    if(owner===target||owner.hp<=0||!shield||target.hp>=target.stats.hp*shield.parameters.threshold||!ready(battle,owner,shield.id))continue;
    // A blocked lower-rank application still spends that owner's cooldown.
    spend(battle,owner,shield.id);grantShield(battle,owner,target,shield.id,shield);
  }
}
export function equipmentSpellReleased(battle,unit,action){
  const id='spell_self_mend',p=passiveParams(unit,id);
  if(unit.hp>0&&p&&action.skill.effects.some(e=>e.type==='damage')&&ready(battle,unit,id)){
    spend(battle,unit,id);fixedHeal(battle,unit,unit,id,p.heal);
  }
}
// Called after the whole effective batch, never once for each target or heal tick.
// The action object belongs to one cast and is retained for later batches.
export function supportSpellBatch(battle,unit,action,beneficiaries){
  if(unit.hp<=0||action.equipmentSupportChecked)return;
  const targets=[...new Set(beneficiaries)].filter(t=>t!==unit&&t.side==='hero'&&t.side===unit.side&&t.hp>0);
  if(!targets.length)return;
  action.equipmentSupportChecked=true;
  const tie=(a,b)=>a.slot-b.slot||a.id.localeCompare(b.id);
  const heal=passiveParams(unit,'ally_spell_mend');
  if(heal&&ready(battle,unit,'ally_spell_mend')){
    const target=[...targets].sort((a,b)=>a.hp/a.stats.hp-b.hp/b.stats.hp||tie(a,b))[0];
    spend(battle,unit,'ally_spell_mend');fixedHeal(battle,unit,target,'ally_spell_mend',heal.heal);
  }
  const mana=passiveParams(unit,'ally_spell_mana');
  if(mana&&ready(battle,unit,'ally_spell_mana')){
    const target=targets.filter(t=>t.stats.mana>0&&t.mana<t.stats.mana).sort((a,b)=>(b.stats.mana-b.mana)-(a.stats.mana-a.mana)||tie(a,b))[0];
    if(target){spend(battle,unit,'ally_spell_mana');restoreMana(battle,unit,target,'ally_spell_mana',mana.mana);}
  }
}
function heroOwner(battle,source) {
  let owner=source;const seen=new Set();
  while(owner&&!seen.has(owner.id)){
    if(battle.party.includes(owner))return owner;
    seen.add(owner.id);owner=battle.find(owner.ownerId);
  }
  return null;
}
export function recordParticipation(battle,source,target,actualDamage) {
  if(target.side!=='enemy'||actualDamage<=0)return;
  const owner=heroOwner(battle,source);if(!owner)return;
  target.contributors??=new Map();target.contributors.set(owner.id,battle.tick);
}
export function restoreTakedownMana(battle,target) {
  if(target.side!=='enemy'||target.takedownSettled)return;
  target.takedownSettled=true;
  for(const [id,tick] of target.contributors||[]){
    const hero=battle.find(id),p=passiveParams(hero,'takedown_mana_restore');
    if(hero?.hp>0&&hero.stats.mana>0&&p&&battle.tick-tick<=Math.round(p.participationWindow/battle.stepSeconds))restoreMana(battle,hero,hero,'takedown_mana_restore',p.mana);
  }
}
