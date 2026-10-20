import { heroBaseStats } from './foundation.js';
import { actionHitChance } from './accuracy.js';
import { removeStatus } from '../combat/unit.js';
const step=b=>b.stepSeconds;
const ticks=(b,s)=>Math.ceil(s/step(b));
const state=u=>u.heroState??=( {resolve:0,marks:new Map(),heals:new Map(),shields:new Map()} );
const active=(u,id)=>[...(u.statuses?.values()||[])].find(s=>s.definition.id===id);
const status=(id,name,duration,extra={})=>({id,name,duration,stacking:'refresh',modifiers:[],...extra});
export function heroMechanicReason(unit,index){
 return unit.def?.id==='lishan'&&index===3&&active(unit,'lishan-ultimate')?'承压状态中':'';
}
export function tauntedTarget(battle,unit){
 const taunt=active(unit,'lishan-taunt');
 const source=taunt&&battle.find(taunt.sourceId);
 return source?.hp>0&&source.side!==unit.side?source:null;
}
const allies=(battle,unit)=>battle.living(unit.side).sort((a,b)=>a.hp/a.stats.hp-b.hp/b.stats.hp||(b.stats.hp-b.hp)-(a.stats.hp-a.hp)||a.slot-b.slot||a.id.localeCompare(b.id));
export function incomingPressure(battle,target,duration=3){
 return battle.living(target.side==='hero'?'enemy':'hero').reduce((n,u)=>{
  const directed=tauntedTarget(battle,u)?.id||u.targetId||battle.previewSkillTargets(u,{target:'enemy'})[0]?.id;
  if(directed!==target.id)return n;
  return n+u.stats.attack*u.stats.attackSpeed*duration*actionHitChance(u,target)*100/(100+target.stats.armor)*(1-target.stats.reduction);
 },0);
}
export function heroTargets(battle,unit,skill){
 if(skill.target==='threeAllies')return allies(battle,unit).slice(0,3);
 if(skill.target==='allyPressure')return allies(battle,unit).sort((a,b)=>incomingPressure(battle,b)-incomingPressure(battle,a)).slice(0,1);
 if(unit.def?.id==='lingxi'&&skill.target==='allyWeakest')return allies(battle,unit).slice(0,1);
 if(unit.def?.id==='lishan'&&skill.id==='lishan-2'){
  const vulnerable=allies(battle,unit).filter(u=>u!==unit&&u.hp/u.stats.hp<.4);
  const threat=battle.living(unit.side==='hero'?'enemy':'hero').find(e=>vulnerable.some(a=>a.id===e.targetId));
  if(threat&&unit.hp+unit.shield>unit.stats.hp*.3)return [threat];
 }
 return null;
}
// Pure calculation shared by real snapshots and the managed policy.
export function heroDamageOptions(battle,source,target,effect){
 const out={...effect};
 if(effect.bonusHp)out.amount=(out.amount||0)+effect.bonusHp*Math.max(0,source.stats.hp-heroBaseStats(source.def.id,source.level).hp);
 if(effect.hunt){
  const mark=source.heroState?.hunt;
  if(mark?.target===target.id&&mark.expiresAt>battle.tick)out.accuracy=(out.accuracy||0)+mark.accuracy;
  let multiplier=target.hp/target.stats.hp<.4?1.12:1;
  if(effect.execute)multiplier*=1+.5*Math.max(0,1-target.hp/target.stats.hp);
  out.amount=(out.amount||0)*multiplier;out.power=(out.power||0)*multiplier;out.attack=(out.attack||0)*multiplier;
 }
 return out;
}
export function heroShotPayload(battle,source,target,effect){
 if(effect.marks)return {marks:effect.marks,explosion:(24+6*source.level+.4*source.stats.power)*(1+source.stats.damageAmp)*100/(100+Math.max(0,target.stats.resist-source.stats.magicPen))*(1-target.stats.reduction)*heroReduction(target)};
 if(effect.taunt)return {taunt:effect.taunt};
 return null;
}
export function heroHit(battle,source,target,shot){
 if(!source||target.hp<=0)return;
 const kit=shot.kit;if(!kit)return;
 if(kit.taunt&&source.hp>0){
  const old=active(target,'lishan-taunt');
  const duration=Math.max(kit.taunt,(old?.sourceId===source.id?(old.expiresAt-battle.tick)*step(battle)/Math.max(.001,1-target.stats.tenacity):0));
  battle.addStatus(source,target,status('lishan-taunt','截阵嘲讽',duration,{control:'taunt',shared:true}));
 }
 if(kit.marks){
  const marks=state(target).marks,old=marks.get(source.id),count=(old?.expiresAt>battle.tick?old.count:0)+kit.marks;
  if(count>=3){marks.delete(source.id);battle.dealDamage(source,target,{damage:kit.explosion,damageType:'magic',crit:false,vamp:0,healing:0,suppressHitTriggers:true,origin:'heroEffect',originId:'jinli-passive'});}
  else marks.set(source.id,{count,expiresAt:battle.tick+ticks(battle,8)});
 }
}
export function heroEvent(battle,type,source,target,amount,extra){
 if(type==='damaged'&&target?.def?.id==='lishan'&&target.hp>0&&source&&source.side!==target.side){
  const s=state(target),ratio=active(target,'lishan-ultimate')?.definition.recovery??.18;
  s.resolve=Math.min(target.stats.hp*.08,s.resolve+(amount+(extra.absorbed||0))*ratio);
 }
}
export function absorbHeroShields(unit,amount){
 let remaining=amount;
 const ward=unit.equipment?.ward?{amount:unit.equipment.ward,expiresAt:unit.equipment.wardExpires,order:-1,ward:true}:null;
 const layers=[...(unit.heroState?.shields.values()||[]),...(ward?[ward]:[])].sort((a,b)=>a.expiresAt-b.expiresAt||a.order-b.order);
 for(const layer of layers){const taken=Math.min(layer.amount,remaining);layer.amount-=taken;remaining-=taken;if(layer.ward)unit.equipment.ward=layer.amount;}
 return remaining;
}

