// Effect recipes — one table per event (docs/game-feel-audit.md §5). Pure data
// and pure math: no Pixi, no sim. The orchestrator reads these, so tuning juice
// means editing numbers in one place instead of hunting through a switch.
import type { SimEventType } from "shared/protocol";
import { FIELD_H, FIELD_W } from "shared/gridConstants";

/** Which atlas frame a preset's particles use. */
export type ParticleShape = "circle" | "square" | "triangle" | "star" | "streak" | "debris" | "splat" | "ring";

/** A point in field units (the fixed 208x256 logical play field). */
export interface FieldPoint {
  x: number;
  y: number;
}

export interface BurstRecipe {
  shape: ParticleShape;
  count: number;
  /** Base speed, field units/sec. Direction is randomized per particle. */
  speed: number;
  /** Lifetime, seconds. */
  life: number;
  /** Downward acceleration, field units/sec^2. Negative floats upward. */
  gravity: number;
  /** Base size multiplier applied to the 16x16 frame. */
  scale: number;
  /** 0xRRGGBB. Frames are grayscale; this is applied via the particle tint. */
  color: number;
}

export interface FlashRecipe {
  color: number;
  /** Peak alpha, 0..1. */
  intensity: number;
  /** Duration, seconds. */
  duration: number;
}

/** Volume-conserving squash: scaleX * scaleY === 1. */
export interface SquashRecipe {
  scaleX: number;
  scaleY: number;
  /** Seconds. */
  duration: number;
}

export interface PopRecipe {
  text: string;
  color: number;
  /** 0..1 — scales the pop text with the field scale. */
  size: number;
}

export interface EffectRecipe {
  /** Screen-shake trauma, 0..1. Accumulating then decays. */
  trauma: number;
  /** Visual-only freeze frames. Never stalls the 60 Hz sim. */
  hitStopFrames: number;
  /** Which anchor the burst/squash/pop resolve against. */
  anchor: EffectAnchor;
  burst?: BurstRecipe | undefined;
  flash?: FlashRecipe | undefined;
  /** Applied to the ball sprite/gfx. */
  ballSquash?: SquashRecipe | undefined;
  /** Applied to the paddle sprite/gfx. */
  paddleSquash?: SquashRecipe | undefined;
  pop?: PopRecipe | undefined;
}

/**
 * Where an event's effect originates. Events carry no position (spec §9
 * SimEvent is `{type, source, target, tick}`), so the orchestrator resolves the
 * anchor from the snapshot instead — see `visualEffects.ts`.
 */
export type EffectAnchor = "brick" | "ball" | "paddle" | "fieldCenter" | "topCenter";

export const FIELD_CENTER: FieldPoint = { x: FIELD_W / 2, y: FIELD_H / 2 };
/** Just under the brick wall — where "something happened" pops read best. */
export const TOP_CENTER: FieldPoint = { x: FIELD_W / 2, y: FIELD_H / 3 };

/** Chain escalation thresholds (audit §5): hit counts that escalate juice. */
export const CHAIN_LEVELS = [4, 7, 10] as const;

export function chainLevel(chain: number): 1 | 2 | 3 | null {
  if (chain >= CHAIN_LEVELS[2]) return 3;
  if (chain >= CHAIN_LEVELS[1]) return 2;
  if (chain >= CHAIN_LEVELS[0]) return 1;
  return null;
}

/**
 * Every event the sim can emit. `pause`/`resume` are deliberately absent —
 * a menu transition should not make the field jump.
 */
