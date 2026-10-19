import { actionHitChance } from './accuracy.js';
import { removeStatus } from '../combat/unit.js';

export const LANYA_PASSIVE={name:'疾猎本能',description:'总攻击速度提高10%。每次普攻主命中额外附带英雄等级点真实伤害，护盾可吸收；附伤不暴击、不吸血、不递归触发攻击特效。'};
const names=['淬锋箭','疾弦','三向追猎','极限连射'];
const descriptions=[
  '8秒内接下来5次普攻附带魔法伤害，发射时消耗次数，未命中也消耗。重复施放刷新至5次。',
  '5秒内提高额外攻速。学会后每次普攻主命中缩短本技能冷却，护盾命中计入，附伤不会重复减冷却。',
  '向最多3个不同目标各射一箭，造成物理伤害，无任何法强加成。自身获得4秒精准和闪避。本技能不触发普攻特效。',
  '持续10秒，提高被动真伤倍率，并维持当前已学等级的1、2效果。只扣一次蓝；结束后接管的增益一并结束，原冷却照常流逝。',
];
export function lanyaSkills(ranks=[0,0,0,0]){
  return names.map((name,index)=>({id:`lanya-${index+1}`,key:['Q','W','E','R'][index],name,rank:ranks[index],priority:[30,40,20,50][index],initialCooldown:0,castTime:0,retarget:'release',
    target:index===2?'threeEnemies':'enemy',description:descriptions[index],cost:[28,35,40,80][index],cooldown:[10,15,14,55][index],
    effects:index===2?[{type:'damage',damageType:'physical',amount:50,attack:.9,power:0,travel:.3,noVamp:true}]:[],
    ranks:Array.from({length:index===3?3:4},(_,r)=>({
      cost:[[28,30,32,34],[35,38,41,44],[40,44,48,52],[80,90,100]][index][r],
      cooldown:[[10,9,8,7],[15,14,13,12],[14,13,12,11],[55,48,41]][index][r],
      ...(index===0?{bonus:16+9*r}:index===1?{speed:.25+.15*r,refund:.10+.05*r}:index===2?{accuracy:6+3*r,evasion:3+2*r,effects:[{type:'damage',damageType:'physical',amount:50+30*r,attack:.9,power:0,travel:.3,noVamp:true}]}:{multiplier:r+2}),
    })),
  }));
}
const active=(unit,id)=>[...unit.statuses.values()].find(s=>s.definition.id===id);
export const isLanya=unit=>unit.def?.id==='lanya';
export function lanyaMechanicReason(unit,index){
  if(!isLanya(unit))return '';
  if(active(unit,'lanya-ultimate')&&[0,1,3].includes(index))return index===3?'爆发中':'大招维持中';
  return '';
}
export function lanyaAutoReady(unit,index){
  if(!isLanya(unit))return true;
  return !lanyaMechanicReason(unit,index)&&!(index===0&&active(unit,'lanya-edge')&&unit.edgeCharges>0)&&!(index===1&&active(unit,'lanya-speed'));
}
function clear(unit,id){for(const [key,s] of unit.statuses)if(s.definition.id===id)removeStatus(unit,key);}
const status=(id,name,duration,modifiers=[])=>({id,name,duration,stacking:'refresh',modifiers});
// Called exactly once at release, before selecting damage snapshots for skill 3.
export function releaseLanya(battle,unit,index,skill){
  if(!isLanya(unit))return;
  if(index===0){unit.edgeCharges=5;battle.addStatus(unit,unit,status('lanya-edge','淬锋箭',8));}
  if(index===1)battle.addStatus(unit,unit,status('lanya-speed','疾弦',5,[{stat:'bonusAttackSpeed',op:'flat',value:skill.speed}]));
  if(index===2)battle.addStatus(unit,unit,status('lanya-hunt','三向追猎',4,[{stat:'accuracy',op:'flat',value:skill.accuracy},{stat:'evasion',op:'flat',value:skill.evasion}]));
  if(index===3){
    clear(unit,'lanya-edge');clear(unit,'lanya-speed');unit.edgeCharges=0;
    const speed=battle.getSkill(unit,1),modifiers=speed.rank>0?[{stat:'bonusAttackSpeed',op:'flat',value:speed.speed}]:[];
    const definition=status('lanya-ultimate','极限连射',10,modifiers);definition.multiplier=skill.multiplier;
    battle.addStatus(unit,unit,definition);
  }
}
export function lanyaAttackPayload(battle,unit,target){
  if(!isLanya(unit))return null;
  const ult=active(unit,'lanya-ultimate'),edge=battle.getSkill(unit,0),speed=battle.getSkill(unit,1);
  const empowered=edge.rank>0&&(!!ult||!!active(unit,'lanya-edge')&&unit.edgeCharges>0);
  const parts=[{damage:unit.level*(ult?.definition.multiplier||1),damageType:'true',originId:'lanya-passive'}];
  if(empowered){
    const s=unit.stats,t=target.stats;
    parts.push({damage:(edge.bonus+.25*s.attack+.30*s.power)*(1+s.damageAmp)*100/(100+Math.max(0,t.resist-s.magicPen))*(1-t.reduction),damageType:'magic',originId:'lanya-1'});
    if(!ult&&--unit.edgeCharges<=0)clear(unit,'lanya-edge');
  }
  return {parts,refund:speed.rank>0?speed.refund:0};
}
export function lanyaMainHit(battle,unit,payload){
  if(!payload||!unit)return;
  // Fractional deadlines preserve .15/.25 seconds across repeated hits; execution
  // still happens on the next simulation step, with no accumulating round-up.
  unit.ready[1]=Math.max(battle.tick,unit.ready[1]-payload.refund/battle.stepSeconds);
}
function perHit(unit,target,extra=0){
  const s=unit.stats,t=target.stats;
  return ((s.attack*(1+s.crit*(s.critDamage-1))*(1+s.damageAmp)*100/(100+Math.max(0,t.armor-s.armorPen))*(1-t.reduction))+unit.level+extra)*actionHitChance(unit,target);
}
export function lanyaSkillValue(battle,unit,index,skill){
  if(!isLanya(unit))return null;
  if(!lanyaAutoReady(unit,index))return {value:0,band:3};
  const target=battle.previewSkillTargets(unit,{target:'enemy'})[0];if(!target)return {value:0,band:3};
  const s=unit.stats,t=target.stats,hit=actionHitChance(unit,target);
  const edge=battle.getSkill(unit,0),speed=battle.getSkill(unit,1);
  const magic=edge.rank>0?(edge.bonus+.25*s.attack+.30*s.power)*(1+s.damageAmp)*100/(100+Math.max(0,t.resist-s.magicPen))*(1-t.reduction):0;
  // Limit the useful window by current visible enemy health, never future spawns/RNG.
  const hp=battle.living(unit.side==='hero'?'enemy':'hero').reduce((n,u)=>n+u.hp+u.shield,0);
  const window=Math.min(index===3?10:index===1?5:8,hp/Math.max(1,perHit(unit,target)*s.attackSpeed));
  let value=0,band=3;
  if(index===0)value=magic*hit*Math.min(5,s.attackSpeed*window);
  if(index===1){const extraSpeed=unit.baseStats.attackSpeed*skill.speed*1.1;value=extraSpeed*window*perHit(unit,target,active(unit,'lanya-edge')?magic:0);}
  if(index===3){
    const totalSpeed=s.attackSpeed+(active(unit,'lanya-speed')?0:(speed.rank>0?unit.baseStats.attackSpeed*speed.speed*1.1:0));
    const during=totalSpeed*perHit(unit,target,magic+unit.level*(skill.multiplier-1));
    const existingMagic=active(unit,'lanya-edge')?magic*Math.min(unit.edgeCharges,s.attackSpeed*window):0;
    value=Math.max(0,(during-s.attackSpeed*perHit(unit,target))*window-existingMagic*hit);
  }
  if(index===2){
    // Generic evaluator adds arrow damage. Here add the temporary accuracy/evasion benefit.
    const raised={...unit,stats:{...s,accuracy:s.accuracy+skill.accuracy}};
    value=Math.max(0,actionHitChance(raised,target)-hit)*s.attackSpeed*Math.min(4,window)*(s.attack+unit.level);
    const attackers=battle.living(unit.side==='hero'?'enemy':'hero').filter(u=>u.targetId===unit.id);
    const dodge=attackers.reduce((n,a)=>n+Math.max(0,actionHitChance(a,unit)-actionHitChance(a,{...unit,stats:{...s,evasion:s.evasion+skill.evasion}}))*a.stats.attack*a.stats.attackSpeed*4*100/(100+s.armor)*(1-s.reduction),0);
    value+=dodge;if(dodge>0&&unit.hp/s.hp<=.35)band=1;
  }
  return {value:Math.min(hp,Math.max(0,value)),band};
}
