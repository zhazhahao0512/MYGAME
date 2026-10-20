// Rank data is shared by combat, previews and the skill-up screen.
export const HERO_PASSIVES={
 lishan:{name:'坚毅岩心',description:'敌方实际血盾伤害的18%存为坚毅，最多自身最大生命8%；施放1全部转为额外护盾。大招期间回收提高，致死伤害不救活。'},
 jinli:{name:'余烬印记',description:'1/2/4命中叠加8秒余烬，2给两层。三层清空并造成24＋6×英雄等级＋40%法强魔法伤害；不暴击、不吸血、不递归触发。'},
 shuoying:{name:'猎杀直觉',description:'1和4发射时，目标生命严格低于40%则主伤害提高12%。普攻仍是物理伤害，技能为魔法伤害。'},
 lingxi:{name:'扶危',description:'1和4每段治疗结算前，若目标生命低于40%，该段治疗提高12%。不增强装备治疗、自然回复或吸血。'},
};
const damage=(amount,power=0,extra={})=>({type:'damage',damageType:'magic',amount,attack:0,power,travel:.25,...extra});
const special=(kind,extra={})=>({type:'hero',kind,...extra});
const status=(id,name,duration,modifiers=[],extra={})=>({id,name,duration,stacking:'refresh',modifiers,...extra});
function skill(hero,index,name,target,costs,cooldowns,castTime,ranks,description){
 return {id:`${hero}-${index+1}`,key:['Q','W','E','R'][index],name,target,cost:costs[0],cooldown:cooldowns[0],castTime,priority:[40,30,10,50][index],initialCooldown:0,retarget:'release',description,
  effects:ranks[0].effects||[],ranks:ranks.map((r,i)=>({...r,cost:costs[i],cooldown:cooldowns[i]}))};
}
const four=fn=>Array.from({length:4},(_,r)=>fn(r));
const three=fn=>Array.from({length:3},(_,r)=>fn(r));
export const FORMAL_SKILLS={
 lishan:[
  skill('lishan',0,'磐岩护体','self',[34,37,40,43],[12,11,10,9],0,four(r=>({effects:[special('stoneShield',{amount:90+40*r,hp:.09,duration:4})],detail:`${90+40*r}＋9%最大生命＋消耗的坚毅护盾，持续4秒。`})),'同来源旧盾替换；消耗全部坚毅，护盾增强只算一次。'),
  skill('lishan',1,'截阵盾击','enemy',[28,31,34,37],[14,13,12,11],0,four(r=>({effects:[damage(30+20*r,0,{damageType:'physical',attack:.5,travel:.2,noVamp:true,taunt:.9+.2*r})],detail:`${30+20*r}＋50%攻击力物理伤害；嘲讽${Number((.9+.2*r).toFixed(1))}秒。`})),'只改变敌方随后发起的单体攻击目标，不中断在途攻击或已开始的吟唱。'),
  skill('lishan',2,'裂地回震','threeEnemies',[38,41,44,47],[14,13,12,11],0,four(r=>({effects:[damage(50+30*r,0,{damageType:'physical',attack:.8,bonusHp:.04,travel:.3,noVamp:true})],detail:`每目标${50+30*r}＋80%攻击力＋4%额外生命物理伤害。`})),'最多3个不同敌人；额外生命不含基础和固定等级成长，不触发普攻特效或吸血。'),
  skill('lishan',3,'不动山关','self',[70,80,90],[58,51,44],0,three(r=>({effects:[special('stoneUltimate',{amount:140+60*r,hp:.12,duration:8,recovery:.24+.06*r})],detail:`${140+60*r}＋12%最大生命护盾，8秒内坚毅回收${24+6*r}%。`})),'独立护盾，容量仍为最大生命8%；不重置技能，大招状态中不能重开。'),
 ],
 jinli:[
  skill('jinli',0,'焰核迸裂','threeEnemies',[38,44,50,56],[9,8,7,6],.25,four(r=>({effects:[damage(115+55*r,.95,{marks:1})],detail:`每目标${115+55*r}＋95%法强魔法伤害，叠1层余烬。`})),'最多3个不同目标；三层引爆。'),
  skill('jinli',1,'引火烙印','threeEnemies',[32,36,40,44],[14,13,12,11],.2,four(r=>({effects:[damage(45+25*r,.4,{travel:.2,marks:2})],detail:`每目标${45+25*r}＋40%法强魔法伤害，叠2层余烬。`})),'帮助1技能引爆；不削减魔抗、不增加易伤。'),
  skill('jinli',2,'烬衣','self',[32,36,40,44],[18,17,16,15],0,four(r=>({effects:[special('timedShield',{amount:80+25*r,power:.55,duration:3})],detail:`${80+25*r}＋55%法强护盾，持续3秒。`})),'只提供自身短护盾，不附加治疗、免控或余烬。'),
  skill('jinli',3,'天火坠落','allEnemies',[80,95,110],[60,52,44],.6,three(r=>({effects:[damage(220+100*r,1.1,{travel:.35,marks:1})],detail:`每目标${220+100*r}＋110%法强魔法伤害，叠1层余烬。`})),'最多5个不同敌人，少人时不集中伤害。'),
 ],
 shuoying:[
  skill('shuoying',0,'蚀影刃','enemy',[38,42,46,50],[10,9,8,7],.2,four(r=>({effects:[damage(160+80*r,1.15,{travel:.2,hunt:true})],detail:`${160+80*r}＋115%法强魔法伤害。`})),'单体爆发，享受猎杀直觉和寻隙招式精准。'),
  skill('shuoying',1,'寻隙','enemy',[24,27,30,33],[16,15,14,13],0,four(r=>({effects:[special('huntMark',{accuracy:12+4*r,duration:5})],detail:`对标记目标的1和4获得＋${12+4*r}招式精准，持续5秒。`})),'标记本身不判命中，不伤害、不控制；仅一个目标，不增加普攻精准。'),
  skill('shuoying',2,'影幕','self',[28,32,36,40],[18,17,16,15],0,four(r=>({effects:[{type:'status',status:status('shuoying-veil','影幕',2.5,[{stat:'evasion',op:'flat',value:10+4*r}])}],detail:`＋${10+4*r}闪避，持续2.5秒。`})),'不取消已发射攻击的命中，不提供无敌或隐身。'),
  skill('shuoying',3,'终夜裁断','enemy',[80,95,110],[62,54,46],.35,three(r=>({effects:[damage(340+130*r,1.4,{travel:.2,hunt:true,execute:true})],detail:`${340+130*r}＋140%法强魔法伤害；按目标已损生命比例最多提高50%。`})),'发射时读取血线，低于40%另享被动12%；正常吃魔抗和护盾，可闪避，无击杀刷新。'),
 ],
 lingxi:[
  skill('lingxi',0,'回澜','allyWeakest',[40,46,52,58],[10,9,8,7],.2,four(r=>({effects:[special('healingWave',{amount:110+50*r,power:.65,tickAmount:20+6*r,tickPower:.08,count:3})],detail:`立即治疗${110+50*r}＋65%法强，随后3秒每秒${20+6*r}＋8%法强。`})),'同来源持续治疗刷新不叠加，每段独立判断低血加成，可治疗自己。'),
  skill('lingxi',1,'安澜','allyPressure',[32,36,40,44],[16,15,14,13],0,four(r=>({effects:[special('protection',{reduction:.10+.03*r,duration:4})],detail:`一名友方获得${10+3*r}%减伤，持续4秒。`})),'真实伤害绕过，与其它比例减伤乘算；不回改已发射攻击。'),
  skill('lingxi',2,'缚流','enemy',[34,38,42,46],[18,17,16,15],.2,four(r=>({effects:[damage(60+30*r,.4,{onHit:[{type:'status',status:status('lingxi-stun','缚流',.6+.1*r,[],{control:'stun'})}]})],detail:`${60+30*r}＋40%法强魔法伤害；命中眩晕${Number((.6+.1*r).toFixed(1))}秒。`})),'单体短控制，闪避则控制也失败，不取消在途攻击。'),
  skill('lingxi',3,'百川归潮','threeAllies',[85,100,115],[64,56,48],.35,three(r=>({effects:[special('healingWave',{amount:90+40*r,power:.3,tickAmount:30+10*r,tickPower:.1,count:5})],detail:`最多3名友方各立即治疗${90+40*r}＋30%法强，随后5秒每秒${30+10*r}＋10%法强。`})),'按生命比例选人，持续效果不需引导；少人不集中、死亡不转移，无复活。'),
 ],
};
export function formalSkills(heroId,ranks=[0,0,0,0]){
 const definitions=FORMAL_SKILLS[heroId];
 return definitions?.map((s,i)=>({...structuredClone(s),...structuredClone(s.ranks[Math.max(0,ranks[i]-1)]),rank:ranks[i]}));
}
