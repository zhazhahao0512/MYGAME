import { normalizeSkillModes } from './casting.js';
import { resolveStats, resolveRules } from './attributes.js';
export function createUnit({id,side,slot,name,def,baseStats,modifiers=[],rules=[],skills=[],triggers=[],auto=true,skillModes,tick=0,step=.02,boss=false}) {
  const unit={id,side,slot,name,def,boss,tactics:null,targetId:null,targetRule:null,reward:0,challenge:false,enemyType:null,equipment:null,contributors:new Map(),takedownSettled:false,baseStats:{...baseStats},sources:new Map(),statuses:new Map(),
    baseRules:{attackTarget:def?.attackRule||'front'},rules:{},stats:{},skills:structuredClone(skills),triggers:structuredClone(triggers),
    triggerReady:new Map(),auto,skillModes:normalizeSkillModes(skillModes,skills.length),castPlan:null,castReason:'',pendingCast:null,lastCommandReason:'',lastDamagedTick:null,guaranteedManaRegen:0,hp:0,mana:0,shield:0,attack:null,casting:null,nextAttack:tick,
    ready:skills.map((s,i)=>tick+Math.ceil((s.initialCooldown??(2+i))/step)),lastEvent:null};
  unit.sources.set('loadout',{modifiers,rules});recalculate(unit);
  unit.hp=unit.stats.hp;unit.mana=unit.stats.mana;unit.guaranteedManaRegen=unit.stats.manaRegen;
  return unit;
}
export function recalculate(unit) {
  const sources=[...unit.sources.entries()];
  unit.stats=resolveStats(unit.baseStats,sources.flatMap(([id,s])=>(s.modifiers||[]).map((m,i)=>({...m,id:`${id}:${m.id??i}`}))));
  unit.rules=resolveRules(unit.baseRules,sources.flatMap(([id,s])=>(s.rules||[]).map((m,i)=>({...m,id:`${id}:${m.id??i}`}))));
  unit.hp=Math.min(unit.hp,unit.stats.hp);unit.mana=Math.min(unit.mana,unit.stats.mana);
}
export function setSource(unit,id,source) {unit.sources.set(id,structuredClone(source));recalculate(unit);}
export function removeSource(unit,id) {unit.sources.delete(id);recalculate(unit);}
export function isControlled(unit) {return [...unit.statuses.values()].some(s=>s.definition.control==='stun');}
export function applyStatus(unit,definition,sourceId,tick,step=.02) {
  if(unit.hp<=0)return null;
  if(!Number.isFinite(definition.duration)||definition.duration<=0)throw new Error(`Invalid status duration ${definition.id}`);
  if(!['refresh','stack','replace'].includes(definition.stacking))throw new Error(`Invalid status stacking ${definition.id}`);
  if(definition.stacking==='stack'&&(!Number.isInteger(definition.maxStacks)||definition.maxStacks<1))throw new Error(`Invalid stack limit ${definition.id}`);
  const key=`${definition.id}:${definition.shared?'shared':sourceId}`;
  const old=unit.statuses.get(key);
  const stacks=definition.stacking==='stack'?Math.min(definition.maxStacks||1,(old?.stacks||0)+1):1;
  const duration=definition.duration*(definition.control?1-unit.stats.tenacity:1);
  const status={key,definition:structuredClone(definition),sourceId,stacks,expiresAt:tick+Math.max(1,Math.ceil(duration/step))};
  unit.statuses.set(key,status);
  const modifiers=(definition.modifiers||[]).map((m,i)=>({...m,id:`status:${key}:${i}`,value:m.op==='multiply'?m.value**stacks:m.value*stacks}));
  const rules=(definition.rules||[]).map((r,i)=>({...r,id:`status:${key}:rule:${i}`}));
  setSource(unit,`status:${key}`,{modifiers,rules});
  if(definition.control==='stun')unit.casting=null;
  return status;
}
export function removeStatus(unit,key) {if(!unit.statuses.delete(key))return false;removeSource(unit,`status:${key}`);return true;}
export function expireStatuses(unit,tick) {for(const [key,status] of unit.statuses)if(status.expiresAt<=tick)removeStatus(unit,key);}
