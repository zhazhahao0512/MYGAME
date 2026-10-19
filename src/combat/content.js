import { SKILLS } from '../data.js';
import { flatModifiers } from './attributes.js';
export const STATUSES={
  fortify:{id:'fortify',name:'坚守',duration:3,stacking:'refresh',modifiers:[{stat:'armor',op:'flat',value:8},{stat:'resist',op:'flat',value:8}]},
  tempo:{id:'tempo',name:'疾行',duration:3,stacking:'refresh',modifiers:[{stat:'haste',op:'flat',value:20},{stat:'attackSpeed',op:'flat',value:.15}]},
  resonance:{id:'resonance',name:'共鸣',duration:4,stacking:'stack',maxStacks:3,modifiers:[{stat:'armor',op:'flat',value:4},{stat:'resist',op:'flat',value:4}]},
  stun:{id:'stun',name:'眩晕',duration:.5,stacking:'refresh',control:'stun'},
};
const commonSkills=SKILLS.map((s,i)=>({...s,id:`common-${s.key}`,priority:[10,30,20,40][i],castTime:0,retarget:'release',
  target:s.type==='heal'?'allyWeakest':s.type==='shield'?'self':s.type==='ultimate'?'allEnemies':'enemy',
  effects:s.type==='heal'?[{type:'heal',amount:30,power:1}]:s.type==='shield'?[{type:'shield',amount:30,power:1}]:
    [{type:'damage',damageType:'magic',attack:s.type==='ultimate'?1.8:1.3,power:.8,travel:.3}],
}));
const stoneSkills=[
  {...commonSkills[0],id:'stone-Q',name:'盾击',castTime:.25,effects:[{type:'damage',damageType:'physical',attack:1.4,power:0,travel:.2,onHit:[{type:'status',status:'stun'}]}],description:'吟唱 0.25 秒后盾击当前选定敌人，造成物理伤害并眩晕 0.5 秒。目标死亡时重新选敌。'},
  {...commonSkills[1],id:'stone-W',name:'回息',description:'治疗生命比例最低的友军，治疗量为 30 + 法强。'},
  {...commonSkills[2],id:'stone-E',name:'坚守',effects:[{type:'shield',amount:30,power:1},{type:'status',status:'fortify'}],description:'获得 30 + 法强的护盾，物抗和魔抗提高 8，持续 3 秒。'},
  {...commonSkills[3],id:'stone-R',name:'壁垒冲击',castTime:.6,description:'吟唱 0.6 秒后冲击全部敌人，造成魔法伤害。可以手动释放。'},
];
export const STONE_PASSIVE={name:'不屈',description:'受到生命伤害后，获得 3 秒坚守（物抗、魔抗 +8），冷却 4 秒。与自身 E 的坚守刷新，不重复叠加。'};
export const AUGMENTS=[{id:'resonant-guard',name:'坚韧共鸣',description:'全队生命上限 +40。每次完成施法获得 4 秒共鸣：物抗、魔抗 +4，最多 3 层，重复获得刷新持续时间。',stats:{hp:40},
  trigger:{id:'resonant-guard',event:'cast',relation:'source',effects:[{type:'status',target:'self',status:'resonance'}]}}];
export const EQUIPMENT_EFFECTS={
  armor:{description:'受到生命伤害时，向攻击者反击 6 点物理伤害。每件装备冷却 1 秒。',trigger:{id:'thorns',event:'damaged',relation:'target',cooldown:1,effects:[{type:'damage',target:'attacker',amount:6,damageType:'physical'}]}},
  rune:{description:'自身获得护盾时恢复 8 点生命，每件装备冷却 1 秒。',trigger:{id:'shelter',event:'shield',relation:'target',cooldown:1,effects:[{type:'heal',target:'self',amount:8}]}},
  clock:{description:'造成暴击时获得 3 秒疾行：攻速 +0.15，技能急速 +20。重复触发刷新时间。',trigger:{id:'tempo',event:'critical',relation:'source',effects:[{type:'status',target:'self',status:'tempo'}]}},
};
export function skillsFor(heroId) {return structuredClone(heroId==='stone'?stoneSkills:commonSkills);}
export function enemySkills(boss) {return boss?[{id:'boss-crush',key:'Q',name:'重击',cost:10,cooldown:8,initialCooldown:5,priority:10,castTime:.4,retarget:'release',target:'enemy',effects:[{type:'damage',damageType:'physical',attack:1.2,power:0,travel:.2}]}]:[];}
export function loadoutModifiers(member,augments=[]) {
  return [...member.gear.flatMap((item,slot)=>item?flatModifiers(`gear:${slot}`,item.stats):[]),
    ...augments.flatMap(id=>flatModifiers(`augment:${id}`,AUGMENTS.find(a=>a.id===id)?.stats||{}))];
}
export function triggersFor(member,augments=[]) {
  const triggers=member.hero==='stone'?[{id:'passive:stone',event:'damaged',relation:'target',cooldown:4,effects:[{type:'status',target:'self',status:'fortify'}]}]:[];
  for(const [slot,item] of member.gear.entries())if(item?.rarity==='orange'&&EQUIPMENT_EFFECTS[item.base])triggers.push({...EQUIPMENT_EFFECTS[item.base].trigger,id:`gear:${slot}:${item.uid}`});
  for(const id of augments){const a=AUGMENTS.find(a=>a.id===id);if(a)triggers.push({...a.trigger,id:`augment:${id}`});}
  return structuredClone(triggers);
}
