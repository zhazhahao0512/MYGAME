// First implementation values. Lanya follows docs/heroes/LANYA.md V0.2.
// The seven prototype heroes have provisional individual panels, not finished kits.
export const CORE_STATS=['hp','hpRegen','mana','manaRegen','attack','attackSpeed','armor','resist'];
export const ATTRIBUTE_GOLD={hp:2,hpRegen:250/3,mana:3,manaRegen:250,attack:37.5,power:20,attackSpeed:3750,armor:35,resist:35};
const panel=(values)=>Object.fromEntries(CORE_STATS.map((key,i)=>[key,values[i]]));
const profile=(role,range,base,growth,subtypes,routes)=>({role,range,base:panel(base),growth:panel(growth),subtypes,routes});
export const HERO_PROFILES={
  stone:profile('坦克','melee',[1128.6,2.64,182.4,2.83,60.8,.78,39.6,29.4],[81.7,.17,8.3,.10,2.41,.017,3.12,1.87],['护盾','双抗承伤'],['生命双抗','护盾支援']),
  wind:profile('射手','ranged',[824.7,1.58,204.6,3.14,79.6,.96,26.8,23.9],[59.8,.12,10.2,.11,3.36,.023,2.17,1.38],['持续普攻'],['攻击攻速','攻击特效']),
  ember:profile('法师','ranged',[798.3,1.46,258.7,3.87,62.9,.82,24.6,30.2],[56.9,.11,13.4,.16,2.16,.016,1.83,2.03],['范围输出'],['法强','法力续航']),
  leaf:profile('辅助','ranged',[856.9,2.13,246.5,4.12,57.3,.86,27.9,31.7],[62.8,.16,12.6,.18,1.93,.014,2.02,2.14],['治疗支援'],['回复支援','生命双抗']),
  blade:profile('战士','melee',[982.4,2.28,187.3,2.91,83.7,.89,33.8,27.6],[72.3,.15,8.9,.11,3.47,.021,2.68,1.76],['持续近战'],['攻击续航','攻防混合']),
  shade:profile('刺客','melee',[842.6,1.81,213.8,3.37,87.2,1.03,27.3,25.8],[61.4,.13,10.8,.13,3.62,.024,2.08,1.59],['收割'],['攻击穿透','攻速特效']),
  tide:profile('法师','ranged',[831.5,1.94,239.2,3.69,65.1,.84,25.7,32.8],[60.2,.14,12.8,.15,2.28,.018,1.94,2.21],['法术支援'],['法强急速','法力续航']),
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