function addShield(battle,source,target,amount,duration,context){
 const shields=state(target).shields,key=`${source.id}:${context.originId}`,old=shields.get(key);
 const value=Math.max(0,amount*(1+source.stats.shielding));
 target.shield=Math.max(0,target.shield-(old?.amount||0))+value;
 shields.set(key,{amount:value,expiresAt:battle.tick+ticks(battle,duration),order:++battle.effectSerial});
 const added=Math.max(0,value-(old?.amount||0));
 if(added>0){battle.emitEffect('shield',target,added,false,battle.visualSource(source,context));battle.emit('shield',source,target,added);}
}
function healWave(battle,source,target,amount,context){
 const boost=target.hp/target.stats.hp<.4?1.12:1;
 battle.heal(source,target,amount*boost,{...context,heroHealing:true});
}
export function releaseHeroEffect(battle,source,target,effect,context){
 const s=state(source);
 if(effect.kind==='stoneShield'||effect.kind==='stoneUltimate'||effect.kind==='timedShield'){
  let amount=(effect.amount||0)+(effect.hp||0)*source.stats.hp+(effect.power||0)*source.stats.power;
  if(effect.kind==='stoneShield'){amount+=Math.min(s.resolve,source.stats.hp*.08);s.resolve=0;}
  if(effect.kind==='stoneUltimate')battle.addStatus(source,source,status('lishan-ultimate','不动山关',effect.duration,{recovery:effect.recovery}));
  addShield(battle,source,target,amount,effect.duration,context);
 }else if(effect.kind==='huntMark'){
  s.hunt={target:target.id,accuracy:effect.accuracy,expiresAt:battle.tick+ticks(battle,effect.duration)};
 }else if(effect.kind==='protection'){
  const old=active(target,'lingxi-protection'),reduction=Math.max(effect.reduction,old?.definition.reduction||0);
  // reduction is composed at damage snapshot time, not added to the panel's pool.
  battle.addStatus(source,target,status('lingxi-protection','安澜',effect.duration,{reduction,shared:true}));
 }else if(effect.kind==='healingWave'){
  const multiplier=1+source.stats.healing;
  healWave(battle,source,target,(effect.amount+effect.power*source.stats.power)*multiplier,context);
  state(target).heals.set(`${source.id}:${context.originId}`,{source:source.id,amount:(effect.tickAmount+effect.tickPower*source.stats.power)*multiplier,remaining:effect.count,next:battle.tick+ticks(battle,1),context});
 }
}
export function heroReduction(target){return 1-(active(target,'lingxi-protection')?.definition.reduction||0);}
export function tickHeroes(battle){
 for(const unit of battle.units()){
  const s=unit.heroState;if(!s)continue;
  s.resolve=Math.min(s.resolve,unit.stats.hp*.08);
  for(const [key,layer] of s.shields)if(layer.expiresAt<=battle.tick||unit.hp<=0){unit.shield=Math.max(0,unit.shield-layer.amount);s.shields.delete(key);}
  for(const [key,mark] of s.marks)if(mark.expiresAt<=battle.tick)s.marks.delete(key);
  if(s.hunt&&(s.hunt.expiresAt<=battle.tick||!(battle.find(s.hunt.target)?.hp>0)))delete s.hunt;
  if(unit.hp<=0){s.heals.clear();s.marks.clear();s.resolve=0;continue;}
  for(const [key,heal] of s.heals)if(heal.next<=battle.tick){
   const source=battle.find(heal.source);if(source)healWave(battle,source,unit,heal.amount,heal.context);
   heal.next+=ticks(battle,1);if(--heal.remaining<=0)s.heals.delete(key);
  }
 }
}
export function heroSkillValue(battle,unit,index,skill){
 if(!skill.id?.startsWith(`${unit.def?.id}-`)||!['lishan','jinli','shuoying','lingxi'].includes(unit.def?.id))return null;
 if(heroMechanicReason(unit,index))return {value:0,band:4,purpose:'sustain',replace:true};
 const targets=battle.previewSkillTargets(unit,skill);let value=0,band=3,purpose='damage';
 for(const target of targets)for(const e of skill.effects){
  const p=incomingPressure(battle,target),low=target.hp/target.stats.hp<=.35;
  if(e.kind?.includes('Shield')||e.kind==='stoneUltimate'){
   purpose='sustain';band=low&&p>0?1:4;
   const old=target.heroState?.shields.get(`${unit.id}:${skill.id}`);
   if(old?.amount>0&&old.expiresAt-battle.tick>ticks(battle,1))continue;
   const amount=(e.amount+(e.hp||0)*unit.stats.hp+(e.power||0)*unit.stats.power+(e.kind==='stoneShield'?(unit.heroState?.resolve||0):0))*(1+unit.stats.shielding);
   value+=Math.min(amount,Math.max(0,p-target.shield));
  }else if(e.kind==='healingWave'){
   purpose='sustain';band=low&&p>0?1:3;
   const existing=target.heroState?.heals.get(`${unit.id}:${skill.id}`);
   const remaining=existing?existing.amount*existing.remaining:0;
   const amount=(e.amount+e.power*unit.stats.power+(e.tickAmount+e.tickPower*unit.stats.power)*e.count)*(1+unit.stats.healing);
   value+=Math.max(0,Math.min(target.stats.hp-target.hp,amount)-remaining);
  }else if(e.kind==='protection'){
   purpose='sustain';band=low&&p>0?1:4;
   if(!active(target,'lingxi-protection'))value+=p*e.reduction;
  }else if(e.kind==='huntMark'){
   const mark=unit.heroState?.hunt;if(mark?.target===target.id&&mark.expiresAt>battle.tick+ticks(battle,1))continue;
   for(const n of [0,3]){const follow=battle.getSkill(unit,n);if(follow.rank===0||unit.ready[n]>battle.tick+ticks(battle,4)||unit.mana<skill.cost+follow.cost)continue;
    const damage=follow.effects[0],gain=actionHitChance(unit,target,{accuracy:e.accuracy})-actionHitChance(unit,target);
    value+=gain*(damage.amount+damage.power*unit.stats.power)*100/(100+target.stats.resist);
   }
   band=2;
  }else if(e.type==='status'&&e.status.id==='shuoying-veil'){
   purpose='sustain';band=low&&p>0?1:4;
   if(!active(unit,'shuoying-veil'))value+=p*e.status.modifiers[0].value/100;
  }else if(e.type==='damage'){
   // Generic scoring includes the primary damage. Add only the distinct mechanic.
   if(e.marks){const mark=target.heroState?.marks.get(unit.id),count=mark?.expiresAt>battle.tick?mark.count:0;
    if(count+e.marks>=3)value+=(24+6*unit.level+.4*unit.stats.power)*actionHitChance(unit,target)*100/(100+target.stats.resist);
    else if(index===1&&battle.getSkill(unit,0).rank>0&&unit.ready[0]<=battle.tick+ticks(battle,2)&&unit.mana>=skill.cost+battle.getSkill(unit,0).cost)band=2;
   }
   if(e.taunt&&target.targetId!==unit.id){const protectedUnit=battle.find(target.targetId);if(protectedUnit?.hp/protectedUnit?.stats.hp<=.35&&unit.hp+unit.shield>unit.stats.hp*.3)band=1;}
  }
 }
 return {value,band,purpose,replace:skill.effects.every(e=>e.type!=='damage')};
}