export const EFFECT_RECIPES: Partial<Record<SimEventType, EffectRecipe>> = {
  paddleBounce: {
    trauma: 0.25,
    hitStopFrames: 2,
    anchor: "paddle",
    burst: { shape: "circle", count: 6, speed: 60, life: 0.3, gravity: 120, scale: 0.35, color: 0x88ffff },
    flash: { color: 0xffffff, intensity: 0.18, duration: 0.05 },
    ballSquash: { scaleX: 1.3, scaleY: 1 / 1.3, duration: 0.15 },
    paddleSquash: { scaleX: 0.9, scaleY: 1 / 0.9, duration: 0.15 },
  },
  brickBreak: {
    trauma: 0.3,
    hitStopFrames: 2,
    anchor: "brick",
    burst: { shape: "debris", count: 10, speed: 80, life: 0.4, gravity: 200, scale: 0.5, color: 0xffee88 },
    flash: { color: 0xffffff, intensity: 0.1, duration: 0.03 },
    ballSquash: { scaleX: 1.15, scaleY: 1 / 1.15, duration: 0.1 },
    pop: { text: "+50", color: 0xffee88, size: 1 },
  },
  brickSilverHit: {
    trauma: 0.08,
    hitStopFrames: 0,
    anchor: "brick",
    burst: { shape: "square", count: 4, speed: 50, life: 0.25, gravity: 150, scale: 0.4, color: 0xaaaaaa },
    flash: { color: 0xffffff, intensity: 0.06, duration: 0.03 },
    ballSquash: { scaleX: 1.1, scaleY: 1 / 1.1, duration: 0.1 },
    pop: { text: "+10", color: 0xcccccc, size: 0.85 },
  },
  ballLaunch: {
    trauma: 0.2,
    hitStopFrames: 0,
    anchor: "ball",
    burst: { shape: "streak", count: 8, speed: 40, life: 0.25, gravity: 0, scale: 0.6, color: 0xffffff },
    ballSquash: { scaleX: 0.7, scaleY: 1 / 0.7, duration: 0.18 },
    paddleSquash: { scaleX: 1.1, scaleY: 1 / 1.1, duration: 0.18 },
  },
  ballLoss: {
    trauma: 0.7,
    hitStopFrames: 6,
    anchor: "ball",
    burst: { shape: "splat", count: 20, speed: 120, life: 0.6, gravity: 300, scale: 0.8, color: 0xff4444 },
    flash: { color: 0xff2222, intensity: 0.32, duration: 0.1 },
    ballSquash: { scaleX: 1.5, scaleY: 1 / 1.5, duration: 0.3 },
    pop: { text: "-1", color: 0xff6666, size: 1.1 },
  },
  capsuleCatch: {
    trauma: 0.2,
    hitStopFrames: 2,
    anchor: "paddle",
    burst: { shape: "star", count: 12, speed: 100, life: 0.5, gravity: -40, scale: 0.5, color: 0x44ff88 },
    flash: { color: 0x44ff88, intensity: 0.22, duration: 0.08 },
    paddleSquash: { scaleX: 1.1, scaleY: 1 / 1.1, duration: 0.15 },
    pop: { text: "CAPSULE", color: 0x44ff88, size: 1 },
  },
  /**
   * Classic "D" multiball spawns faster balls (ticket #97). Reads as an
   * acceleration rather than a pickup: streaks out from the ball, a longer
   * freeze on the split, and the speed is the announcement.
   */
  multiballBoost: {
    trauma: 0.35,
    hitStopFrames: 3,
    anchor: "ball",
    burst: { shape: "streak", count: 18, speed: 150, life: 0.45, gravity: 0, scale: 0.55, color: 0x88ccff },
    flash: { color: 0x88ccff, intensity: 0.2, duration: 0.08 },
    ballSquash: { scaleX: 1.35, scaleY: 1 / 1.35, duration: 0.2 },
    pop: { text: "BOOST", color: 0x88ccff, size: 1.1 },
  },
  roundClear: {
    trauma: 0.8,
    hitStopFrames: 8,
    anchor: "fieldCenter",
    burst: { shape: "star", count: 40, speed: 150, life: 1, gravity: -50, scale: 0.7, color: 0xffff44 },
    flash: { color: 0xffff44, intensity: 0.3, duration: 0.15 },
    pop: { text: "CLEAR", color: 0xffff44, size: 1.6 },
  },
  gameOver: {
    trauma: 1,
    hitStopFrames: 0,
    anchor: "fieldCenter",
    burst: { shape: "circle", count: 24, speed: 60, life: 0.8, gravity: -20, scale: 0.5, color: 0x8888ff },
    flash: { color: 0x000000, intensity: 0.35, duration: 0.4 },
    pop: { text: "GAME OVER", color: 0xff4444, size: 1.5 },
  },
  bossHit: {
    trauma: 0.3,
    hitStopFrames: 3,
    anchor: "ball",
    burst: { shape: "circle", count: 15, speed: 100, life: 0.5, gravity: 180, scale: 0.55, color: 0xff8844 },
    flash: { color: 0xffffff, intensity: 0.16, duration: 0.05 },
    ballSquash: { scaleX: 1.2, scaleY: 1 / 1.2, duration: 0.12 },
  },
  bossDead: {
    trauma: 1,
    hitStopFrames: 12,
    anchor: "fieldCenter",
    burst: { shape: "ring", count: 50, speed: 170, life: 1.1, gravity: -30, scale: 0.9, color: 0xffaa22 },
    flash: { color: 0xffffff, intensity: 0.5, duration: 0.2 },
    pop: { text: "BOSS CLEAR", color: 0xffaa22, size: 1.6 },
  },
  attack: {
    trauma: 0.6,
    hitStopFrames: 0,
    anchor: "topCenter",
    flash: { color: 0xff2222, intensity: 0.28, duration: 0.2 },
    pop: { text: "ATTACK", color: 0xff4444, size: 1.4 },
  },
  assist: {
    trauma: 0.5,
    hitStopFrames: 0,
    anchor: "topCenter",
    flash: { color: 0x4488ff, intensity: 0.28, duration: 0.2 },
    pop: { text: "ASSIST", color: 0x66aaff, size: 1.4 },
  },
};

