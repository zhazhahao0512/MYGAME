import { actionHitChance } from '../heroes/accuracy.js';
import { lanyaSkillValue } from '../heroes/lanya.js';
// Casting policy is deterministic and read-only except for its explicit plan state.
// Scores describe useful effect amounts, never sampled hits or future spawn knowledge.
export const CAST_MODES=['managed','auto','manual'];
export const CAST_MODE_INFO={managed:{mark:'托',name:'托管释放'},auto:{mark:'自',name:'自动释放'},manual:{mark:'点',name:'点击释放'}};
export const normalizeSkillModes=(modes,count=4)=>Array.from({length:count},(_,i)=>CAST_MODES.includes(modes?.[i])?modes[i]:'managed');
export const nextSkillMode=mode=>CAST_MODES[(CAST_MODES.indexOf(mode)+1)%CAST_MODES.length];
const HORIZON=8;
const EPS=1e-8;
function expectedDamage(source,target,effect) {
  const s=source.stats,t=target.stats,damageType=effect.damageType||'magic',magic=['magic','shield_piercing_magic'].includes(damageType);
  const hit=effect.canMiss===false?1:actionHitChance(source,target,effect);
  const amount=((effect.amount||0)+s.attack*(effect.attack??1)+s.power*(effect.power??.8))*(1+s.damageAmp);
  const raw=damageType==='true'?amount:amount*100/(100+Math.max(0,(magic?t.resist:t.armor)-(magic?s.magicPen:s.armorPen)))*(1-t.reduction);
  return {reliable:raw,hit,mean:raw*hit*(effect.canCrit?1+s.crit*(s.critDamage-1):1)};
}
function pressure(battle,target) {
  const incoming=battle.shots.filter(s=>s.target===target.id).reduce((sum,shot)=>{
    const source=battle.find(shot.source);if(!source)return sum;
    // Flight is visible; its already-sampled hit/crit outcome is not policy input.
    const effect=shot.skill?source.skills.find(s=>s.id===shot.originId)?.effects.find(e=>e.type==='damage'):null;
    return sum+expectedDamage(source,target,effect||{attack:1,power:0,damageType:'physical',canMiss:true,canCrit:true}).mean;
  },0);
  const attackers=battle.living(target.side==='hero'?'enemy':'hero').filter(u=>u.targetId===target.id);
  // Estimate a short protection window; shields already present cover its first part.
  const projected=attackers.reduce((n,u)=>n+u.stats.attack*u.stats.attackSpeed*3*100/(100+Math.max(0,target.stats.armor))*(1-target.stats.reduction),0);
  const recent=target.lastDamagedTick!==null&&(battle.tick-target.lastDamagedTick)*battle.stepSeconds<=2;
  return {amount:Math.max(0,incoming+projected-target.shield),active:incoming>0||attackers.length>0||recent};
}
export function evaluateSkill(battle,unit,index) {
  const skill=battle.getSkill(unit,index);
  if(!skill||skill.rank===0)return null;
  const targets=battle.previewSkillTargets(unit,skill);
  if(!targets.length)return null;
  const heroValue=lanyaSkillValue(battle,unit,index,skill);
  if(heroValue&&heroValue.value===0&&index!==2)return null;
  let damage=heroValue?.value||0,support=0,band=heroValue?.band||4,purpose='damage';
  for(const target of targets)for(const effect of skill.effects) {
    if(effect.type==='damage') {
      const source=unit.def?.id==='lanya'&&index===2?{...unit,stats:{...unit.stats,accuracy:unit.stats.accuracy+skill.accuracy}}:unit;
      const d=expectedDamage(source,target,effect);
      damage+=Math.min(target.hp+target.shield,d.mean);
      band=Math.min(band,3);
      if(d.hit>=.9&&d.reliable>=target.hp+target.shield&&(target.boss||target.challenge||target.casting))band=Math.min(band,2);
      if(effect.onHit?.some(e=>e.type==='status'&&battle.statusDefinition(e.status)?.control==='stun')&&target.casting&&
        (target.casting.end-battle.tick)*battle.stepSeconds>skill.castTime+(effect.travel??.3)&&d.hit>=.9)band=Math.min(band,2);
    } else if(effect.type==='heal') {
      const amount=Math.max(0,((effect.amount||0)+unit.stats.power*(effect.power||0))*(1+unit.stats.healing));
      const useful=Math.min(target.stats.hp-target.hp,amount);
      support+=useful;purpose='sustain';
      if(useful>0&&target.hp/target.stats.hp<=.35&&pressure(battle,target).active)band=1;
    } else if(effect.type==='shield') {
      const p=pressure(battle,target),amount=Math.max(0,((effect.amount||0)+unit.stats.power*(effect.power||0))*(1+unit.stats.shielding));
      support+=p.active?Math.min(amount,p.amount):0;purpose='sustain';
      if(p.active&&p.amount>0&&target.hp/target.stats.hp<=.35)band=1;
    } else if(effect.type==='status') {
      const status=battle.statusDefinition(effect.status);if(!status)continue;
      const existing=[...target.statuses.values()].find(s=>s.definition.id===status.id&&s.sourceId===unit.id);
      if(existing&&(existing.expiresAt-battle.tick)*battle.stepSeconds>1)continue;
      const duration=Math.min(HORIZON,status.duration);
      for(const mod of status.modifiers||[]) {
        if(mod.op!=='flat')continue;
        if(mod.stat==='armor'||mod.stat==='resist') {
          const p=pressure(battle,target);
          if(p.active){support+=p.amount*mod.value/(100+target.stats[mod.stat]+mod.value)/2;purpose='sustain';}
        } else if(mod.stat==='attackSpeed'&&battle.living(unit.side==='hero'?'enemy':'hero').length) {
          damage+=Math.max(0,mod.value)*duration*target.stats.attack;band=Math.min(band,3);
        }
      }
      if(status.control==='stun'&&target.casting&&(target.casting.end-battle.tick)*battle.stepSeconds>skill.castTime){band=Math.min(band,2);support+=1;purpose='interrupt';}
    }
  }
  // Cast time only displaces attacks when a basic attack would become ready during it.
  const occupied=Math.max(0,skill.castTime-Math.max(0,(unit.nextAttack-battle.tick)*battle.stepSeconds));
  damage=Math.max(0,damage-occupied*unit.stats.attack*unit.stats.attackSpeed);
  if(damage>0)purpose='damage';
  const value=damage+support;
  if(value<=EPS)return null;
  const wait=Math.max(0,(unit.ready[index]-battle.tick)*battle.stepSeconds);
  return {index,skill,band,purpose,value,wait,score:value/(1+wait/HORIZON)};
}
export function chooseManagedSkill(battle,unit) {
  const options=unit.skills.map((_,i)=>unit.skillModes[i]==='managed'?evaluateSkill(battle,unit,i):null).filter(x=>x&&x.wait<=HORIZON&&x.skill.cost<=unit.stats.mana&&
    (unit.mana>=x.skill.cost||unit.stats.manaRegen>0));
  const scarce=options.reduce((sum,x)=>sum+x.skill.cost,0)>unit.mana;
  const metric=x=>scarce&&x.skill.cost>0?x.score/x.skill.cost:x.score;
  // Different purposes retain explicit template priority instead of adding incomparable units.
  const compare=(a,b)=>a.band-b.band||(a.purpose===b.purpose?metric(b)-metric(a):(b.skill.priority||0)-(a.skill.priority||0))||a.skill.castTime-b.skill.castTime||a.index-b.index;
  options.sort(compare);
  let goal=options.find(x=>x.index===unit.castPlan?.index);
  const best=options[0];
  if(!goal||best&&(best.band<goal.band||best.band===goal.band&&best.purpose===goal.purpose&&metric(best)>metric(goal)*1.25))goal=best;
  if(!goal){unit.castPlan=null;unit.castReason='当前收益低';return null;}
  // Discount only permanent guaranteed regeneration: expiring buffs are not credit.
  const regen=Math.max(0,Math.min(unit.stats.manaRegen,unit.guaranteedManaRegen));
  const reserve=Math.max(0,goal.skill.cost-regen*goal.wait);
  unit.castPlan={index:goal.index,reserve};
  for(const option of options.filter(x=>x.wait===0)) {
    if(unit.mana+EPS<option.skill.cost)continue;
    if(option.index!==goal.index&&option.band>=goal.band&&unit.mana-option.skill.cost+EPS<reserve)continue;
    if(battle.skillReason(unit,option.index)==='就绪'){
      unit.castReason=option.band===1?'优先救急':`准备释放${option.index+1}`;return option.index;
    }
  }
  unit.castReason=`为${goal.index+1}留蓝`;
  if(unit.mana>=goal.skill.cost)unit.castReason=`等待${goal.index+1}就绪`;
  return null;
}
