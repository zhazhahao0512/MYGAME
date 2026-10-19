// Actual Battle adapter, separate from the historical Python design model.
import { Battle,STEP } from '../battle.js';
import { BASE } from '../data.js';
import { initializeProgression } from './progression.js';

export function runHeroBenchmark({hero='lanya',level=15,seed=1,count=1,seconds=40,mode='managed',gear=[],target,attacker=null,pressure=1,slot=2}={}){
  if(![1,3,5].includes(count)||seconds<=0||!target)throw new Error('Invalid benchmark case');
  const member={hero,gear:Array.from({length:4},(_,i)=>gear[i]||null),skillModes:Array(4).fill(mode)};
  initializeProgression(member,level,seed,{legacy:true});
  const run={seed,level,floor:1,party:[member],augments:[]};
  const b=new Battle(run,{duration:seconds+1});b.party[0].slot=slot;b.challengeOffers=[];b.pendingChallenges=[];b.nextSpawn=Infinity;
  const slots={1:[2],3:[1,2,3],5:[0,1,2,3,4]}[count],hp=(600+160*level)*(target.hp_factor||1),resistance=20+2*level;
  b.enemies=slots.map((position,i)=>b.makeUnit({side:'enemy',slot:position,name:`木桩${i+1}`,def:{id:'benchmark',range:'ranged',attackRule:'front'},
    baseStats:{...BASE,hp,mana:0,manaRegen:0,hpRegen:0,power:0,crit:0,attackSpeed:1,attack:0,accuracy:95,evasion:target.evasion||0,armor:resistance*target.armor_factor,resist:resistance*target.mr_factor,reduction:target.reduction||0},skills:[]}));
  b.refreshSpawns=()=>{};for(const t of b.enemies){t.nextAttack=Infinity;t.reward=0;}
  const report={hero,level,seed,count,seconds,mode,target:target.id,attacker:attacker?.id||null,pressure,skillRanks:[...member.progression.ranks],
    hpDamage:0,shieldDamage:0,incomingHp:0,incomingShield:0,healing:0,manaSpent:0,casts:[0,0,0,0],damageBySource:{},damageByTarget:{},deathTime:null,rightCensored:true,
    notSupported:['finite cohorts/replacement','control overlays','healing suppression','full auxiliary support suite']};
  const originalDamage=b.dealDamage.bind(b),originalHeal=b.heal.bind(b),originalCast=b.cast.bind(b),originalRelease=b.release.bind(b);
  b.dealDamage=(source,t,snapshot)=>{
    const heroTarget=t.side==='hero',before=t.hp,shieldBefore=t.shield;
    // Potential-output targets preserve their visible health; suppress kill/overkill.
    // During settlement only, enough HP is provided to measure the full snapshot.
    if(!heroTarget)t.hp=Math.max(t.hp,snapshot.damage+1);
    const measuredHp=t.hp;originalDamage(source,t,snapshot);
    const lost=measuredHp-t.hp,absorbed=shieldBefore-t.shield;
    if(heroTarget){report.incomingHp+=lost;report.incomingShield+=absorbed;if(t.hp<=0&&report.deathTime===null){report.deathTime=b.time;report.rightCensored=false;}}
    else {report.hpDamage+=lost;report.shieldDamage+=absorbed;const key=snapshot.originId||'attack';report.damageBySource[key]=(report.damageBySource[key]||0)+lost+absorbed;report.damageByTarget[t.slot]=(report.damageByTarget[t.slot]||0)+lost+absorbed;t.hp=before;}
  };
  b.heal=(source,t,amount,context)=>{const before=t.hp;originalHeal(source,t,amount,context);if(t.side==='hero')report.healing+=t.hp-before;};
  b.cast=(u,i)=>{const before=u.mana,ok=originalCast(u,i);if(ok&&u.side==='hero')report.manaSpent+=Math.max(0,before-u.mana);return ok;};
  b.release=(u,action)=>{originalRelease(u,action);if(u.side==='hero')report.casts[action.index]++;};
  const end=Math.round(seconds/STEP),period=attacker?Math.max(1,Math.round(attacker.period_seconds/STEP)):0;
  for(let tick=0;tick<end&&b.party[0].hp>0;tick++){
    if(target.shield_period_seconds&&tick%Math.round(target.shield_period_seconds/STEP)===0)for(const t of b.enemies)t.shield=hp*target.shield_hp_factor;
    if(attacker&&tick%period===0)for(const source of b.enemies){
      // Fixed total raw pressure, distributed equally across sources; synchronized.
      for(const component of attacker.components)b.fire(source,b.party[0],{skill:component.action!=='basic',duration:0,amount:(80+8*level)*pressure*attacker.period_seconds*component.share/count,attack:0,power:0,damageType:component.type,noVamp:true,originId:attacker.id});
    }
    b.step();
  }
  report.elapsed=Math.min(seconds,b.time);report.dps=(report.hpDamage+report.shieldDamage)/seconds;report.manaEnd=b.party[0].mana;report.hpEnd=b.party[0].hp;
  report.survived=report.deathTime===null;return report;
}
