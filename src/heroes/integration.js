import { HERO_PROFILES,heroBaseStats } from './foundation.js';
import { growthBonuses,initializeProgression,validProgression } from './progression.js';
import { lanyaSkills } from './lanya.js';
import { formalSkills } from './roster.js';

export function memberBaseStats(member,level,base){
  const stats=heroBaseStats(member.hero,level,base);
  for(const [key,value] of Object.entries(growthBonuses(member)))stats[key]=(stats[key]||0)+value;
  stats.totalAttackSpeed=member.hero==='lanya'?1.1:1;
  return stats;
}
export function rankedHeroSkills(heroId,prototype,ranks=[1,1,1,1]){
  if(heroId==='lanya')return lanyaSkills(ranks).map(s=>({...s,...s.ranks[Math.max(0,s.rank-1)]}));
  const skills=formalSkills(heroId,ranks);if(!skills)throw new Error('未知英雄技能');return skills;
}

export function prepareHeroSave(run){
  if(!Number.isSafeInteger(run.level)||run.level<1)return false;
  for(const member of run.party){
    initializeProgression(member,run.level,run.seed,{legacy:true});
    if(!validProgression(member,run.level))return false;
  }
  run.heroContentVersion=2;return true;
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

export const LEGACY_HERO_MAP={stone:'lishan',wind:'lanya',ember:'jinli',leaf:'lingxi',blade:'lishan',shade:'shuoying',tide:'jinli'};
export const knownHeroId=id=>!!HERO_PROFILES[id]||!!LEGACY_HERO_MAP[id];
export function migrateHeroRoster(run){
  if(run.heroContentVersion===2)return true;
  // Keep already-formal identities first. Fill collisions with an unused formal
  // hero while preserving each party member's equipment, modes and progression.
  const ids=['lanya','lishan','jinli','shuoying','lingxi'];
  const used=new Set(run.party.filter(m=>HERO_PROFILES[m.hero]).map(m=>m.hero));
  for(const member of run.party){
    if(!knownHeroId(member.hero))return false;
    if(HERO_PROFILES[member.hero])continue;
    if(member.progression&&!validProgression(member,run.level))return false;
    const old=member.hero,preferred=LEGACY_HERO_MAP[old];
    member.hero=used.has(preferred)?ids.find(id=>!used.has(id)):preferred;used.add(member.hero);
    if(member.progression)member.progression.growthIdentity=old;
  }
  if(['initial','recruit'].includes(run.phase)){
    const candidates=[...run.candidates.map(id=>LEGACY_HERO_MAP[id]||id),...ids];
    run.candidates=[...new Set(candidates)].filter(id=>HERO_PROFILES[id]&&!used.has(id)).slice(0,Math.min(3,5-run.party.length));
  }else run.candidates=[];
  return true;
}
