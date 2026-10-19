import Phaser from 'phaser';
import { PopupBudget, feedbackStyle } from './feedback.js';
import type { BattleView, RendererOptions, UnitView, EffectEvent, Side } from './types';

const FONT = '"Noto Sans CJK SC", "Microsoft YaHei", sans-serif';
const COLORS = { gold: 0xe9b44c, green: 0x9fba80, blue: 0x7eb6ce, red: 0xd69381, text: '#ecebdd', muted: '#929d86' };
const LIMITS = { projectiles: 96, popups: 24, particlesPerEmitter: 180, burstsPerFrame: 12 };

type Actor = {
  root: Phaser.GameObjects.Container;
  box: Phaser.GameObjects.Rectangle;
  border: Phaser.GameObjects.Rectangle;
  frame: Phaser.GameObjects.Graphics;
  frameKey: string;
  mark: Phaser.GameObjects.Text;
  name: Phaser.GameObjects.Text;
  role: Phaser.GameObjects.Text;
  subtitle: Phaser.GameObjects.Text;
  slot: Phaser.GameObjects.Text;
  bars: Phaser.GameObjects.Graphics;
  hp: Phaser.GameObjects.Text;
  mana: Phaser.GameObjects.Text;
  shield: Phaser.GameObjects.Text;
  target: Phaser.GameObjects.Text;
  side: Side;
  index: number;
  width: number;
  height: number;
  hovered: boolean;
};
type Popup = { text: Phaser.GameObjects.Text; born: number; x: number; y: number; active: boolean };

/** Phaser owns only presentation and its frame callback. No damage logic lives in this scene. */
class BattleScene extends Phaser.Scene {
  private owner: PhaserBattleRenderer;
  private background!: Phaser.GameObjects.Graphics;
  private trails!: Phaser.GameObjects.Graphics;
  private actors: Actor[] = [];
  private projectiles: { dot: Phaser.GameObjects.Image; glow: Phaser.GameObjects.Image }[] = [];
  private popups: Popup[] = [];
  private bursts!: Record<'damage' | 'heal' | 'shield' | 'spawn', Phaser.GameObjects.Particles.ParticleEmitter>;
  private labels!: Phaser.GameObjects.Text[];
  private hoverLabel!: Phaser.GameObjects.Text;
  private feedback = new PopupBudget();
  private flashes = new Map<string, { tick: number; color: number }>();
  private launched = 0;
  private get compact() { return this.owner.options.compact?.() ?? false; }
  private lastEvent = 0;
  private lastTick = -1;
  private lastMotion = true;

  constructor(owner: PhaserBattleRenderer) {
    super('battle');
    this.owner = owner;
  }

