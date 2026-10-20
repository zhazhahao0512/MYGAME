// Persistent choices, independent of combat RNG and of the equipment economy.
export const SKILL_CAPS=[4,4,4,3];
export const RECOMMENDED_ORDER=[0,1,0,0,3,0,2,1,1,3,1,2,2,2,3];
export const GROWTH_OPTIONS=[
  {id:'hp',name:'生命',stat:'hp',value:150},
  {id:'attack',name:'攻击力',stat:'attack',value:8},
  {id:'attackSpeed',name:'额外攻速',stat:'bonusAttackSpeed',value:.08},
  {id:'armor',name:'护甲',stat:'armor',value:8.5},
  {id:'resist',name:'魔抗',stat:'resist',value:8.5},
  {id:'mana',name:'法力',stat:'mana',value:100},
  {id:'hpRegen',name:'生命回复',stat:'hpRegen',value:3.6},
  {id:'manaRegen',name:'法力回复',stat:'manaRegen',value:1.2},
];
const sum=a=>a.reduce((n,v)=>n+v,0);
export function rankReason(ranks,level,index){
  if(!Number.isInteger(index)||index<0||index>3)return '技能无效';
  if(ranks[index]>=SKILL_CAPS[index])return '已满级';
  if(sum(ranks)>=Math.min(15,level))return '没有技能点';
  if(index===3&&level<(ranks[3]+1)*5)return `${(ranks[3]+1)*5}级解锁`;
  if(index<3&&level===2&&ranks[index]>=1)return '2级须学习不同技能';
  if(index<3&&level<6&&ranks[index]>=3)return '6级可升四级';
  return '';
}
export const FORMAL_RECOMMENDED_ORDER=[0,1,0,2,3,0,0,1,1,3,1,2,2,2,3];
export const recommendedOrder=hero=>hero==='lanya'?RECOMMENDED_ORDER:FORMAL_RECOMMENDED_ORDER;
export function recommendedRanks(level,hero='lanya'){
  const ranks=[0,0,0,0];for(const index of recommendedOrder(hero).slice(0,Math.min(level,15)))ranks[index]++;return ranks;
}
function hash(text){let n=2166136261;for(const c of text)n=Math.imul(n^c.charCodeAt(0),16777619);return n>>>0;}
export function growthOffers(member,choiceIndex=member.progression?.choices.length||0){
  let seed=hash(`${member.progression?.seed??0}:${member.progression?.growthIdentity||member.hero}:${choiceIndex+16}`);
  const pool=[...GROWTH_OPTIONS];
  for(let i=pool.length-1;i>0;i--){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const j=seed%(i+1);[pool[i],pool[j]]=[pool[j],pool[i]];}
  return pool.slice(0,3);
}
export function initializeProgression(member,level,seed=0,{legacy=false}={}){
  if(member.progression)return member.progression;
  member.progression={version:1,seed:hash(`${seed}:${member.hero}`),ranks:legacy?recommendedRanks(level,member.hero):[0,0,0,0],choices:[]};return member.progression;
}
export function validProgression(member,level){
  const p=member.progression;if(!p||p.version!==1||!Number.isInteger(p.seed)||p.seed<0||p.seed>0xffffffff)return false;
  const r=p.ranks;
  if(!Array.isArray(r)||r.length!==4||r.some((n,i)=>!Number.isInteger(n)||n<0||n>SKILL_CAPS[i])||sum(r)>Math.min(15,level))return false;
  if(r[3]>Math.min(3,Math.floor(level/5))||level<6&&r.slice(0,3).some(n=>n>3)||level===2&&r.some(n=>n>1))return false;
  if(!Array.isArray(p.choices)||p.choices.length>Math.max(0,level-15))return false;
  return p.choices.every((id,i)=>growthOffers(member,i).some(o=>o.id===id));
}
export function progressionSummary(member,level){
  const ranks=member.progression?.ranks||recommendedRanks(level,member.hero);
  return {ranks,points:Math.max(0,Math.min(15,level)-sum(ranks)),choices:Math.max(0,level-15-(member.progression?.choices.length||0))};
}
function editable(run,heroIndex){
  if(!['ready','shop','recruit'].includes(run.phase))throw new Error('请在战前或战后分配成长');
  const member=run.party[heroIndex];if(!member)throw new Error('英雄不存在');
  initializeProgression(member,run.level,run.seed);return member;
}
export function upgradeSkill(run,heroIndex,index){
  const m=editable(run,heroIndex),reason=rankReason(m.progression.ranks,run.level,index);
  if(reason)throw new Error(reason);m.progression.ranks[index]++;
}
export function recommendSkills(run,heroIndex){
  const m=editable(run,heroIndex),r=m.progression.ranks;
  // Fill remaining points without undoing any choice the player has made.
  for(let n=0;n<15;n++){
    const desired=recommendedRanks(run.level,m.hero);
    const index=recommendedOrder(m.hero).find(i=>r[i]<desired[i]&&!rankReason(r,run.level,i))??[0,1,2,3].find(i=>!rankReason(r,run.level,i));
    if(index===undefined)break;r[index]++;
  }
}
export function chooseGrowth(run,heroIndex,id){
  const m=editable(run,heroIndex);
  if(!progressionSummary(m,run.level).choices||!growthOffers(m).some(o=>o.id===id))throw new Error('请选择当前成长选项');
  m.progression.choices.push(id);
}
export function growthBonuses(member){
  const result={};for(const id of member.progression?.choices||[]){const o=GROWTH_OPTIONS.find(x=>x.id===id);if(o)result[o.stat]=(result[o.stat]||0)+o.value;}return result;
}
