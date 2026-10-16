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
  mark: Phaser.GameObjects.Text;
  name: Phaser.GameObjects.Text;
  role: Phaser.GameObjects.Text;
  subtitle: Phaser.GameObjects.Text;
  slot: Phaser.GameObjects.Text;
  bars: Phaser.GameObjects.Graphics;
  hp: Phaser.GameObjects.Text;
  mana: Phaser.GameObjects.Text;
  shield: Phaser.GameObjects.Text;
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
      this.label('我方后排    →    前排', 12, '#a8bb91'),
      this.label('前排    ←    敌方后排', 12, '#c49b8c'),
      this.label('×', 34, '#718057'),
      this.label('自动战斗', 10, '#829071'),
    ];
    this.hoverLabel = this.label('', 11, '#c6d2b8').setDepth(10);
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this));
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
      root, box, border, side, index, width: 100, height: 150, hovered: false,
      mark: this.label('', 42, '#b4c49f'), name: this.label('', 17),
      role: this.label('', 10, COLORS.muted), subtitle: this.label('', 9, COLORS.muted),
      slot: this.label(String(index + 1), 12, '#acb697'), bars: this.add.graphics(),
      hp: this.label('', 10), mana: this.label('', 10), shield: this.label('', 9, '#c4d8e0'),
    };
    root.add([box, border, actor.mark, actor.role, actor.name, actor.subtitle, actor.slot, actor.bars, actor.hp, actor.mana, actor.shield]);
    box.setInteractive({ useHandCursor: side === 'hero' });
    box.on('pointerover', () => { actor.hovered = true; this.refreshActors(); });
    box.on('pointerout', () => { actor.hovered = false; this.refreshActors(); });
    box.on('pointerdown', () => {
      if (side === 'hero' && this.owner.battle.party[index] && !this.owner.options.paused()) this.owner.options.select(index);
    });
    return actor;
  }

  private layout() {
    const { width, height } = this.scale;
    const teamWidth = width * (this.compact ? .47 : .435);
    const cell = teamWidth / 5;
    const cardWidth = this.compact ? cell - 5 : Math.max(50, cell - Math.max(10, width * .009));
    const cardHeight = this.compact ? Math.max(55,height - 91) : Phaser.Math.Clamp(height * .57, 140, 310);
    // Keep resource bars close to the squad panel instead of reserving a large floor gap.
    const y = this.compact ? cardHeight / 2 + 23 : Math.max(cardHeight / 2 + 60, height - cardHeight / 2 - 100);
    for (const actor of this.actors) {
      const position = actor.side === 'hero' ? 4 - actor.index : actor.index;
      const x = actor.side === 'hero' ? cell * (position + .5) + (this.compact?2:10) : width - teamWidth - (this.compact?2:10) + cell * (position + .5);
      actor.width = cardWidth;
      actor.height = cardHeight;
      actor.root.setPosition(x, y);
      actor.box.setSize(cardWidth, cardHeight);
      if (actor.box.input) actor.box.input.hitArea.setTo(0, 0, cardWidth, cardHeight);
      actor.border.setSize(cardWidth - 12, cardHeight - 12);
      actor.slot.setPosition(0, -cardHeight / 2 - (this.compact?9:18)).setFontSize(this.compact?10:12);
      actor.role.setPosition(0, -cardHeight / 2 + 20).setVisible(!this.compact);
      actor.mark.setPosition(0, this.compact?-9:-14).setFontSize(this.compact?22:Math.max(26, cardWidth * .35));
      actor.name.setPosition(0, cardHeight * .22).setFontSize(this.compact?11:cardWidth < 90 ? 13 : 17);
      actor.subtitle.setPosition(0, cardHeight / 2 - 17).setVisible(!this.compact);
      actor.hp.setPosition(0, cardHeight / 2 + 16).setFontSize(this.compact ? 10 : cardWidth < 110 ? 8 : 10);
      actor.mana.setPosition(0, cardHeight / 2 + 36).setFontSize(this.compact ? 10 : cardWidth < 110 ? 8 : 10);
      actor.shield.setPosition(0, cardHeight / 2 + (this.compact?58:64)).setFontSize(this.compact?10:9);
    }
    const ground = this.compact?height-3:y + cardHeight / 2 + 79;
    const g = this.background.clear();
    g.fillStyle(0x1b211b, .7).fillRect(0, ground, width, height - ground);
    // Geometric scenery is deliberately neutral; hero art remains text placeholders.
    for (let n = 0; n < 13; n++) {
      const x = width * n / 12;
      g.fillStyle(0x2b3427, .25).fillRect(x - 11, ground - 100 - n % 3 * 25, 22, 100 + n % 3 * 25);
    }
    g.lineStyle(1, 0x65724d, .35).lineBetween(0, ground, width, ground);
    for (let n = -5; n <= 5; n++) {
      g.lineStyle(1, 0x596744, .1).lineBetween(width / 2 + n * 65, ground, width / 2 + n * 150, height);
    }
    for (const actor of this.actors) g.fillStyle(0x0d140c, .35).fillEllipse(actor.root.x, ground - 4, cardWidth + 12, 12);
    this.labels[0].setPosition(teamWidth / 2, 25).setVisible(!this.compact);
    this.labels[1].setPosition(width - teamWidth / 2, 25).setVisible(!this.compact);
    this.labels[2].setPosition(width / 2, y - 12);
    this.labels[3].setPosition(width / 2, y + 24).setVisible(!this.compact);
    this.hoverLabel.setPosition(width / 2, height - 14).setVisible(!this.compact);
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
      const color = unit?.def?.color ? Phaser.Display.Color.HexStringToColor(unit.def.color).color : 0xbc8777;
      const selected = actor.side === 'hero' && !!unit && actor.index === this.owner.options.selected();
      actor.box.setFillStyle(dead ? 0x1b211a : selected ? 0x393925 : 0x252c22, dead ? .55 : 1);
      actor.box.setStrokeStyle(selected || actor.hovered ? 2 : 1, selected ? COLORS.gold : actor.hovered ? 0xc8d4b5 : color, dead ? .3 : .65);
      const flash=unit&&this.flashes.get(unit.id);
      if(flash&&!dead)actor.box.setStrokeStyle(3,flash.color,1);
      actor.border.setStrokeStyle(1, selected ? COLORS.gold : color, .15);
      actor.mark.setText(!unit ? '+' : dead ? '·' : unit.def?.mark || (unit.boss ? '王' : '怪')).setColor(Phaser.Display.Color.IntegerToColor(color).rgba).setAlpha(dead ? .35 : 1);
      actor.role.setText(unit ? unit.def?.role || (unit.boss ? '首领' : '敌方单位') : '队伍空位');
      const name = !unit ? '等待同伴' : !dead ? unit.name : actor.side === 'hero' ? '已阵亡' : this.owner.battle.phase === 'cleanup' ? '已清除' : '补位中';
      actor.name.setText(name).setAlpha(dead ? .5 : 1);
      const subtitle = !unit ? '前四层招募' : dead && actor.side === 'enemy' ? this.owner.battle.phase === 'cleanup' ? '停止补位' : `${Math.max(0, ((unit.respawnAt || 0) - this.owner.battle.tick) * .02).toFixed(1)}s` : actor.side === 'hero' ? `Lv.${this.owner.battle.run.level}` : unit.boss ? '只出现一次' : '击败后 2s 补位';
      const activeStatuses = [...(unit?.statuses?.values() || [])];
      const stateText = unit?.casting ? `${unit.casting.skill.name} · ${Math.max(0, (unit.casting.end - this.owner.battle.tick) * .02).toFixed(1)}s` : activeStatuses.slice(0, 2).map(s => `${s.definition.name}${s.stacks > 1 ? `×${s.stacks}` : ''}`).join(' · ');
      actor.subtitle.setText(!dead && stateText ? stateText : subtitle);
      const g = actor.bars.clear(), left = -actor.width / 2, top = actor.height / 2 + 8;
      actor.hp.setVisible(!!unit && !dead); actor.mana.setVisible(!!unit && !dead); actor.shield.setVisible(!!unit && !dead);
      if (!unit || dead) continue;
      g.fillStyle(0x151d13).fillRoundedRect(left, top, actor.width, 16, 2).fillRoundedRect(left, top + 20, actor.width, 16, 2);
      g.fillStyle(0x668a4e).fillRect(left, top, actor.width * Phaser.Math.Clamp(unit.hp / unit.stats.hp, 0, 1), 16);
      if (unit.shield > 0) g.fillStyle(0xb7c7d3, .45).fillRect(left, top, actor.width * Math.min(1, unit.shield / unit.stats.hp), 4);
      g.fillStyle(0x3f7892).fillRect(left, top + 20, actor.width * Phaser.Math.Clamp(unit.mana / Math.max(1, unit.stats.mana), 0, 1), 16);
      g.fillStyle(0x39432a).fillRect(left, top + 42, actor.width, 4);
      const progress = unit.attack ? Phaser.Math.Clamp((this.owner.battle.tick - unit.attack.start) / (unit.attack.end - unit.attack.start), 0, 1) : 0;
      g.fillStyle(COLORS.gold).fillRect(left, top + 42, actor.width * progress, 4);
      if (unit.casting) {
        const castProgress = Phaser.Math.Clamp((this.owner.battle.tick - unit.casting.start) / (unit.casting.end - unit.casting.start), 0, 1);
        g.fillStyle(0x39432a).fillRect(left, top + 49, actor.width, 3);
        g.fillStyle(COLORS.blue).fillRect(left, top + 49, actor.width * castProgress, 3);
      }
      this.setText(actor.hp, this.compact?`${this.shortNumber(unit.hp)}/${this.shortNumber(unit.stats.hp)}`:`${Math.ceil(unit.hp)}/${Math.round(unit.stats.hp)}  +${Number(unit.stats.hpRegen.toFixed(1))}/s`);
      this.setText(actor.mana, this.compact?`${this.shortNumber(unit.mana)}/${this.shortNumber(unit.stats.mana)}`:`${Math.floor(unit.mana)}/${Math.round(unit.stats.mana)}  +${Number(unit.stats.manaRegen.toFixed(1))}/s`);
      this.setText(actor.shield, unit.shield > 0 ? `盾 ${this.shortNumber(unit.shield)}` : '');
      if (actor.hovered) hover = `${unit.name}  ·  生命 ${Math.ceil(unit.hp)}/${Math.round(unit.stats.hp)}  ·  ${actor.side === 'hero' ? '点击选中角色' : unit.boss ? '首领' : '敌方单位'}`;
    }
    if (this.hoverLabel) this.setText(this.hoverLabel, hover);
  }

  private shortNumber(value: number) {return value>=10000?`${Number((value/10000).toFixed(1))}万`:value>=1000?`${Number((value/1000).toFixed(1))}k`:String(Math.ceil(value));}

  private setText(label: Phaser.GameObjects.Text, text: string) {
    if (label.text !== text) label.setText(text);
  }

  private refreshProjectiles(motion: boolean) {
    this.trails.clear();
    const battle = this.owner.battle;
    const selected=battle.party[this.owner.options.selected()]?.id;
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
      popup.active=true;popup.born=group.born;popup.x=actor.root.x;popup.y=actor.root.y-actor.height/2+(this.compact?20:40)+group.lane*(this.compact?16:22);
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