  create() {
    this.background = this.add.graphics().setDepth(0);
    this.trails = this.add.graphics().setDepth(5);
    const texture = this.add.graphics();
    texture.fillStyle(0xffffff).fillCircle(5, 5, 4);
    texture.generateTexture('spark', 10, 10);
    texture.destroy();

    for (const side of ['hero', 'enemy'] as const) {
      for (let index = 0; index < 5; index++) this.actors.push(this.createActor(side, index));
    }
    for (let n = 0; n < LIMITS.projectiles; n++) {
      this.projectiles.push({
        dot: this.add.image(0, 0, 'spark').setDepth(7).setVisible(false),
        glow: this.add.image(0, 0, 'spark').setDepth(6).setAlpha(.14).setVisible(false),
      });
    }
    for (let n = 0; n < LIMITS.popups; n++) {
      this.popups.push({ text: this.label('', 18, COLORS.text).setDepth(12).setVisible(false), born: 0, x: 0, y: 0, active: false });
    }
    const emitter = (tint: number, gravityY: number, angle: { min: number; max: number }) =>
      this.add.particles(0, 0, 'spark', {
        emitting: false, lifespan: { min: 180, max: 440 }, speed: { min: 25, max: 110 },
        angle, gravityY, scale: { start: .75, end: 0 }, alpha: { start: .85, end: 0 },
        tint, maxParticles: LIMITS.particlesPerEmitter, blendMode: Phaser.BlendModes.ADD,
      }).setDepth(8);
    this.bursts = {
      damage: emitter(COLORS.gold, 100, { min: 0, max: 360 }),
      heal: emitter(COLORS.green, -35, { min: 225, max: 315 }),
      shield: emitter(COLORS.blue, 0, { min: 0, max: 360 }),
      spawn: emitter(0xb799c7, -10, { min: 0, max: 360 }),
    };
    this.labels = [
      this.label('我 方', 24, '#73d9d9'),
      this.label('敌 方', 24, '#f49b99'),
      this.label('⚔', 34, '#cbb88c'),
      this.label('死亡留空 · 按推荐位置补怪', 14, '#d2c6b3'),
    ];
    this.hoverLabel = this.label('', 11, '#c6d2b8').setDepth(10);
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this));
    this.input.on('pointerdown', (_pointer: Phaser.Input.Pointer, objects: Phaser.GameObjects.GameObject[]) => {if(!objects.length)this.owner.options.cancelCommand?.();});
    this.layout();
    this.refreshActors();
    this.owner.markReady();
  }

  private label(text: string, fontSize: number, color = COLORS.text) {
    return this.add.text(0, 0, text, { fontFamily: FONT, fontSize, color, resolution: Math.min(devicePixelRatio || 1, 2) }).setOrigin(.5);
  }

  private createActor(side: Side, index: number): Actor {
    const root = this.add.container(0, 0).setDepth(2);
    const box = this.add.rectangle(0, 0, 100, 150, 0x252c22).setStrokeStyle(1, 0x667653);
    const border = this.add.rectangle(0, 0, 88, 138).setStrokeStyle(1, 0x455039, .5);
    const actor: Actor = {
      root, box, border, frame:this.add.graphics(), frameKey:"", side, index, width: 100, height: 150, hovered: false,
      mark: this.label('', 42, '#b4c49f'), name: this.label('', 17),
      role: this.label('', 10, COLORS.muted), subtitle: this.label('', 9, COLORS.muted),
      slot: this.label(String(index + 1), 12, '#acb697'), bars: this.add.graphics(),
      hp: this.label('', 10), mana: this.label('', 10), shield: this.label('', 9, '#c4d8e0'), target:this.label('',11,'#efd397'),
    };
    root.add([box, border, actor.frame, actor.mark, actor.role, actor.name, actor.subtitle, actor.slot, actor.bars, actor.hp, actor.mana, actor.shield, actor.target]);
    box.setInteractive({ useHandCursor: true });
    box.on('pointerover', () => { actor.hovered = true; this.refreshActors(); });
    box.on('pointerout', () => { actor.hovered = false; this.refreshActors(); });
    box.on('pointerdown', () => {
      if (side === 'enemy' && !this.owner.options.paused()) this.owner.options.selectEnemy?.(index);
      if (side === 'hero' && this.owner.battle.party[index] && !this.owner.options.paused()) this.owner.options.select(index);
    });
    return actor;
  }

  private layout() {
    const { width, height } = this.scale;
    const teamWidth = width * (this.compact ? .47 : .435);
    const cell = teamWidth / 5;
    const cardWidth = this.compact ? cell - 5 : Math.max(50, cell - Math.max(10, width * .009));
    const cardHeight = this.compact ? Math.max(44,height - 90) : Math.min(cardWidth * 1.95, height - 100, 430);
    const y = this.compact ? cardHeight / 2 + 17 : Math.min(height-cardHeight/2-35, Math.max(cardHeight/2+75,height*.58));
    for (const actor of this.actors) {
      const position = actor.side === 'hero' ? 4 - actor.index : actor.index;
      const x = actor.side === 'hero' ? cell * (position + .5) + (this.compact?2:10) : width - teamWidth - (this.compact?2:10) + cell * (position + .5);
      actor.width = cardWidth; actor.height = cardHeight;actor.frameKey='';
      actor.root.setPosition(x, y);
      actor.box.setSize(cardWidth, cardHeight);
      if (actor.box.input) actor.box.input.hitArea.setTo(0, 0, cardWidth, cardHeight);
      actor.border.setSize(cardWidth - 12, cardHeight - 12);
      const size = cardHeight/300;
      actor.slot.setPosition(0, -cardHeight / 2 - (this.compact?9:0)).setFontSize(this.compact?10:22*size).setDepth(3);
      actor.role.setPosition(0, -cardHeight / 2 + 78*size).setFontSize(Math.max(12,15*size)).setVisible(!this.compact);
      actor.mark.setPosition(0, this.compact?-9:-cardHeight/2+119*size).setFontSize(this.compact?22:25*size).setAlpha(.6);
      actor.name.setPosition(0, this.compact?cardHeight*.22:-cardHeight/2+46*size).setFontSize(this.compact?11:Math.max(20,25*size)).setFontFamily('"Noto Serif CJK SC", "Songti SC", serif');
      actor.subtitle.setPosition(0, cardHeight / 2 - 54*size).setFontSize(12*size).setVisible(!this.compact);
      actor.hp.setPosition(0, this.compact?cardHeight/2+11:-cardHeight/2+155*size).setFontSize(this.compact?10:Math.max(10,13*size));
      actor.mana.setPosition(0, this.compact?cardHeight/2+26:-cardHeight/2+191*size).setFontSize(this.compact?10:Math.max(10,13*size));
      actor.target.setPosition(0,this.compact?height-7-y:cardHeight/2-22*size).setFontSize(this.compact?9:17*size);
      actor.shield.setPosition(0, this.compact?height-7-y:-cardHeight/2+126*size).setFontSize(this.compact?10:12*size);
    }
    const g = this.background.clear();
    if(!this.compact){
      g.fillStyle(0x040a10,.18).fillRect(0,0,width,height);
      const badgeWidth=Math.min(210,width*.12),badgeHeight=48;
      for(const [x,color] of [[18,0x3aabb4],[width-badgeWidth-18,0xb65359]]){
        g.fillStyle(0x06141b,.86).fillRect(x,18,badgeWidth,badgeHeight);
        g.lineStyle(1,color,.85).strokeRect(x,18,badgeWidth,badgeHeight);
        g.lineStyle(3,color,.6).lineBetween(x+12,66,x+badgeWidth-12,66);
      }
    }
    this.labels[0].setPosition(18+Math.min(210,width*.12)/2,42).setFontSize(Math.min(30,width/65)).setVisible(!this.compact);
    this.labels[1].setPosition(width-18-Math.min(210,width*.12)/2,42).setFontSize(Math.min(30,width/65)).setVisible(!this.compact);
    this.labels[2].setPosition(width / 2, this.compact?y-12:48).setFontSize(this.compact?28:42);
    this.labels[3].setPosition(width / 2, 87).setVisible(!this.compact);
    this.hoverLabel.setPosition(width / 2, height - 14).setFontSize(13).setVisible(!this.compact);
    this.owner.host.dataset.actors=JSON.stringify(this.actors.map(a=>({side:a.side,index:a.index,x:a.root.x,y:a.root.y,width:a.width,height:a.height})));
    this.refreshActors();
  }

  private unit(actor: Actor): UnitView | undefined {
    return actor.side === 'hero' ? this.owner.battle.party[actor.index] : this.owner.battle.enemies[actor.index];
  }

  private refreshActors() {
    let hover = '';
    for(const [id,flash] of this.flashes)if(this.owner.battle.tick-flash.tick>8)this.flashes.delete(id);
    for (const actor of this.actors) {
      const unit = this.unit(actor), dead = !unit || unit.hp <= 0;
      const color = actor.side==='hero'?0x409da6:0xb25057;
      const selected = !!unit && actor.index === (actor.side==='hero'?this.owner.options.selected():this.owner.options.selectedEnemy?.());
      actor.box.setFillStyle(dead ? 0x060c12 : selected ? 0x252116 : actor.side==='hero'?0x071c24:0x211013, dead ? .65 : .95);
      actor.box.setStrokeStyle(selected || actor.hovered ? 2 : 1, selected ? COLORS.gold : actor.hovered ? 0xc8d4b5 : color, dead ? .3 : .65);
      const flash=unit&&this.flashes.get(unit.id);
      if(flash&&!dead)actor.box.setStrokeStyle(3,flash.color,1);
      actor.border.setStrokeStyle(1, selected ? COLORS.gold : color, .55);
      this.drawFrame(actor,selected,dead);
      actor.mark.setText(!unit ? '+' : dead ? '·' : unit.def?.mark || (unit.boss ? '王' : '怪')).setColor(Phaser.Display.Color.IntegerToColor(color).rgba).setAlpha(dead ? 0 : .65);
      actor.role.setVisible(!this.compact&&!dead).setText(unit ? unit.def?.role || (unit.boss ? '首领' : '敌方单位') : '队伍空位');
      const name = !unit ? '等待同伴' : !dead ? unit.name : actor.side === 'hero' ? '已阵亡' : this.owner.battle.phase === 'cleanup' ? '已清除' : '空位';
      actor.name.setText(name).setColor(selected?'#ffe6ae':'#f1e6d2').setAlpha(dead ? .65 : 1);
      if(!this.compact)actor.name.setY(dead?-actor.height*.08:-actor.height/2+46*actor.height/300);
      const subtitle = !unit ? '前四层招募' : dead && actor.side === 'enemy' ? this.owner.battle.phase === 'cleanup' ? '停止补位' : `${Math.max(0, ((this.owner.battle.nextSpawn || 0) - this.owner.battle.tick) * .02).toFixed(1)}s` : actor.side === 'hero' ? `Lv.${this.owner.battle.run.level}` : unit.boss ? '只出现一次' : unit.challenge?'额外挑战':'按推荐位置补怪';
      const activeStatuses = [...(unit?.statuses?.values() || [])];
      const stateText = unit?.casting ? `${unit.casting.skill.name} · ${Math.max(0, (unit.casting.end - this.owner.battle.tick) * .02).toFixed(1)}s` : activeStatuses.slice(0, 2).map(s => `${s.definition.name}${s.stacks > 1 ? `×${s.stacks}` : ''}`).join(' · ');
      actor.subtitle.setText(!dead && stateText ? stateText : subtitle);
      if(!this.compact)actor.subtitle.setY(dead?actor.height*.1:actor.height/2-54*actor.height/300);
      const size=actor.height/300;
      const g = actor.bars.clear(), left = -actor.width / 2+(this.compact?0:12), barWidth=actor.width-(this.compact?0:24), top = this.compact?actor.height/2+5:-actor.height/2+166*size, barHeight=this.compact?12:10*size, rowStep=this.compact?15:36*size;
      const target=unit?.targetId?[...this.owner.battle.party,...this.owner.battle.enemies].find(u=>u.id===unit.targetId&&u.hp>0):null;
      actor.target.setText(!dead&&(!this.compact||actor.side==='hero')?`目标 ${target?target.slot+1:'—'}`:'');
      actor.mark.setVisible(this.compact||!(unit&&unit.shield>0));
      actor.hp.setVisible(!!unit && !dead); actor.mana.setVisible(!!unit && !dead); actor.shield.setVisible(!!unit && !dead && (!this.compact||actor.side==='enemy'));
      if (!unit || dead) continue;
      g.fillStyle(0x050a10).fillRoundedRect(left, top, barWidth, barHeight, 2).fillRoundedRect(left, top + rowStep, barWidth, barHeight, 2);
      g.fillStyle(0x27c88c).fillRect(left, top, barWidth * Phaser.Math.Clamp(unit.hp / unit.stats.hp, 0, 1), barHeight);
      if (unit.shield > 0) g.fillStyle(0xb7c7d3, .45).fillRect(left, top, barWidth * Math.min(1, unit.shield / unit.stats.hp), 4);
      g.fillStyle(0x369dd4).fillRect(left, top + rowStep, barWidth * Phaser.Math.Clamp(unit.mana / Math.max(1, unit.stats.mana), 0, 1), barHeight);
      g.fillStyle(0x18333a).fillRect(left, top + rowStep + (this.compact?15:24*size), barWidth, 4);
      const progress = unit.attack ? Phaser.Math.Clamp((this.owner.battle.tick - unit.attack.start) / (unit.attack.end - unit.attack.start), 0, 1) : 0;
      g.fillStyle(COLORS.gold).fillRect(left, top + rowStep + (this.compact?15:24*size), barWidth * progress, 4);
      if (unit.casting) {
        const castProgress = Phaser.Math.Clamp((this.owner.battle.tick - unit.casting.start) / (unit.casting.end - unit.casting.start), 0, 1);
        g.fillStyle(0x18333a).fillRect(left, top + rowStep + (this.compact?20:30*size), barWidth, 3);
        g.fillStyle(COLORS.blue).fillRect(left, top + rowStep + (this.compact?20:30*size), barWidth * castProgress, 3);
      }
      this.setText(actor.hp, this.compact?`${this.shortNumber(unit.hp)}/${this.shortNumber(unit.stats.hp)}`:`${Math.ceil(unit.hp)}/${Math.round(unit.stats.hp)}  +${Number(unit.stats.hpRegen.toFixed(1))}/s`);
      this.setText(actor.mana, this.compact?`${this.shortNumber(unit.mana)}/${this.shortNumber(unit.stats.mana)}`:`${Math.floor(unit.mana)}/${Math.round(unit.stats.mana)}  +${Number(unit.stats.manaRegen.toFixed(1))}/s`);
      this.setText(actor.shield, unit.shield > 0 ? `盾 ${this.shortNumber(unit.shield)}` : '');
      if (actor.hovered) hover = `${unit.name}  ·  生命 ${Math.ceil(unit.hp)}/${Math.round(unit.stats.hp)}  ·  ${actor.side === 'hero' ? '点击选中角色' : unit.boss ? '首领' : '敌方单位'}`;
    }
    if (this.hoverLabel) this.setText(this.hoverLabel, hover);
  }

  private drawFrame(actor:Actor,selected:boolean,dead:boolean){
    const key=`${selected}:${dead}:${actor.hovered}:${this.compact}`;
    if(actor.frameKey===key)return;actor.frameKey=key;
    const g=actor.frame.clear();if(this.compact)return;
    const w=actor.width/2,h=actor.height/2,c=selected?COLORS.gold:dead?0x70777b:actor.side==='hero'?0x409da6:0xb25057;
    g.lineStyle(selected?3:2,c,dead?.35:.95);
    g.strokePoints([{x:-w+12,y:-h},{x:-w+12,y:-h+6},{x:-w,y:-h+12},{x:-w,y:h-12},{x:-w+12,y:h},{x:w-12,y:h},{x:w,y:h-12},{x:w,y:-h+12},{x:w-12,y:-h+6},{x:w-12,y:-h},{x:-w+12,y:-h}],false);
    for(const dx of [-1,1])for(const dy of [-1,1]){
      g.lineStyle(1,c,.8).lineBetween(dx*(w-6),dy*(h-25),dx*(w-6),dy*(h-12));
      g.lineBetween(dx*(w-6),dy*(h-12),dx*(w-25),dy*(h-6));
    }
    const d=Math.min(25,actor.width*.15);
    g.fillStyle(selected?0x3a2b12:0x07141c,1).fillPoints([{x:0,y:-h-d},{x:d,y:-h},{x:0,y:-h+d},{x:-d,y:-h}],true);
    g.lineStyle(2,c).strokePoints([{x:0,y:-h-d},{x:d,y:-h},{x:0,y:-h+d},{x:-d,y:-h}],true);
    if(!dead){
      const size=actor.height/300;
      g.lineStyle(1,c,.75).strokeRect(-w+12,h-36*size,actor.width-24,27*size);
      g.lineStyle(1,c,.35).lineBetween(-w+12,-h+94*size,w-12,-h+94*size);
    }
  }

  private shortNumber(value: number) {return value>=10000?`${Number((value/10000).toFixed(1))}万`:value>=1000?`${Number((value/1000).toFixed(1))}k`:String(Math.ceil(value));}

  private setText(label: Phaser.GameObjects.Text, text: string) {
    if (label.text !== text) label.setText(text);
  }

  private refreshProjectiles(motion: boolean) {
    this.trails.clear();
    const battle = this.owner.battle;
    const selectedUnit=battle.party[this.owner.options.selected()];
    const selected=selectedUnit?.id;
    const target=battle.enemies.find(u=>u.id===selectedUnit?.targetId&&u.hp>0);
    if(target&&selectedUnit&&selectedUnit.hp>0){
      const from=this.actors[selectedUnit.slot],to=this.actors[5+target.slot];
      const sx=from.root.x,ex=to.root.x,base=from.root.y-from.height/2-30, rise=this.compact?8:38;
      this.trails.lineStyle(this.compact?1:2,COLORS.gold,.9);
      for(let i=0;i<32;i+=2){const a=i/32,b=(i+1)/32;this.trails.lineBetween(sx+(ex-sx)*a,base-Math.sin(a*Math.PI)*rise,sx+(ex-sx)*b,base-Math.sin(b*Math.PI)*rise);}
      this.trails.lineBetween(ex,base,ex-10,base-10).lineBetween(ex,base,ex-13,base+3);
    }
    for(const shot of battle.shots){if(shot.id>this.launched&&shot.start>=battle.tick-5)this.flashes.set(shot.source,{tick:shot.start,color:shot.skill?COLORS.blue:0xe6dfca});this.launched=Math.max(this.launched,shot.id);}
    const shots = motion ? [...battle.shots].sort((a,b)=>Number(b.source===selected)-Number(a.source===selected)||b.id-a.id).slice(0,LIMITS.projectiles) : [];
    for (let n = 0; n < this.projectiles.length; n++) {
      const sprite = this.projectiles[n], shot = shots[n];
      if (!shot) { sprite.dot.setVisible(false); sprite.glow.setVisible(false); continue; }
      const from = this.actors[(shot.side === 'hero' ? 0 : 5) + shot.sourceSlot];
      const to = this.actors[(shot.side === 'hero' ? 5 : 0) + shot.targetSlot];
      const target = this.unit(to);
      if (!target || target.id !== shot.target || target.hp <= 0) { sprite.dot.setVisible(false); sprite.glow.setVisible(false); continue; }
      const t = Phaser.Math.Clamp((battle.tick - shot.start) / (shot.end - shot.start), 0, 1);
      const x = Phaser.Math.Linear(from.root.x, to.root.x, t);
      const y = Phaser.Math.Linear(from.root.y, to.root.y, t) - Math.sin(t * Math.PI) * (this.compact ? (shot.skill?28:12) : shot.skill ? 70 : 25);
      const tint = shot.skill ? 0x77d6ea : 0xe6dfca;
      if(shot.source===selected&&t>.8)this.flashes.set(shot.target,{tick:battle.tick,color:tint});
      sprite.dot.setVisible(true).setAlpha(shot.source===selected?1:.55).setPosition(x, y).setTint(tint).setDisplaySize(shot.skill ? 9 : 5, shot.skill ? 9 : 5);
      sprite.glow.setVisible(true).setPosition(x, y).setTint(tint).setDisplaySize(shot.skill ? 28 : 16, shot.skill ? 28 : 16);
      this.trails.lineStyle(shot.skill ? 2 : 1, tint, shot.source===selected?.9:.3).lineBetween(x - (to.root.x - from.root.x) * .025, y + 2, x, y);
    }
  }

  private showEvent(event: EffectEvent, emitParticles: boolean) {
    if(this.owner.battle.tick-event.tick>35)return;
    const actor = this.actors[(event.side === 'hero' ? 0 : 5) + event.slot];
    if (!actor || this.unit(actor)?.id !== event.target) return;
    const x = actor.root.x, y = actor.root.y;
    if (event.type === 'spawn') {
      if (emitParticles) this.bursts.spawn.explode(12, x, y);
      return;
    }
    if (event.type === 'death') return;
    const selected=this.owner.battle.party[this.owner.options.selected()]?.id;
    this.feedback.add(event,selected,this.compact?12:24);
    const color=event.type==='heal'?COLORS.green:event.type==='shield'||(event.shieldLoss||0)>0?COLORS.blue:event.crit?COLORS.gold:event.origin==='skill'?0x77d6ea:0xe6dfca;
    this.flashes.set(event.target,{tick:event.tick,color});
    if(event.source&&event.source!==event.target&&event.origin!=='attack')this.flashes.set(event.source,{tick:event.tick,color});
    if (emitParticles && event.type !== 'dodge') {
      const kind=event.type==='damage'&&(event.shieldLoss||0)>0?'shield':event.type;
      this.bursts[kind].explode(event.crit ? 14 : 7, x, y - 8);
    }
  }

  private refreshEffects(motion: boolean) {
    let bursts = 0;
    const tick=this.owner.battle.tick,valid=new Set([...this.owner.battle.party,...this.owner.battle.enemies].map(u=>u.id));
    this.feedback.expire(tick,valid);
    for (const event of this.owner.battle.effects) {
      if (event.id <= this.lastEvent) continue;
      this.lastEvent = event.id;
      this.showEvent(event, motion && bursts++ < LIMITS.burstsPerFrame);
    }
    this.feedback.trim(this.compact?12:24);
    this.feedback.groups.forEach((group,index)=>{
      const popup=this.popups[index],actor=this.actors[(group.side==='hero'?0:5)+group.slot];
      const style=feedbackStyle(group),age=(tick-group.born)*20;
      popup.active=true;popup.born=group.born;popup.x=actor.root.x;popup.y=actor.root.y-actor.height/2+(this.compact?20:-34)+group.lane*(this.compact?16:-24);
      popup.text.setText(style.text).setColor(style.color).setFontSize(this.compact?11:group.crit?19:14).setStroke('#172015',3).setVisible(true).setPosition(popup.x,popup.y-(motion?age/35:0)).setAlpha(1-age/900);
    });
    for(let index=this.feedback.groups.length;index<this.popups.length;index++){this.popups[index].active=false;this.popups[index].text.setVisible(false);}
    this.owner.host.dataset.feedback=JSON.stringify(this.feedback.groups.map(g=>({target:g.target,source:g.source,kind:g.kind,healingKind:g.healingKind,...feedbackStyle(g)})));
    if (!motion && this.lastMotion) Object.values(this.bursts).forEach(e => e.killAll());
    this.lastMotion = motion;
  }

  update(_time: number, delta: number) {
    if (this.owner.disposed) return;
    this.owner.options.advance(Math.min(delta, 100));
    if (this.owner.disposed) return;
    const motion = this.owner.options.motion();
    this.refreshProjectiles(motion);
    this.refreshEffects(motion);
    this.refreshActors();
    // Read-only diagnostics for reproducible browser checks, not gameplay controls.
    if (this.lastTick !== this.owner.battle.tick) {
      this.lastTick = this.owner.battle.tick;
      this.owner.host.dataset.tick = String(this.lastTick);
      this.owner.host.dataset.particles = String(Object.values(this.bursts).reduce((sum, e) => sum + e.getAliveParticleCount(), 0));
      this.owner.host.dataset.popups = String(this.popups.filter(p => p.active).length);
      this.owner.host.dataset.projectiles = String(this.projectiles.filter(p => p.dot.visible).length);
      this.owner.host.dataset.displayObjects = String(this.children.length);
    }
  }
}

