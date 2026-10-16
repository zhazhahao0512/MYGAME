// Each source owns its modifiers. Removal deletes a source, never subtracts values.
const compare = (a,b) => (a.priority||0)-(b.priority||0) || (a.id<b.id?-1:a.id>b.id?1:0);
export function flatModifiers(id, stats) {
  return Object.entries(stats).map(([stat,value])=>({id:`${id}:${stat}`,stat,op:'flat',value}));
}
export function resolveStats(base, modifiers=[]) {
  const result={...base};
  for(const stat of Object.keys(base)) {
    const entries=modifiers.filter(m=>m.stat===stat).sort(compare);
    let flat=0,percent=0,multiply=1,override;
    for(const m of entries) {
      if(!Number.isFinite(m.value))throw new Error(`Invalid modifier ${m.id}`);
      if(m.op==='flat')flat+=m.value;
      else if(m.op==='percent')percent+=m.value;
      else if(m.op==='multiply')multiply*=m.value;
      else if(m.op==='override')override=m.value;
      else throw new Error(`Unknown modifier operation ${m.op}`);
    }
    const value=override??((base[stat]+flat)*(1+percent)*multiply);
    if(!Number.isFinite(value))throw new Error(`Non-finite stat ${stat}`);
    result[stat]=Math.max(0,value);
  }
  result.hp=Math.max(1,result.hp);result.move=Math.max(1,result.move);
  result.attackSpeed=Math.max(.05,result.attackSpeed);
  result.crit=Math.min(1,result.crit);result.tenacity=Math.min(.6,result.tenacity);
  result.reduction=Math.min(.8,result.reduction);
  return result;
}
export function resolveRules(base, overrides=[]) {
  const rules={...base};
  for(const entry of [...overrides].sort(compare))rules[entry.rule]=entry.value;
  return rules;
}
