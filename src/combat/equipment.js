import { equipmentById } from '../equipment.js';
import { setSource, removeSource, removeStatus } from './unit.js';

export const hasPassive = (unit,id) => !!unit?.equipment?.effects.has(id);
export function initializeEquipment(unit,gear) {
  unit.equipment={effects:new Set(gear.map(i=>equipmentById(i?.base)?.effectId).filter(Boolean)),hits:0,focusTarget:null,spellReady:0,ward:0,wardExpires:0,lowHealth:false};
}
export function syncEquipment(unit,tick) {
  const e=unit.equipment;if(!e)return;
  if(e.ward&&tick>=e.wardExpires){unit.shield=Math.max(0,unit.shield-e.ward);e.ward=0;}
  const low=unit.hp>0&&unit.hp<unit.stats.hp*.5;
  if(hasPassive(unit,'low_health_attack')&&e.lowHealth!==low){
    e.lowHealth=low;
    if(low)setSource(unit,'equipment:backwater',{modifiers:[{stat:'attack',op:'flat',value:12}]});
    else removeSource(unit,'equipment:backwater');
  }
}
export function changeEquipmentTarget(unit,id) {
  const e=unit.equipment;if(!e||e.focusTarget===id)return;
  e.focusTarget=id;
  removeStatus(unit,`equipment:focused_haste:${unit.id}`);
}
export function absorbEquipmentShield(unit,amount) {
  // The finite three-second ward is consumed before indefinite legacy/skill shields.
  const e=unit.equipment;if(e)e.ward=Math.max(0,e.ward-amount);
}
export function procSnapshot(battle,source,target,amount,damageType,id) {
  return {...battle.snapshot(source,target,0,true,{amount,attack:0,power:0,damageType,canMiss:false,canCrit:false}),
    vamp:0,lifeSteal:0,omni:0,crit:false,suppressHitTriggers:true,origin:'equipment',originId:id};
}
export function basicHit(battle,source,target,shot) {
  const e=source?.equipment;if(!e)return;
  e.hits++;
  if(hasPassive(source,'triple_hit_damage')&&e.hits%3===0&&target.hp>0&&shot.comboDamage)battle.dealDamage(source,target,shot.comboDamage);
  if(source.hp<=0)return;
  const buff=(id,stat,value,stacking='refresh')=>battle.addStatus(source,source,{id:`equipment:${id}`,name:id,duration:3,stacking,maxStacks:3,
    modifiers:[{stat,op:stat==='attackSpeed'?'percent':'flat',value}]});
  if(shot.crit&&hasPassive(source,'critical_haste'))buff('critical_haste','attackSpeed',.20);
  if(hasPassive(source,'focused_haste')&&e.focusTarget===target.id)buff('focused_haste','attackSpeed',.04,'stack');
  if(hasPassive(source,'post_hit_regeneration'))buff('post_hit_regeneration','hpRegen',3);
  if(hasPassive(source,'four_hit_shield')&&e.hits%4===0){
    const added=Math.max(0,30-e.ward);source.shield+=added;e.ward=30;e.wardExpires=battle.tick+Math.ceil(3/battle.stepSeconds);
    if(added>0){battle.emitEffect('shield',source,added,false,{origin:'equipment',originId:'four_hit_shield',source:source.id});battle.emit('shield',source,source,added);}
  }
}
function heroOwner(battle,source) {
  let owner=source;
  const seen=new Set();
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
    const hero=battle.find(id);
    if(hero?.hp>0&&hero.stats.mana>0&&hasPassive(hero,'takedown_mana_restore')&&battle.tick-tick<=Math.round(6/battle.stepSeconds)){
      const restored=Math.min(15,hero.stats.mana-hero.mana);hero.mana+=restored;
      if(restored>0)battle.emitEffect('mana',hero,restored,false,{source:hero.id,origin:'equipment',originId:'takedown_mana_restore'});
    }
  }
}
