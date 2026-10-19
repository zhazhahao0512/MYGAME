import { enemyStats } from './combat/enemies.js';
import { actionHitChance } from './heroes/accuracy.js';
import { progressionSummary } from './heroes/progression.js';
import { threeTargets } from './heroes/integration.js';
import { lanyaMechanicReason,lanyaAutoReady,releaseLanya,lanyaAttackPayload,lanyaMainHit } from './heroes/lanya.js';
// Deterministic combat. Phaser only reads this model and its bounded visual events.
import { heroById, RULES, BASE } from './data.js';
import { baseStatsFor, random } from './model.js';
import { createUnit, applyStatus, expireStatuses, isControlled } from './combat/unit.js';
import { skillsFor, enemySkills, loadoutModifiers, triggersFor, STATUSES } from './combat/content.js';
import { CAST_MODES, normalizeSkillModes, chooseManagedSkill } from './combat/casting.js';
import { TriggerQueue } from './combat/events.js';
import { BATTLE_V2, ENEMY_TYPES, CHALLENGE_TYPES, TARGET_MODES, normalizeTactics, rankTargets } from './combat/tactics.js';
import { GOLD_SCALE } from './equipment.js';
import { initializeEquipment, hasPassive, syncEquipment, changeEquipmentTarget, absorbEquipmentShield, procSnapshot, basicHit, recordParticipation, restoreTakedownMana } from './combat/equipment.js';
export const STEP=.02;
export const hitChance=(accuracy,evasion=0,distance=0,correction=0)=>Math.max(0,Math.min(1,(accuracy+correction-evasion-distance)/100));
export const cooldown=(seconds,haste)=>seconds/(1+Math.max(0,haste)/100);
const ticks=seconds=>Math.max(1,Math.ceil(seconds/STEP));
export class Battle {
  constructor(run,{duration=RULES.roundSeconds,tuning={}}={}) {
    this.stepSeconds=STEP;this.run=run;this.rng={seed:run.seed};this.tick=0;this.durationTicks=Math.round(duration/STEP);
    this.phase='combat';this.serial=0;this.shotSerial=0;this.shots=[];this.feed=[];this.kills=0;this.gold=0;this.bossKilled=false;
    this.tuning={...BATTLE_V2,...tuning};this.nextSpawn=ticks(this.tuning.spawnSeconds);
    this.challengeSerial=0;this.offerRng={seed:(run.seed^0x42cafe)>>>0};this.challengeOffers=[];this.challengeRevision=0;
    this.effects=[];this.effectSerial=0;this.regenTotals=new Map();this.events=new TriggerQueue();
    this.party=run.party.map((member,slot)=>this.makeUnit({side:'hero',slot,name:heroById(member.hero).name,def:heroById(member.hero),
      baseStats:baseStatsFor(member,run.level),modifiers:loadoutModifiers(member,run.augments),
      skills:skillsFor(member.hero,progressionSummary(member,run.level).ranks),triggers:triggersFor(member,run.augments),skillModes:member.skillModes}));
    for(const [index,unit] of this.party.entries()){initializeEquipment(unit,run.party[index].gear);unit.tactics=normalizeTactics(run.party[index].tactics);unit.targetId=null;unit.targetRule=null;}
    this.enemies=Array.from({length:5},(_,slot)=>this.spawn(slot));
    this.challengeOffers=Array.from({length:3},(_,i)=>this.makeOffer(this.tuning.offerSeconds+i*this.tuning.offerStagger));
    this.addFeed('战斗开始 · 点英雄再点敌人，保存优先位置。');
  }
  makeUnit(config) {const unit=createUnit({...config,id:`${config.side}-${++this.serial}`,tick:this.tick,step:STEP});unit.level=config.side==='hero'?this.run.level:this.run.floor;return unit;}
  get time(){return this.tick*STEP;}
  get remaining(){return Math.max(0,(this.durationTicks-this.tick)*STEP);}
  units(){return [...this.party,...this.enemies];}
  living(side){return (side==='hero'?this.party:this.enemies).filter(u=>u&&u.hp>0);}
  find(id){return this.units().find(u=>u?.id===id);}
  spawn(slot,template=null) {
    const floor=this.run.floor,boss=!template&&floor%5===0&&slot===0&&!this.bossKilled;
    const type=template||ENEMY_TYPES.find(t=>t.positions[0]===slot)||ENEMY_TYPES.find(t=>t.positions.includes(slot));
    const baseStats=enemyStats(BASE,{floor,slot,type,boss});
    const unit=this.makeUnit({side:'enemy',slot,name:boss?'守门人':type.name,def:{...type,range:type.caster?'ranged':'melee',color:type.color||'#bd897d'},baseStats,skills:enemySkills(boss||type.caster),boss});
    unit.reward=(template?template.reward:boss?15:3)*GOLD_SCALE;unit.challenge=!!template;unit.enemyType=type.id;
    unit.nextAttack=this.tick+ticks(.8);return unit;
  }
  makeOffer(seconds=this.tuning.offerSeconds) {
    const type=CHALLENGE_TYPES[Math.floor(random(this.offerRng)*CHALLENGE_TYPES.length)];
    return {id:`challenge-${++this.challengeSerial}`,type,expiresAt:this.tick+ticks(seconds)};
  }
  challengeSlot(type) {
    const preferred=type.positions.find(n=>this.enemies[n].hp<=0);
    if(preferred!==undefined)return preferred;
    // Recommendation is a preference, not a barrier to immediate entry into a vacancy.
    return this.enemies.filter(u=>u.hp<=0).sort((a,b)=>
      Math.min(...type.positions.map(n=>Math.abs(a.slot-n)))-Math.min(...type.positions.map(n=>Math.abs(b.slot-n)))||a.slot-b.slot)[0]?.slot;
  }
  canAcceptChallenge(id) {
    const offer=this.challengeOffers.find(o=>o.id===id&&o.expiresAt>this.tick);
    return this.phase==='combat'&&this.tick<this.durationTicks&&!!offer&&this.challengeSlot(offer.type)!==undefined;
  }
  acceptChallenge(id) {
    if(!this.canAcceptChallenge(id))return false;
    const index=this.challengeOffers.findIndex(o=>o.id===id),offer=this.challengeOffers[index];
    this.placeEnemy(this.challengeSlot(offer.type),offer.type);
    this.challengeOffers[index]=this.makeOffer();this.challengeRevision++;
    this.addFeed('挑战已入场 · 击败后获得额外金币。');return true;
  }
  placeEnemy(slot,type=null) {
    this.regenTotals.delete(this.enemies[slot].id);this.enemies[slot]=this.spawn(slot,type);
    this.emitEffect('spawn',this.enemies[slot]);
  }
  refreshSpawns() {
    for(let i=0;i<this.challengeOffers.length;i++)if(this.challengeOffers[i].expiresAt<=this.tick){this.challengeOffers[i]=this.makeOffer();this.challengeRevision++;}
    if(this.tick<this.nextSpawn)return;
    this.nextSpawn=this.tick+ticks(this.tuning.spawnSeconds);
    let budget=this.tuning.batchSize;
    for(let slot=0;slot<5&&budget;slot++)if(this.enemies[slot].hp<=0){this.placeEnemy(slot);budget--;}
  }
  attackChance(source,target){return actionHitChance(source,target);}
  setTactics(index,patch,targetId=null) {
    const unit=this.party[index];if(!unit||unit.hp<=0||!['combat','cleanup'].includes(this.phase))return false;
    if(patch.mode!==undefined&&!TARGET_MODES.some(m=>m.id===patch.mode))return false;
    if(patch.preferredSlot!==undefined&&patch.preferredSlot!==null&&(!Number.isInteger(patch.preferredSlot)||patch.preferredSlot<0||patch.preferredSlot>4))return false;
    const target=targetId?this.living('enemy').find(u=>u.id===targetId):null;
    if(targetId&&!target)return false;
    unit.tactics=normalizeTactics({...unit.tactics,...patch});this.run.party[index].tactics={...unit.tactics};
    changeEquipmentTarget(unit,target?.id||null);unit.targetId=target?.id||null;unit.targetRule=unit.rules.attackTarget===unit.baseRules.attackTarget?'player':unit.rules.attackTarget;return true;
  }
  commandTarget(index,id){const target=this.living('enemy').find(u=>u.id===id);return !!target&&this.setTactics(index,{preferredSlot:target.slot},id);}
  addFeed(text){this.feed.unshift({time:this.time,text});this.feed.length=Math.min(this.feed.length,6);}
  emitEffect(type,unit,amount=0,crit=false,details={}) {
    this.effects.push({id:++this.effectSerial,tick:this.tick,type,target:unit.id,side:unit.side,slot:unit.slot,amount,crit,...details});
    if(this.effects.length>256)this.effects.splice(0,this.effects.length-256);
  }
  emit(type,source,target,amount=0,extra={}) {this.events.enqueue({type,tick:this.tick,source:source?.id,target:target?.id,amount,...extra});}
  flushTriggers() {
    this.events.drain(event=>{
      // Stable unit order, then definition order: passive, equipment slots, augment.
      for(const owner of this.units())for(const trigger of owner.triggers) {
        if(owner.hp<=0&&event.type!=='death')continue;
        if(trigger.event!==event.type||event[trigger.relation||'source']!==owner.id)continue;
        if(event.type==='damaged'&&event.amount<=0)continue;
        if((owner.triggerReady.get(trigger.id)||0)>this.tick)continue;
        this.events.branch(`${owner.id}:${trigger.id}`,()=>{
          owner.triggerReady.set(trigger.id,this.tick+Math.max(0,Math.ceil((trigger.cooldown||0)/STEP)));
          for(const effect of trigger.effects) {
            const target=effect.target==='attacker'?this.find(event.source):effect.target==='victim'?this.find(event.target):owner;
            if(target)this.applyEffect(owner,target,effect,{origin:'trigger',originId:trigger.id});
          }
        });
      }
    });
  }
  target(source,rule=source.rules.attackTarget) {
    const units=this.living(source.side==='hero'?'enemy':'hero');if(!units.length){changeEquipmentTarget(source,null);source.targetId=null;return null;}
    // Source overrides stay compatible with special content; defaults use player intent.
    const override=rule!==source.baseRules.attackTarget;
    const key=override?rule:'player';
    if(source.side==='hero'&&source.tactics){
      if(source.targetRule!==key){source.targetId=null;source.targetRule=key;}
      const locked=units.find(u=>u.id===source.targetId);if(locked)return locked;
      if(!override){const chosen=rankTargets(source,units,source.tactics,(a,b)=>this.attackChance(a,b),this.tuning.neighborRadius)[0];changeEquipmentTarget(source,chosen.id);source.targetId=chosen.id;return chosen;}
    }
    const chosen=rule==='random'?units[Math.floor(random(this.rng)*units.length)]:rule==='slot3'?units.find(u=>u.slot===2)||units[0]:rule==='weakest'?units.reduce((a,b)=>a.hp<b.hp?a:b):units[0];
    changeEquipmentTarget(source,chosen.id);source.targetId=chosen.id;return chosen;
  }
  getSkill(unit,index) {
    const skill=unit?.skills[index];if(!skill)return null;
    const rank=skill.rank??1;
    const resolved={...skill,...(skill.ranks?.[rank-1]||{}),rank};
    for(const key of ['cost','cooldown','castTime','priority','target']) {
      const value=unit.rules[`skill.${skill.key}.${key}`];if(value!==undefined)resolved[key]=value;
    }
    for(const key of ['cost','cooldown','castTime'])if(!Number.isFinite(resolved[key])||resolved[key]<0)throw new Error(`Invalid skill ${skill.id}: ${key}`);
    if(!['self','enemy','threeEnemies','allEnemies','allAllies','allyWeakest'].includes(resolved.target))throw new Error(`Invalid skill target ${resolved.target}`);
    return resolved;
  }
  candidates(unit,skill) {
    const enemies=this.living(unit.side==='hero'?'enemy':'hero');
    if(skill.target==='self')return unit.hp>0?[unit]:[];
    if(skill.target==='allEnemies')return enemies;
    if(skill.target==='allAllies')return this.living(unit.side);
    if(skill.target==='allyWeakest')return this.living(unit.side).filter(u=>!skill.effects.some(e=>e.type==='heal')||u.hp<u.stats.hp-1).sort((a,b)=>a.hp/a.stats.hp-b.hp/b.stats.hp).slice(0,1);
    return enemies;
  }
  skillTargets(unit,skill) {if(skill.target==='threeEnemies')return threeTargets(this.target(unit),this.candidates(unit,skill));return skill.target==='enemy'?[this.target(unit)].filter(Boolean):this.candidates(unit,skill);}
  statusDefinition(status){return typeof status==='string'?STATUSES[status]:status;}
  previewSkillTargets(unit,skill) {
    if(skill.target==='threeEnemies')return threeTargets(this.previewSkillTargets(unit,{...skill,target:'enemy'})[0],this.candidates(unit,skill));
    const candidates=this.candidates(unit,skill);if(skill.target!=='enemy')return candidates;
    const locked=candidates.find(u=>u.id===unit.targetId);if(locked)return [locked];
    if(unit.tactics&&unit.rules.attackTarget===unit.baseRules.attackTarget)return rankTargets(unit,candidates,unit.tactics,(a,b)=>this.attackChance(a,b),this.tuning.neighborRadius).slice(0,1);
    const rule=unit.rules.attackTarget;
    return (rule==='weakest'?[...candidates].sort((a,b)=>a.hp-b.hp):rule==='slot3'?[...candidates].sort((a,b)=>(b.slot===2)-(a.slot===2)):candidates).slice(0,1);
  }
  snapshot(source,target,multiplier=1,skill=false,options={}) {
    syncEquipment(source,this.tick);syncEquipment(target,this.tick);
    const s=source.stats,t=target.stats,damageType=options.damageType||(skill?'magic':'physical'),magic=['magic','shield_piercing_magic'].includes(damageType);
    const hit=options.canMiss===false||random(this.rng)<actionHitChance(source,target,options);
    const crit=(options.canCrit??!skill)&&random(this.rng)<s.crit;
    const resistance=Math.max(0,(magic?t.resist:t.armor)-(magic?s.magicPen:s.armorPen));
    const raw=((options.amount||0)+s.attack*(options.attack??multiplier)+s.power*(options.power??(skill?.8:0)))*(crit?s.critDamage+(!skill&&hasPassive(source,'basic_crit_multiplier')?.15:0):1)*(1+s.damageAmp);
    const damage=damageType==='true'?raw:raw*100/(100+resistance)*(1-t.reduction)*(!skill&&damageType==='physical'&&hasPassive(target,'basic_physical_guard')?.92:1);
    return {hit,crit,powerSnapshot:s.power,damageType,damage:Math.max(0,damage),vamp:options.noVamp?0:(skill?0:s.lifeSteal)+s.omni,lifeSteal:skill||options.noVamp?0:s.lifeSteal,omni:options.noVamp?0:s.omni,healing:s.healing};
  }
  fire(source,target,{skill=false,multiplier=1,duration,...options}={}) {
    if(!skill)changeEquipmentTarget(source,target.id);
    syncEquipment(source,this.tick);syncEquipment(target,this.tick);
    const shot={id:++this.shotSerial,source:source.id,target:target.id,side:source.side,sourceSlot:source.slot,targetSlot:target.slot,
      start:this.tick,end:this.tick+ticks(duration??1/source.stats.attackSpeed),skill,visualColor:source.def?.color,attackRange:source.def?.range||'melee',origin:skill?'skill':'attack',originId:options.originId||(skill?'skill':'attack'),skillKey:options.skillKey||'',onHit:structuredClone(options.onHit||[]),
      ...this.snapshot(source,target,multiplier,skill,options)};
    if(!skill){if(hasPassive(source,'triple_hit_damage'))shot.comboDamage=procSnapshot(this,source,target,source.stats.attack*.30,'physical','triple_hit_damage');}
    if(!skill)shot.heroPayload=lanyaAttackPayload(this,source,target);
    this.shots.push(shot);
    if(!skill){source.attack={start:shot.start,end:shot.end};this.emit('attack',source,target);this.flushTriggers();}
    return shot;
  }
  settle(shot) {
    if(shot.resolved)return;shot.resolved=true;
    const target=this.find(shot.target),source=this.find(shot.source);
    if(!target||target.hp<=0)return;
    this.events.root(()=>{
      if(!shot.hit){target.lastEvent={text:'闪避',tick:this.tick,type:'dodge'};this.emitEffect('dodge',target,0,false,this.visualSource(source,shot));this.emit('dodge',source,target);return;}
      if(!shot.skill&&hasPassive(source,'low_health_lifesteal')&&source.hp>0&&source.hp<source.stats.hp*.5){shot={...shot,vamp:shot.vamp+.03,lifeSteal:shot.lifeSteal+.03};}
      if(!shot.skill)lanyaMainHit(this,source,shot.heroPayload);
      this.dealDamage(source,target,shot);
      for(const part of shot.heroPayload?.parts||[])if(target.hp>0)this.dealDamage(source,target,{...part,hit:true,crit:false,vamp:0,healing:0,origin:'heroEffect',suppressHitTriggers:true});
      if(!shot.skill)basicHit(this,source,target,shot);
      if(shot.spellBonus&&target.hp>0)this.dealDamage(source,target,shot.spellBonus);
      if(target.hp>0&&source)for(const effect of shot.onHit||[])this.applyEffect(source,target,effect,this.visualSource(source,shot));
    });
    this.flushTriggers();
  }
  visualSource(source,context={}) {return {source:source?.id||context.source,origin:context.origin||(context.skill?'skill':'attack'),originId:context.originId||'attack',skillKey:context.skillKey||'',visualColor:context.visualColor||source?.def?.color,attackRange:context.attackRange||source?.def?.range};}
  dealDamage(source,target,snapshot) {
    if(target.hp<=0)return;
    if(snapshot.damage>0)target.lastDamagedTick=this.tick;
    const absorbed=snapshot.damageType==='shield_piercing_magic'?0:Math.min(target.shield,snapshot.damage);target.shield-=absorbed;absorbEquipmentShield(target,absorbed);
    const lost=Math.min(target.hp,snapshot.damage-absorbed);target.hp=Math.max(0,target.hp-lost);
    target.lastEvent={text:lost>0?`${snapshot.crit?'暴击 ':''}−${Math.round(lost)}`:`护盾 −${Math.round(absorbed)}`,tick:this.tick,type:'damage'};
    if(lost>0||absorbed>0)this.emitEffect('damage',target,lost,!!snapshot.crit,{...this.visualSource(source,snapshot),hpLoss:lost,shieldLoss:absorbed});
    recordParticipation(this,source,target,lost+absorbed);
    if(!snapshot.suppressHitTriggers){this.emit('hit',source,target,lost,{absorbed});if(snapshot.crit)this.emit('critical',source,target,lost);}
    this.emit('damaged',source,target,lost,{absorbed});
    if(source?.hp>0&&lost>0&&snapshot.vamp>0)this.heal(source,source,lost*snapshot.vamp*(1+snapshot.healing),{...this.visualSource(source,snapshot),healingKind:snapshot.lifeSteal>0?(snapshot.omni>0?'vamp':'lifesteal'):'omni'});
    syncEquipment(target,this.tick);
    if(target.hp===0) {
      restoreTakedownMana(this,target);
      this.emitEffect('death',target);this.emit('kill',source,target);this.emit('death',source,target);
      target.shield=0;target.attack=null;target.casting=null;target.pendingCast=null;target.castPlan=null;
      if(target.side==='enemy') {
        this.kills++;const gold=target.reward??(target.boss?150:30);this.gold+=gold;
        if(target.boss)this.bossKilled=true;
        // The slot stays empty until the shared spawn scheduler can fill it.
        this.addFeed(`${target.name}被击败 · +${gold} 金币`);
      }else this.addFeed(`${target.name}暂时倒下了。`);
    }
  }
  heal(source,target,amount,context={}) {
    if(target.hp<=0)return;
    const actual=Math.max(0,Math.min(target.stats.hp-target.hp,amount));target.hp+=actual;syncEquipment(target,this.tick);
    if(actual>0){this.emitEffect('heal',target,actual,false,{...this.visualSource(source,context),healingKind:context.healingKind||'heal'});this.emit('heal',source,target,actual);}
  }
  addStatus(source,target,statusId) {
    const definition=typeof statusId==='string'?STATUSES[statusId]:statusId;
    if(!definition)throw new Error(`Unknown status ${statusId}`);
    const interrupted=target.casting;
    const status=applyStatus(target,definition,source.id,this.tick,STEP);
    if(status){if(definition.control==='stun')target.pendingCast=null;this.emit('status',source,target,status.stacks,{status:definition.id});if(interrupted&&!target.casting)this.emit('interrupt',source,target);}
    return status;
  }
  applyEffect(source,target,effect,context={origin:'trigger',originId:'effect'}) {
    if(target.hp<=0)return;
    if(effect.type==='heal')this.heal(source,target,((effect.amount||0)+source.stats.power*(effect.power||0))*(1+source.stats.healing),context);
    else if(effect.type==='shield') {
      const amount=Math.max(0,((effect.amount||0)+source.stats.power*(effect.power||0))*(1+source.stats.shielding));
      if(amount>0){target.shield+=amount;this.emitEffect('shield',target,amount,false,this.visualSource(source,context));this.emit('shield',source,target,amount);}
    }else if(effect.type==='status')this.addStatus(source,target,effect.status);
    else if(effect.type==='damage') {
      const snapshot={...this.snapshot(source,target,0,true,{attack:0,power:0,...effect}),...context};
      if(snapshot.hit)this.dealDamage(source,target,snapshot);
      else {this.emitEffect('dodge',target,0,false,this.visualSource(source,context));this.emit('dodge',source,target);}
    }else throw new Error(`Unknown effect ${effect.type}`);
  }
  skillReason(unit,index,{ignoreCasting=false}={}) {
    if(!unit||unit.hp<=0)return '已阵亡';
    const skill=this.getSkill(unit,index);if(!skill)return '无技能';
    if(isControlled(unit))return '被控制';
    if(skill.rank===0)return '未学习';
    const mechanic=lanyaMechanicReason(unit,index);if(mechanic)return mechanic;
    if(unit.casting&&!ignoreCasting)return '施法中';
    if(unit.ready[index]>this.tick)return `${((unit.ready[index]-this.tick)*STEP).toFixed(1)}s`;
    if(unit.mana<skill.cost)return '法力不足';
    if(!this.candidates(unit,skill).length)return skill.target==='allyWeakest'?'等待受伤':'等待目标';
    return '就绪';
  }
  setSkillMode(heroIndex,index,mode) {
    const unit=this.party[heroIndex];
    if(!unit?.skills[index]||!CAST_MODES.includes(mode))return false;
    unit.skillModes=normalizeSkillModes(unit.skillModes,unit.skills.length);unit.skillModes[index]=mode;
    this.run.party[heroIndex].skillModes=[...unit.skillModes];
    unit.castPlan=null;unit.castReason='';unit.pendingCast=null;return true;
  }
  requestCast(unit,index) {
    if(!['combat','cleanup'].includes(this.phase))return false;
    const reason=this.skillReason(unit,index,{ignoreCasting:true});
    if(reason!=='就绪'){if(unit)unit.lastCommandReason=reason;return false;}
    if(unit.casting){unit.pendingCast={index,expiresAt:this.tick+ticks(1.5)};unit.lastCommandReason='等待当前动作';return true;}
    unit.pendingCast=null;const ok=this.cast(unit,index);unit.lastCommandReason=ok?'已释放':this.skillReason(unit,index);return ok;
  }
  runCasting(unit) {
    if(unit.pendingCast){
      const command=unit.pendingCast;unit.pendingCast=null;
      if(command.expiresAt>=this.tick){if(!this.cast(unit,command.index))unit.lastCommandReason=this.skillReason(unit,command.index);}
      else unit.lastCommandReason='指令已过期';
      if(unit.casting)return;
    }
    const priorities=unit.skills.map((_,index)=>index).sort((a,b)=>(this.getSkill(unit,b).priority||0)-(this.getSkill(unit,a).priority||0)||a-b);
    for(const index of priorities){
      if(unit.side==='hero'&&unit.skillModes[index]!=='auto')continue;
      if(!lanyaAutoReady(unit,index))continue;
      this.cast(unit,index);if(unit.casting||unit.hp<=0||isControlled(unit))return;
    }
    if(unit.side==='hero')for(let n=0;n<unit.skills.length;n++){
      const index=chooseManagedSkill(this,unit);if(index===null||!this.cast(unit,index))break;
      unit.castPlan=null;if(unit.casting||unit.hp<=0||isControlled(unit))break;
    }
  }
  cast(unit,index) {
    if(!['combat','cleanup'].includes(this.phase)||this.skillReason(unit,index)!=='就绪')return false;
    const skill=this.getSkill(unit,index),targets=this.skillTargets(unit,skill);
    if(!targets.length)return false;
    unit.mana-=skill.cost;unit.ready[index]=this.tick+ticks(cooldown(skill.cooldown,unit.stats.haste));
    const action={index,skill,targets:targets.map(t=>t.id),start:this.tick,end:this.tick+Math.max(0,Math.ceil(skill.castTime/STEP))};
    this.emit('castStart',unit,unit,0,{skill:skill.id});
    if(skill.castTime>0)unit.casting=action;else this.release(unit,action);
    this.flushTriggers();return true;
  }
  release(unit,action) {
    const {skill}=action;
    let targets=action.targets.map(id=>this.find(id)).filter(u=>u?.hp>0);
    if(skill.retarget==='release'&&targets.length<action.targets.length)targets=this.skillTargets(unit,skill);
    if(!targets.length){this.emit('fizzle',unit,unit,0,{skill:skill.id});this.flushTriggers();return;}
    const empowered=hasPassive(unit,'charged_spell_damage')&&unit.equipment.spellReady<=this.tick&&skill.effects.some(e=>e.type==='damage');
    let firstDamage=true;
    this.events.root(()=>{
      releaseLanya(this,unit,action.index,skill);
      for(const target of targets)for(const effect of skill.effects) {
        if(effect.type==='damage'){
          const shot=this.fire(unit,target,{skill:true,duration:effect.travel??.3,...effect,originId:skill.id,skillKey:unit.side==='hero'?String(action.index+1):skill.key});
          if(empowered&&firstDamage){
            shot.spellBonus=procSnapshot(this,unit,target,25+.05*shot.powerSnapshot,'magic','charged_spell_damage');
            unit.equipment.spellReady=this.tick+ticks(12);
          }
          firstDamage=false;
        }
        else this.applyEffect(unit,target,effect,{origin:'skill',originId:skill.id,skillKey:unit.side==='hero'?String(action.index+1):skill.key});
      }
      this.emit('cast',unit,unit,0,{skill:skill.id});
    });
    this.flushTriggers();
  }
  step() {
    if(!['combat','cleanup'].includes(this.phase))return;
    this.tick++;
    if(this.tick>=this.durationTicks&&this.phase==='combat'){this.phase='cleanup';this.challengeOffers=[];this.challengeRevision++;this.addFeed('时间到，停止补位。清理剩余敌人！');}
    for(const unit of this.units()){expireStatuses(unit,this.tick);syncEquipment(unit,this.tick);}
    const due=this.shots.filter(s=>s.end<=this.tick);this.shots=this.shots.filter(s=>s.end>this.tick);
    for(const shot of due)this.settle(shot);
    if(!this.living('hero').length){this.phase='lost';this.shots=[];for(const u of this.units())u.pendingCast=null;return;}
    if(this.phase==='cleanup'&&!this.living('enemy').length){this.phase='won';this.shots=[];for(const u of this.units())u.pendingCast=null;return;}
    if(this.phase==='combat')this.refreshSpawns();
    for(const unit of this.units()) {
      if(unit.hp<=0)continue;
      const hpBefore=unit.hp;
      unit.hp=Math.min(unit.stats.hp,unit.hp+unit.stats.hpRegen*(1+unit.stats.healing)*STEP);
      // Natural regeneration remains outside heal triggers. Only its display is batched.
      this.regenTotals.set(unit.id,(this.regenTotals.get(unit.id)||0)+unit.hp-hpBefore);
      if(this.tick%50===0){const actual=this.regenTotals.get(unit.id);if(actual>0)this.emitEffect('heal',unit,actual,false,{source:unit.id,origin:'regen',originId:'regen',healingKind:'regen'});this.regenTotals.delete(unit.id);}
      syncEquipment(unit,this.tick);
      unit.mana=Math.min(unit.stats.mana,unit.mana+unit.stats.manaRegen*STEP);
      if(unit.pendingCast&&unit.pendingCast.expiresAt<this.tick){unit.pendingCast=null;unit.lastCommandReason='指令已过期';}
      if(isControlled(unit)){unit.pendingCast=null;continue;}
      if(unit.casting) {
        if(unit.casting.end>this.tick)continue;
        const action=unit.casting;unit.casting=null;this.release(unit,action);
      }
      this.runCasting(unit);
      if(unit.hp>0&&!unit.casting&&!isControlled(unit)&&unit.nextAttack<=this.tick) {
        const target=this.target(unit);if(target){const shot=this.fire(unit,target);unit.nextAttack=shot.end;}
      }
    }
  }
  result(){return {won:this.phase==='won',kills:this.kills,gold:this.gold,seconds:this.time};}
}
