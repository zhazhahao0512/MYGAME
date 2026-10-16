/** Read-only boundary: presentation can inspect combat, but cannot settle damage. */
export type Side = 'hero' | 'enemy';
export type EffectKind = 'damage' | 'heal' | 'shield' | 'dodge' | 'death' | 'spawn';

export interface UnitView {
  readonly id: string;
  readonly side: Side;
  readonly slot: number;
  readonly name: string;
  readonly hp: number;
  readonly mana: number;
  readonly shield: number;
  readonly boss?: boolean;
  readonly respawnAt?: number;
  readonly attack: { readonly start: number; readonly end: number } | null;
  readonly casting?: { readonly start: number; readonly end: number; readonly skill: { readonly name: string } } | null;
  readonly statuses?: ReadonlyMap<string, { readonly stacks: number; readonly expiresAt: number; readonly definition: { readonly name: string } }>;
  readonly stats: { readonly hp: number; readonly mana: number; readonly hpRegen: number; readonly manaRegen: number };
  readonly def?: { readonly name: string; readonly color: string; readonly role: string; readonly mark: string };
}

export interface ShotView {
  readonly id: number;
  readonly source: string;
  readonly target: string;
  readonly side: Side;
  readonly sourceSlot: number;
  readonly targetSlot: number;
  readonly start: number;
  readonly end: number;
  readonly skill: boolean;
}

export interface EffectEvent {
  readonly id: number;
  readonly tick: number;
  readonly type: EffectKind;
  readonly target: string;
  readonly side: Side;
  readonly slot: number;
  readonly amount: number;
  readonly crit: boolean;
}

export interface BattleView {
  readonly tick: number;
  readonly phase: string;
  readonly party: readonly UnitView[];
  readonly enemies: readonly UnitView[];
  readonly shots: readonly ShotView[];
  readonly effects: readonly EffectEvent[];
  readonly run: { readonly level: number };
}

export interface RendererOptions {
  /** The engine owns the display clock; this callback owns advancing the fixed-step simulation. */
  advance: (deltaMs: number) => void;
  selected: () => number;
  select: (slot: number) => void;
  motion: () => boolean;
  paused: () => boolean;
}
