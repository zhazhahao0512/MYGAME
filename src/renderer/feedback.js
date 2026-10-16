// Pure presentation: bounded, unit-ID-scoped aggregation, no combat writes/RNG.
export const FEEDBACK_COLORS={damage:'#e6dfca',skill:'#77d6ea',critical:'#ffd16a',heal:'#9fe08b',regen:'#a8bc93',shield:'#70c9ff',dodge:'#bbc3b4'};
export function eventParts(event) {
  if(event.type==='damage')return [
    ...((event.hpLoss??event.amount)>0?[{...event,kind:'damage',amount:event.hpLoss??event.amount}]:[]),
    ...(event.shieldLoss>0?[{...event,kind:'absorb',amount:event.shieldLoss}]:[]),
  ];
  return ['heal','shield','dodge'].includes(event.type)?[{...event,kind:event.type}]:[];
}
export function feedbackStyle(group) {
  const key=group.skillKey?`${group.skillKey} `:group.origin==='trigger'?'触发 ':'';
  const number=group.amount>0&&group.amount<1?'<1':String(Math.round(group.amount));
  let text='',color=FEEDBACK_COLORS.damage;
  if(group.kind==='damage'){text=`${key}${group.crit?'暴击 ':''}−${number}`;color=group.crit?FEEDBACK_COLORS.critical:group.origin==='skill'?FEEDBACK_COLORS.skill:FEEDBACK_COLORS.damage;}
  if(group.kind==='absorb'){text=`${key}${group.crit?'暴击 ':''}盾 −${number}`;color=FEEDBACK_COLORS.shield;}
  if(group.kind==='shield'){text=`${key}盾 +${number}`;color=FEEDBACK_COLORS.shield;}
  if(group.kind==='heal'){
    const names={lifesteal:'吸血',omni:'全能',vamp:'吸血/全能',regen:'回复',heal:'治疗'};
    text=`${key}${names[group.healingKind]||'治疗'} +${number}`;color=group.healingKind==='regen'?FEEDBACK_COLORS.regen:FEEDBACK_COLORS.heal;
  }
  if(group.kind==='dodge'){text='闪避';color=FEEDBACK_COLORS.dodge;}
  if(group.count>1)text+=` ×${group.count}`;
  return {text,color};
}
export class PopupBudget {
  constructor(){this.groups=[];this.serial=0;}
  expire(tick,validIds){this.groups=this.groups.filter(g=>tick-g.born<=35&&(!validIds||validIds.has(g.target)));}
  add(event,selectedId='',limit=24){
    for(const part of eventParts(event)){
      const key=JSON.stringify([part.source,part.target,part.origin,part.originId,part.kind,part.crit,part.healingKind]);
      const match=this.groups.find(g=>g.key===key&&event.tick-g.born<=15);
      if(match){match.amount+=part.amount;match.count++;continue;}
      const priority=(part.source===selectedId||part.target===selectedId?5:0)+(part.crit?3:part.healingKind==='regen'?0:2);
      let same=this.groups.filter(g=>g.target===part.target),occupied=same;
      if(same.length<2&&this.groups.length<limit)occupied=[];
      else if(same.length<2)occupied=this.groups;
      if(occupied.length){
        const replace=[...occupied].sort((a,b)=>a.priority-b.priority||a.born-b.born)[0];
        if(replace.priority>priority)continue;
        this.groups=this.groups.filter(g=>g!==replace);
      }
      same=this.groups.filter(g=>g.target===part.target);
      this.groups.push({...part,key,id:++this.serial,born:event.tick,count:1,priority,lane:same.some(g=>g.lane===0)?1:0});
    }
  }
  trim(limit){this.groups.sort((a,b)=>b.priority-a.priority||b.born-a.born);this.groups.length=Math.min(this.groups.length,limit);}
}
