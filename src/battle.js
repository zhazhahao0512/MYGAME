// Deterministic combat. Phaser only reads this model and its bounded visual events.
import { heroById, RULES, BASE } from './data.js';
import { baseStatsFor, random } from './model.js';
import { createUnit, applyStatus, expireStatuses, isControlled } from './combat/unit.js';
import { skillsFor, enemySkills, loadoutModifiers, triggersFor, STATUSES } from './combat/content.js';
import { TriggerQueue } from './combat/events.js';
export const STEP=.02;
export const hitChance=(focus,move)=>Math.max(0,Math.min(1,focus/Math.max(1,move)));
export const cooldown=(seconds,haste)=>seconds/(1+Math.max(0,haste)/100);
const ticks=seconds=>Math.max(1,Math.ceil(seconds/STEP));
export class Battle {
  constructor(run,{duration=RULES.roundSeconds}={}) {
    this.run=run;this.rng={seed:run.seed};this.tick=0;this.durationTicks=Math.round(duration/STEP);
    this.phase='combat';this.serial=0;this.shotSerial=0;this.shots=[];this.feed=[];this.kills=0;this.gold=0;this.bossKilled=false;
    this.effects=[];this.effectSerial=0;this.events=new TriggerQueue();
    this.party=run.party.map((member,slot)=>this.makeUnit({side:'hero',slot,name:heroById(member.hero).name,def:heroById(member.hero),
      baseStats:baseStatsFor(member,run.level),modifiers:loadoutModifiers(member,run.augments),
      skills:skillsFor(member.hero),triggers:triggersFor(member,run.augments),auto:member.auto}));
    this.enemies=Array.from({length:5},(_,slot)=>this.spawn(slot));
    this.addFeed('战斗开始。磐石与部分橙装已接入示例机制。');
  }
  makeUnit(config) {return createUnit({...config,id:`${config.side}-${++this.serial}`,tick:this.tick,step:STEP});}
  get time(){return this.tick*STEP;}
  get remaining(){return Math.max(0,(this.durationTicks-this.tick)*STEP);}
  units(){return [...this.party,...this.enemies];}
  living(side){return (side==='hero'?this.party:this.enemies).filter(u=>u&&u.hp>0);}
  find(id){return this.units().find(u=>u?.id===id);}
  spawn(slot) {
    const floor=this.run.floor,boss=floor%5===0&&slot===0&&!this.bossKilled;
    const baseStats={...BASE,hp:boss?180+floor*30:45+floor*7,attack:boss?12+floor*2:4+floor*1.25,power:0,
      attackSpeed:boss?.65:.55+(slot%3)*.1,armor:floor*1.5,resist:floor*1.5,hpRegen:0,mana:30,manaRegen:1,crit:0};
    const unit=this.makeUnit({side:'enemy',slot,name:boss?'守门人':['灰爪','苔刺','雾灵','铁卫','灰爪'][slot],baseStats,skills:enemySkills(boss),boss});
    unit.nextAttack=this.tick+ticks(.8);return unit;
  }
  addFeed(text){this.feed.unshift({time:this.time,text});this.feed.length=Math.min(this.feed.length,6);}
  emitEffect(type,unit,amount=0,crit=false) {
    this.effects.push({id:++this.effectSerial,tick:this.tick,type,target:unit.id,side:unit.side,slot:unit.slot,amount,crit});
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
            if(target)this.applyEffect(owner,target,effect);
          }
        });
      }
    });
  }
  target(source,rule=source.rules.attackTarget) {
    const units=this.living(source.side==='hero'?'enemy':'hero');if(!units.length)return null;
    if(rule==='random')return units[Math.floor(random(this.rng)*units.length)];
    if(rule==='slot3')return units.find(u=>u.slot===2)||units[0];
    if(rule==='weakest')return units.reduce((a,b)=>a.hp<b.hp?a:b);
    return units[0];
  }
  getSkill(unit,index) {
    const skill=unit?.skills[index];if(!skill)return null;
    const resolved={...skill};
    for(const key of ['cost','cooldown','castTime','priority','target']) {
      const value=unit.rules[`skill.${skill.key}.${key}`];if(value!==undefined)resolved[key]=value;
    }
    for(const key of ['cost','cooldown','castTime'])if(!Number.isFinite(resolved[key])||resolved[key]<0)throw new Error(`Invalid skill ${skill.id}: ${key}`);
    if(!['self','enemy','allEnemies','allAllies','allyWeakest'].includes(resolved.target))throw new Error(`Invalid skill target ${resolved.target}`);
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
  skillTargets(unit,skill) {return skill.target==='enemy'?[this.target(unit)].filter(Boolean):this.candidates(unit,skill);}
  snapshot(source,target,multiplier=1,skill=false,options={}) {
    const s=source.stats,t=target.stats,magic=(options.damageType||(skill?'magic':'physical'))==='magic';
    const hit=options.canMiss===false||(options.canMiss!==true&&skill)||random(this.rng)<hitChance(s.focus,t.move);
    const crit=(options.canCrit??!skill)&&random(this.rng)<s.crit;
    const resistance=Math.max(0,(magic?t.resist:t.armor)-(magic?s.magicPen:s.armorPen));
    const raw=((options.amount||0)+s.attack*(options.attack??multiplier)+s.power*(options.power??(skill ? .8 : 0)))
      *(crit?s.critDamage:1)*(1+s.damageAmp)*100/(100+resistance)*(1-t.reduction);
    return {hit,crit,damage:Math.max(0,raw),vamp:(skill?0:s.lifeSteal)+s.omni,healing:s.healing};
  }
  fire(source,target,{skill=false,multiplier=1,duration,...options}={}) {
    const shot={id:++this.shotSerial,source:source.id,target:target.id,side:source.side,sourceSlot:source.slot,targetSlot:target.slot,
      start:this.tick,end:this.tick+ticks(duration??1/source.stats.attackSpeed),skill,onHit:structuredClone(options.onHit||[]),
      ...this.snapshot(source,target,multiplier,skill,options)};
    this.shots.push(shot);
    if(!skill){source.attack={start:shot.start,end:shot.end};this.emit('attack',source,target);this.flushTriggers();}
    return shot;
  }
  settle(shot) {
    if(shot.resolved)return;shot.resolved=true;
    const target=this.find(shot.target),source=this.find(shot.source);
    if(!target||target.hp<=0)return;
    this.events.root(()=>{
      if(!shot.hit){target.lastEvent={text:'闪避',tick:this.tick,type:'dodge'};this.emitEffect('dodge',target);this.emit('dodge',source,target);return;}
      this.dealDamage(source,target,shot);
      if(target.hp>0&&source)for(const effect of shot.onHit||[])this.applyEffect(source,target,effect);
    });
    this.flushTriggers();
  }
  dealDamage(source,target,snapshot) {
    if(target.hp<=0)return;
    const absorbed=Math.min(target.shield,snapshot.damage);target.shield-=absorbed;
    const lost=Math.min(target.hp,snapshot.damage-absorbed);target.hp=Math.max(0,target.hp-lost);
    target.lastEvent={text:lost>0?`${snapshot.crit?'暴击 ':''}−${Math.round(lost)}`:`护盾 −${Math.round(absorbed)}`,tick:this.tick,type:'damage'};
    this.emitEffect('damage',target,lost||absorbed,snapshot.crit);
    this.emit('hit',source,target,lost,{absorbed});
    if(snapshot.crit)this.emit('critical',source,target,lost);
    this.emit('damaged',source,target,lost,{absorbed});
    if(source?.hp>0&&lost>0&&snapshot.vamp>0)this.heal(source,source,lost*snapshot.vamp*(1+snapshot.healing));
    if(target.hp===0) {
      this.emitEffect('death',target);this.emit('kill',source,target);this.emit('death',source,target);
      target.shield=0;target.attack=null;target.casting=null;
      if(target.side==='enemy') {
        this.kills++;const gold=target.boss?15:3;this.gold+=gold;
        if(target.boss)this.bossKilled=true;
        target.respawnAt=this.tick+ticks(RULES.respawnSeconds);
        this.addFeed(`${target.name}被击败 · +${gold} 金币`);
      }else this.addFeed(`${target.name}暂时倒下了。`);
    }
  }
  heal(source,target,amount) {
    if(target.hp<=0)return;
    const actual=Math.max(0,Math.min(target.stats.hp-target.hp,amount));target.hp+=actual;
    if(actual>0){this.emitEffect('heal',target,actual);this.emit('heal',source,target,actual);}
  }
  addStatus(source,target,statusId) {
    const definition=typeof statusId==='string'?STATUSES[statusId]:statusId;
    if(!definition)throw new Error(`Unknown status ${statusId}`);
    const interrupted=target.casting;
    const status=applyStatus(target,definition,source.id,this.tick,STEP);
    if(status){this.emit('status',source,target,status.stacks,{status:definition.id});if(interrupted&&!target.casting)this.emit('interrupt',source,target);}
    return status;
  }
  applyEffect(source,target,effect) {
    if(target.hp<=0)return;
    if(effect.type==='heal')this.heal(source,target,((effect.amount||0)+source.stats.power*(effect.power||0))*(1+source.stats.healing));
    else if(effect.type==='shield') {
      const amount=Math.max(0,((effect.amount||0)+source.stats.power*(effect.power||0))*(1+source.stats.shielding));
      if(amount>0){target.shield+=amount;this.emitEffect('shield',target,amount);this.emit('shield',source,target,amount);}
    }else if(effect.type==='status')this.addStatus(source,target,effect.status);
    else if(effect.type==='damage') {
      const snapshot=this.snapshot(source,target,0,true,{attack:0,power:0,...effect});
      if(snapshot.hit)this.dealDamage(source,target,snapshot);
      else {this.emitEffect('dodge',target);this.emit('dodge',source,target);}
    }else throw new Error(`Unknown effect ${effect.type}`);
  }
  skillReason(unit,index) {
    if(!unit||unit.hp<=0)return '已阵亡';
    const skill=this.getSkill(unit,index);if(!skill)return '无技能';
    if(isControlled(unit))return '被控制';
    if(unit.casting)return '施法中';
    if(unit.ready[index]>this.tick)return `${((unit.ready[index]-this.tick)*STEP).toFixed(1)}s`;
    if(unit.mana<skill.cost)return '法力不足';
    if(!this.candidates(unit,skill).length)return skill.target==='allyWeakest'?'等待受伤':'等待目标';
    return '就绪';
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
    this.events.root(()=>{
      for(const target of targets)for(const effect of skill.effects) {
        if(effect.type==='damage')this.fire(unit,target,{skill:true,duration:effect.travel??.3,...effect});
        else this.applyEffect(unit,target,effect);
      }
      this.emit('cast',unit,unit,0,{skill:skill.id});
    });
    this.flushTriggers();
  }
  step() {
    if(!['combat','cleanup'].includes(this.phase))return;
    this.tick++;
    if(this.tick>=this.durationTicks&&this.phase==='combat'){this.phase='cleanup';this.addFeed('时间到，停止补位。清理剩余敌人！');}
    for(const unit of this.units())expireStatuses(unit,this.tick);
    const due=this.shots.filter(s=>s.end<=this.tick);this.shots=this.shots.filter(s=>s.end>this.tick);
    for(const shot of due)this.settle(shot);
    if(!this.living('hero').length){this.phase='lost';this.shots=[];return;}
    if(this.phase==='cleanup'&&!this.living('enemy').length){this.phase='won';this.shots=[];return;}
    if(this.phase==='combat')for(let slot=0;slot<5;slot++) {
      const old=this.enemies[slot];if(old.hp<=0&&old.respawnAt<=this.tick){this.enemies[slot]=this.spawn(slot);this.emitEffect('spawn',this.enemies[slot]);}
    }
    for(const unit of this.units()) {
      if(unit.hp<=0)continue;
      unit.hp=Math.min(unit.stats.hp,unit.hp+unit.stats.hpRegen*(1+unit.stats.healing)*STEP);
      unit.mana=Math.min(unit.stats.mana,unit.mana+unit.stats.manaRegen*STEP);
      if(isControlled(unit))continue;
      if(unit.casting) {
        if(unit.casting.end>this.tick)continue;
        const action=unit.casting;unit.casting=null;this.release(unit,action);
      }
      const priorities=unit.skills.map((_,index)=>index).sort((a,b)=>(this.getSkill(unit,b).priority||0)-(this.getSkill(unit,a).priority||0)||a-b);
      for(const index of priorities) {
        if(unit.skills[index].key==='R'&&!unit.auto)continue;
        this.cast(unit,index);if(unit.casting||unit.hp<=0||isControlled(unit))break;
      }
      if(unit.hp>0&&!unit.casting&&!isControlled(unit)&&unit.nextAttack<=this.tick) {
        const target=this.target(unit);if(target){const shot=this.fire(unit,target);unit.nextAttack=shot.end;}
      }
    }
  }
  result(){return {won:this.phase==='won',kills:this.kills,gold:this.gold,seconds:this.time};}
}
