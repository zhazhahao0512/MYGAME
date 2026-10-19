import { heroBaseStats } from './foundation.js';
import { growthBonuses,initializeProgression,validProgression } from './progression.js';
import { lanyaSkills } from './lanya.js';

export function memberBaseStats(member,level,base){
  const stats=heroBaseStats(member.hero,level,base);
  for(const [key,value] of Object.entries(growthBonuses(member)))stats[key]=(stats[key]||0)+value;
  stats.totalAttackSpeed=member.hero==='lanya'?1.1:1;
  return stats;
}
export function rankedHeroSkills(heroId,prototype,ranks=[1,1,1,1]){
  if(heroId==='lanya')return lanyaSkills(ranks).map(s=>({...s,...s.ranks[Math.max(0,s.rank-1)]}));
  return structuredClone(prototype).map((skill,index)=>({...skill,rank:ranks[index],ranks:Array.from({length:index===3?3:4},(_,n)=>({
    effects:skill.effects.map(effect=>({ ...effect,
      ...(['damage','heal','shield'].includes(effect.type)?{
        ...(effect.amount!==undefined?{amount:effect.amount*(1+.25*n)}:{}),
        ...(effect.attack!==undefined?{attack:effect.attack*(1+.15*n)}:{}),
      }:{}),
    })),
  }))}));
}
export function prepareHeroSave(run){
  if(!Number.isSafeInteger(run.level)||run.level<1)return false;
  for(const member of run.party){
    initializeProgression(member,run.level,run.seed,{legacy:true});
    if(!validProgression(member,run.level))return false;
  }
  run.heroContentVersion=1;return true;
}
export function combineHeroAttackSpeed(base,modifiers,result){
  const entries=modifiers.filter(m=>m.stat==='attackSpeed');
  if(entries.some(m=>m.op==='override'))return result;
  const flat=entries.filter(m=>m.op==='flat').reduce((n,m)=>n+m.value,0);
  const percent=entries.filter(m=>m.op==='percent').reduce((n,m)=>n+m.value,0);
  const multiply=entries.filter(m=>m.op==='multiply').reduce((n,m)=>n*m.value,1);
  result.attackSpeed=Math.max(.05,(base.attackSpeed+flat)*(1+percent+(result.bonusAttackSpeed||0))*multiply*(result.totalAttackSpeed??1));
  return result;
}
export function threeTargets(primary,candidates){
  if(!primary)return [];
  return [primary,...candidates.filter(t=>t.id!==primary.id).sort((a,b)=>Math.abs(a.slot-primary.slot)-Math.abs(b.slot-primary.slot)||a.slot-b.slot)].slice(0,3);
}
