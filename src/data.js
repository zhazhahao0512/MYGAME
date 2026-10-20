import { HERO_PROFILES,LANYA_HERO } from './heroes/foundation.js';
// All content in this file is provisional. It exercises the interface, not final balance.
export const RULES = Object.freeze({ floors: 20, slots: 4, party: 5, roundSeconds: 40, killsPerLevel: 12 });
export const BASE = Object.freeze({ hp: 340, mana: 100, hpRegen: 2, manaRegen: 5, attack: 28, power: 0,
  attackSpeed: 1, bonusAttackSpeed: 0, totalAttackSpeed: 1, accuracy: 95, evasion: 0, haste: 0, crit: 0, critDamage: 1.5, armor: 12, resist: 10, omni: 0,
  lifeSteal: 0, move: 100, focus: 100, tenacity: 0, armorPen: 0, magicPen: 0,
  damageAmp: 0, reduction: 0, healing: 0, shielding: 0 });
export const HEROES = [
  LANYA_HERO,
  {id:'lishan',name:'砺山',mark:'岩',color:'#d7bb83',description:'承伤积蓄坚毅，转化护盾，以短嘲讽保护同伴。',attackRule:'front'},
  {id:'jinli',name:'烬璃',mark:'焰',color:'#c391ce',description:'叠加余烬印记，连携技能引爆多名敌人。',attackRule:'front'},
  {id:'shuoying',name:'朔影',mark:'影',color:'#b6b9d2',description:'标记猎物提高招式精准，用魔法爆发收割残血。',attackRule:'weakest'},
  {id:'lingxi',name:'泠汐',mark:'澜',color:'#95cbbc',description:'以持续治疗和短时减伤，帮助队友撑过伤害高峰。',attackRule:'front'},
];
for(const hero of HEROES){const p=HERO_PROFILES[hero.id];Object.assign(hero,{role:p.role,range:p.range,stats:{...p.base,power:0,crit:0},growth:p.growth,tags:p.subtypes,subtypes:p.subtypes,routes:p.routes});}
export const heroById = id => HEROES.find(h => h.id === id);
export const STAT_LABELS = {hp:'生命上限',mana:'法力上限',hpRegen:'生命回复',manaRegen:'法力回复',attack:'攻击力',power:'法术强度',attackSpeed:'攻击速度',haste:'技能急速',crit:'暴击率',critDamage:'暴击伤害',armor:'物理抗性',resist:'魔法抗性',omni:'全能吸血',lifeSteal:'吸血',move:'旧移速',focus:'旧专注',accuracy:'精准',evasion:'闪避',bonusAttackSpeed:'额外攻速',totalAttackSpeed:'总攻速倍率',tenacity:'韧性',armorPen:'护甲穿透',magicPen:'法术穿透',damageAmp:'伤害增幅',reduction:'受到伤害降低',healing:'治疗增强',shielding:'护盾增强'};
export const PRIMARY = ['attack','power','attackSpeed','haste','crit','omni','armor','resist'];
export const SECONDARY = ['critDamage','lifeSteal','evasion','accuracy','armorPen','magicPen','tenacity','damageAmp','reduction','healing','shielding'];
export const PERCENT = new Set(['crit','critDamage','omni','lifeSteal','tenacity','damageAmp','reduction','healing','shielding']);
export function statText(key, value) { return PERCENT.has(key) ? `${Math.round(value*100)}%` : key==='attackSpeed' ? value.toFixed(2) : ['hpRegen','manaRegen'].includes(key) ? `${Number(value.toFixed(1))}/s` : String(Number(value.toFixed(1))); }
export const LEGACY_RARITIES = [
  {id:'white',name:'普通',color:'#babfb6',scale:1,price:16},
  {id:'green',name:'优良',color:'#a2c47b',scale:1.35,price:23},
  {id:'blue',name:'精良',color:'#86b5de',scale:1.75,price:32},
  {id:'purple',name:'史诗',color:'#c09bd9',scale:2.2,price:44},
  {id:'red',name:'强化',color:'#e48d85',scale:2.8,price:58},
  {id:'orange',name:'特殊',color:'#efb45f',scale:2.2,price:48},
];
export const RARITIES = LEGACY_RARITIES.filter(r=>r.id!=='green').map(r=>({id:r.id,color:r.color,name:({white:'基础',blue:'进阶',purple:'史诗',red:'成装',orange:'特殊'})[r.id]}));
export const rarityFor = id => RARITIES.find(r=>r.id===id)||LEGACY_RARITIES.find(r=>r.id===id);
// Legacy templates are retained only for existing saves and explicit compatibility fixtures.
export const ITEMS = [
  {id:'sword',name:'磨砺短刃',mark:'刃',stats:{attack:10}},
  {id:'orb',name:'余烬法珠',mark:'珠',stats:{power:14}},
  {id:'armor',name:'铆钉护衣',mark:'甲',stats:{armor:10,hp:45}},
  {id:'clock',name:'铜制沙漏',mark:'漏',stats:{haste:12,attackSpeed:.08}},
  {id:'fang',name:'猩红獠牙',mark:'牙',stats:{lifeSteal:.06,attack:3}},
  {id:'soul',name:'汲魂石',mark:'魂',stats:{omni:.04,power:5}},
  {id:'boots',name:'轻羽短靴',mark:'靴',stats:{move:4,tenacity:.04}},
  {id:'lens',name:'鹰眼镜片',mark:'镜',stats:{focus:8,crit:.04}},
  {id:'robe',name:'隔魔披肩',mark:'衣',stats:{resist:12,hp:30}},
  {id:'seed',name:'青芽护符',mark:'符',stats:{hpRegen:1,healing:.08}},
  {id:'rune',name:'守护印章',mark:'印',stats:{shielding:.1,reduction:.03}},
  {id:'well',name:'清泉坠饰',mark:'泉',stats:{manaRegen:2,mana:15}},
];
