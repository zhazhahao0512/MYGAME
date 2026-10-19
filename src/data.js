// All content in this file is provisional. It exercises the interface, not final balance.
export const RULES = Object.freeze({ floors: 20, slots: 4, party: 5, roundSeconds: 40 });
export const BASE = Object.freeze({ hp: 340, mana: 100, hpRegen: 2, manaRegen: 5, attack: 28, power: 12,
  attackSpeed: 1, haste: 0, crit: .05, critDamage: 1.5, armor: 12, resist: 10, omni: 0,
  lifeSteal: 0, move: 100, focus: 100, tenacity: 0, armorPen: 0, magicPen: 0,
  damageAmp: 0, reduction: 0, healing: 0, shielding: 0 });
export const HEROES = [
  { id:'stone', name:'磐石', role:'守卫', mark:'守', color:'#d7bb83', description:'站在队伍前方，为同伴撑起一道防线。', tags:['前排承伤','护盾'], attackRule:'front', stats:{hp:520,armor:30,attack:24,attackSpeed:.85} },
  { id:'wind', name:'逐风', role:'射手', mark:'弓', color:'#a9c7a3', description:'锁定远处的目标，用持续攻击撕开缺口。', tags:['远程输出','连续攻击'], attackRule:'slot3', stats:{attack:36,attackSpeed:1.35,crit:.15,focus:110} },
  { id:'ember', name:'烬语', role:'法师', mark:'术', color:'#b5a6ce', description:'以法术点燃战场，让每一次释放都更有分量。', tags:['法术输出','范围攻击'], attackRule:'random', stats:{hp:310,power:40,mana:140,manaRegen:7} },
  { id:'leaf', name:'青禾', role:'医者', mark:'愈', color:'#9ecbbd', description:'照顾受伤的同伴，让队伍走得更远。', tags:['治疗支援','持续恢复'], attackRule:'front', stats:{power:30,healing:.2,manaRegen:7,attack:20} },
  { id:'blade', name:'赤刃', role:'斗士', mark:'刃', color:'#d69682', description:'在一次次交锋中积累优势，越战越勇。', tags:['近战输出','吸血'], attackRule:'front', stats:{hp:400,attack:32,lifeSteal:.12,attackSpeed:1.15} },
  { id:'shade', name:'夜隼', role:'刺客', mark:'影', color:'#b6b9d2', description:'寻找虚弱的目标，在恰当时机完成收割。', tags:['目标选择','暴击'], attackRule:'weakest', stats:{attack:34,crit:.2,move:108} },
  { id:'tide', name:'听潮', role:'术士', mark:'潮', color:'#95bacb', description:'以灵活的法术节奏，为队伍创造机会。', tags:['法术支援','技能急速'], attackRule:'random', stats:{power:32,haste:20,mana:120} },
];
export const heroById = id => HEROES.find(h => h.id === id);
export const STAT_LABELS = {hp:'生命上限',mana:'法力上限',hpRegen:'生命回复',manaRegen:'法力回复',attack:'攻击力',power:'法术强度',attackSpeed:'攻击速度',haste:'技能急速',crit:'暴击率',critDamage:'暴击伤害',armor:'物理抗性',resist:'魔法抗性',omni:'全能吸血',lifeSteal:'吸血',move:'移动速度',focus:'专注',tenacity:'韧性',armorPen:'护甲穿透',magicPen:'法术穿透',damageAmp:'伤害增幅',reduction:'受到伤害降低',healing:'治疗增强',shielding:'护盾增强'};
export const PRIMARY = ['attack','power','attackSpeed','haste','crit','omni','armor','resist'];
export const SECONDARY = ['critDamage','lifeSteal','move','focus','armorPen','magicPen','tenacity','damageAmp','reduction','healing','shielding'];
export const PERCENT = new Set(['crit','critDamage','omni','lifeSteal','tenacity','damageAmp','reduction','healing','shielding']);
export function statText(key, value) { return PERCENT.has(key) ? `${Math.round(value*100)}%` : key==='attackSpeed' ? value.toFixed(2) : ['hpRegen','manaRegen'].includes(key) ? `${Number(value.toFixed(1))}/s` : String(Number(value.toFixed(1))); }
export const RARITIES = [
  {id:'white',name:'普通',color:'#babfb6',scale:1,price:16},
  {id:'green',name:'优良',color:'#a2c47b',scale:1.35,price:23},
  {id:'blue',name:'精良',color:'#86b5de',scale:1.75,price:32},
  {id:'purple',name:'史诗',color:'#c09bd9',scale:2.2,price:44},
  {id:'red',name:'强化',color:'#e48d85',scale:2.8,price:58},
  {id:'orange',name:'特殊',color:'#efb45f',scale:2.2,price:48},
];
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
export const SKILLS = [
  {key:'Q',name:'技能一',type:'damage',cooldown:4,cost:12,description:'演示效果：对一个敌人造成伤害。'},
  {key:'W',name:'技能二',type:'heal',cooldown:7,cost:16,description:'演示效果：治疗伤势最重的队友。'},
  {key:'E',name:'技能三',type:'shield',cooldown:9,cost:18,description:'演示效果：为自身添加护盾。'},
  {key:'R',name:'大招',type:'ultimate',cooldown:12,cost:30,description:'演示效果：对所有敌人造成伤害。支持自动或手动释放。'},
];
