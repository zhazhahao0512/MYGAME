// Saved player intent is separate from the transient, unique-unit target lock.
export const TARGET_MODES = Object.freeze([
  {id:'hit',name:'命中最高'}, {id:'ratio',name:'血量比例最低'},
  {id:'health',name:'生命值最低'}, {id:'near',name:'最近'}, {id:'far',name:'最远'},
]);
export const TACTICS_DEFAULT = Object.freeze({mode:'hit',preferredSlot:null});
export function normalizeTactics(value) {
  return {mode:TARGET_MODES.some(m=>m.id===value?.mode)?value.mode:'hit',
    preferredSlot:Number.isInteger(value?.preferredSlot)&&value.preferredSlot>=0&&value.preferredSlot<5?value.preferredSlot:null};
}
export const slotDistance = (source,target) => source.slot+target.slot+1;
export function rankTargets(source,candidates,tactics,chance,radius=1) {
  let pool=[...candidates];
  if(tactics.preferredSlot!==null){
    const nearby=pool.filter(u=>Math.abs(u.slot-tactics.preferredSlot)<=radius);
    if(nearby.length)pool=nearby;
  }
  const score=u=>tactics.mode==='ratio'?u.hp/u.stats.hp:tactics.mode==='health'?u.hp:
    tactics.mode==='far'?-slotDistance(source,u):tactics.mode==='near'?slotDistance(source,u):-chance(source,u);
  return pool.sort((a,b)=>score(a)-score(b)||slotDistance(source,a)-slotDistance(source,b)||a.slot-b.slot||a.id.localeCompare(b.id));
}

// Playtest defaults, not final balance. All positions here are zero-based.
export const BATTLE_V2 = Object.freeze({spawnSeconds:2,batchSize:5,neighborRadius:1,offerSeconds:12,offerStagger:4});
export const ENEMY_TYPES = Object.freeze([
  {id:'guard',color:'#d49a91',name:'铁卫',mark:'卫',role:'前排守卫',positions:[0,1],health:1.2,damage:1,move:100},
  {id:'claw',color:'#d2ae7b',name:'灰爪',mark:'爪',role:'中排斗士',positions:[2,1,3],health:1,damage:1.1,move:104},
  {id:'hexer',color:'#ac9ed1',name:'咒术师',mark:'咒',role:'后排术士',positions:[4,3,2],health:.85,damage:1.15,move:100},
]);
export const CHALLENGE_TYPES = Object.freeze([
  {...ENEMY_TYPES[0],id:'elite-guard',name:'精英铁卫',reward:18,health:3.6,damage:1.8,description:'耐久更高的前排挑战。'},
  {...ENEMY_TYPES[2],id:'elite-hexer',name:'深渊咒术师',reward:21,health:2.55,damage:2.07,description:'会施放重击的后排挑战。',caster:true},
  {...ENEMY_TYPES[1],id:'rival',name:'游侠挑战者',role:'敌方英雄',mark:'侠',positions:[3,4,2],reward:25,health:3,damage:1.98,description:'敌方英雄挑战，不是招募同伴。',caster:true},
]);
