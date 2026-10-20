// Five formal heroes; draft specifications live in docs/heroes/.
export const CORE_STATS=['hp','hpRegen','mana','manaRegen','attack','attackSpeed','armor','resist'];
export const ATTRIBUTE_GOLD={hp:2,hpRegen:250/3,mana:3,manaRegen:250,attack:37.5,power:20,attackSpeed:3750,armor:35,resist:35};
const panel=(values)=>Object.fromEntries(CORE_STATS.map((key,i)=>[key,values[i]]));
const profile=(role,range,base,growth,subtypes,routes)=>({role,range,base:panel(base),growth:panel(growth),subtypes,routes});
export const HERO_PROFILES={
  lishan:profile('坦克','melee',[1146.8,2.48,184.6,2.92,61.7,.756,36.8,31.6],[78.9,.16,8.7,.11,2.46,.0172,2.68,2.14],['生命护盾','短时保护'],['生命护盾','针对抗性','半肉输出']),
  jinli:profile('法师','ranged',[816.7,1.46,278.4,3.72,58.9,.812,25.4,29.8],[60.8,.115,12.3,.13,2.08,.0155,1.94,2.06],['印记引爆','范围爆发'],['法强爆发','急速续航','法系生存']),
  shuoying:profile('刺客','melee',[842.9,1.69,216.8,3.08,68.4,.934,27.6,28.9],[61.7,.125,10.2,.12,2.67,.0184,2.16,1.87],['单体魔法','残血收割'],['法强爆发','急速追猎','生存混合']),
  lingxi:profile('辅助','ranged',[868.3,1.82,254.6,3.66,55.8,.784,26.7,30.2],[64.3,.125,11.6,.135,1.96,.0142,2.04,2.17],['续航治疗','短时保护'],['法强治疗','急速法力','生存保护']),
  lanya:profile('射手','ranged',[873,1.72,196.8,3.26,76.4,.91,28.7,24.3],[63.4,.13,9.6,.12,3.18,.026,2.35,1.45],['高频普攻','攻击特效','持续输出'],['攻速特效','攻击力','法强附魔','生存']),
};
export const LANYA_HERO={id:'lanya',name:'岚牙',role:'射手',mark:'弦',color:'#acc6a1',description:'以疾弦驱动淬锋箭，在十秒连射中释放攻击特效。',tags:HERO_PROFILES.lanya.subtypes,attackRule:'slot3',stats:HERO_PROFILES.lanya.base};
export function heroBaseStats(heroId,level=1,base={}) {
  const p=HERO_PROFILES[heroId];if(!p)throw new Error('未知英雄');
  const n=Math.max(0,Math.floor(level)-1),stats={...base,...p.base,power:0,crit:0,accuracy:95,evasion:0};
  for(const key of CORE_STATS)if(key!=='attackSpeed')stats[key]+=p.growth[key]*n;
  // Keep base frequency immutable. All ordinary AS belongs to one additive pool.
  stats.bonusAttackSpeed=p.growth.attackSpeed*n;
  return stats;
}
export function heroBudget(heroId,level=1){
  const p=HERO_PROFILES[heroId],stats=heroBaseStats(heroId,level);
  const value=(row,includeSpeed)=>CORE_STATS.reduce((sum,key)=>sum+(key==='attackSpeed'&&!includeSpeed?0:row[key]*ATTRIBUTE_GOLD[key]),0);
  return {base:value(p.base,false),growth:value(p.growth,true),total:value(stats,false)+stats.bonusAttackSpeed*ATTRIBUTE_GOLD.attackSpeed};
}