/**
 * Chain escalation recipes, indexed by level. The sim has no `chainEscalate`
 * event — the orchestrator counts consecutive `brickBreak`s and picks a tier
 * (the audio layer does the same counting for its SFX).
 */
export const CHAIN_RECIPES: Record<1 | 2 | 3, EffectRecipe> = {
  1: {
    trauma: 0.3,
    hitStopFrames: 0,
    anchor: "ball",
    burst: { shape: "star", count: 8, speed: 80, life: 0.4, gravity: -20, scale: 0.45, color: 0xff44ff },
    flash: { color: 0xff44ff, intensity: 0.16, duration: 0.1 },
    pop: { text: "x2", color: 0xff44ff, size: 1 },
  },
  2: {
    trauma: 0.5,
    hitStopFrames: 0,
    anchor: "ball",
    burst: { shape: "star", count: 12, speed: 110, life: 0.5, gravity: -20, scale: 0.55, color: 0xff44ff },
    flash: { color: 0xff44ff, intensity: 0.24, duration: 0.12 },
    pop: { text: "x3", color: 0xff88ff, size: 1.2 },
  },
  3: {
    trauma: 0.7,
    hitStopFrames: 0,
    anchor: "ball",
    burst: { shape: "star", count: 16, speed: 140, life: 0.6, gravity: -20, scale: 0.65, color: 0xff44ff },
    flash: { color: 0xff44ff, intensity: 0.32, duration: 0.15 },
    pop: { text: "x4", color: 0xffaaff, size: 1.4 },
  },
};

/**
 * Reduced-effects scaling (audit §8). Particles/flash/shake are decorative and
 * drop out entirely; hit-stop and squash survive because they carry gameplay
 * readability (impact timing, paddle contact).
 */
export interface ReducedEffectsScale {
  /** Decorative channels are dropped, not dimmed. */
  allowParticles: boolean;
  allowFlash: boolean;
  allowShake: boolean;
  /** Hit-stop frames are halved rather than removed. */
  hitStopFactor: number;
}

export const FULL_EFFECTS: ReducedEffectsScale = {
  allowParticles: true,
  allowFlash: true,
  allowShake: true,
  hitStopFactor: 1,
};

export const REDUCED_EFFECTS: ReducedEffectsScale = {
  allowParticles: false,
  allowFlash: false,
  allowShake: false,
  hitStopFactor: 0.5,
};