export class PhaserBattleRenderer {
  readonly game: Phaser.Game;
  readonly host: HTMLElement;
  readonly battle: BattleView;
  readonly options: RendererOptions;
  disposed = false;
  private ready = false;
  private observer: ResizeObserver;
  private scene: BattleScene;

  constructor(host: HTMLElement, battle: BattleView, options: RendererOptions) {
    this.host = host; this.battle = battle; this.options = options;
    this.scene = new BattleScene(this);
    this.game = new Phaser.Game({
      type: Phaser.AUTO, parent: host, width: host.clientWidth, height: host.clientHeight,
      transparent: true, banner: false, audio: { noAudio: true },
      input: { keyboard: false },
      render: { antialias: true, roundPixels: false },
      fps: { target: 60, smoothStep: false },
      scale: { mode: Phaser.Scale.NONE },
      scene: this.scene,
    });
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
  }

  markReady() {
    this.ready = true;
    this.host.dataset.engine = 'phaser';
    this.host.dataset.renderer = this.game.renderer.type === Phaser.WEBGL ? 'webgl' : 'canvas';
    this.game.canvas.setAttribute('aria-label', '战场：双方各五个位置，点击我方角色选中');
    this.resize(); this.syncPause();
  }

  resize() {
    if (!this.ready || this.disposed) return;
    const width = this.host.clientWidth, height = this.host.clientHeight;
    if (width > 0 && height > 0 && (this.game.scale.width !== width || this.game.scale.height !== height)) this.game.scale.resize(width, height);
  }

  syncPause() {
    if (!this.ready || this.disposed) return;
    if (this.options.paused()) this.scene.scene.pause();
    else this.scene.scene.resume();
  }

  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    this.observer.disconnect();
    this.game.destroy(true, false);
  }
}
