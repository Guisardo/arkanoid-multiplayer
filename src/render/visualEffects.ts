// VisualEffects orchestrator (ADR 0009) — the single seam between simulation
// events and rendered pixels.
//
// Contract:
//   sim emits SimEvent → onSimEvent(event, snap) → update(dt) → applyToScene()
//
// Everything here is *local and cosmetic*: effects run on every device from the
// same event ring, and are never part of the authoritative state. The sim keeps
// its fixed 60 Hz tick regardless — hit-stop is visual-only.
//
// Events carry no position (`SimEvent` is `{type, source, target, tick}`), so
// anchors resolve against the snapshot the event arrived with. Reading the
// snapshot keeps this seam intact: render/ never imports sim/.

import type { SimEvent, Snapshot } from "shared/protocol";
import { BRICK_COLS, BRICK_H, BRICK_TOP_OFFSET, BRICK_W } from "shared/gridConstants";
import { FlashLayer } from "./flash";
import { HitStop } from "./hitStop";
import { ParticleSystem } from "./particles";
import { ScorePopManager } from "./scorePops";
import { SquashStretch } from "./squashStretch";
import { TraumaShake, type ShakeOffset } from "./traumaShake";
import {
  CHAIN_RECIPES,
  EFFECT_RECIPES,
  FIELD_CENTER,
  FULL_EFFECTS,
  REDUCED_EFFECTS,
  TOP_CENTER,
  chainLevel,
  type EffectAnchor,
  type EffectRecipe,
  type FieldPoint,
  type ReducedEffectsScale,
} from "./effectPresets";

/** Scene nodes the orchestrator drives. Supplied by FieldView. */
export interface VisualEffectsScene {
  /**
   * Shake target — FieldView's shake layer, which sits inside the scaled field
   * container, so its local coordinates are field units.
   */
  readonly shakeTarget: { x: number; y: number; rotation: number };
  /** Mount point for particles (inside the field, above gameplay layers). */
  readonly particleLayer: { addChild(child: never): unknown } | null;
  /** Mount point for score pops (inside the field, above the particles). */
  readonly popLayer: { addChild(child: never): unknown };
  /** Additive full-field flash quad. */
  readonly flashLayer: { visible: boolean; alpha: number; tint: number };
  /** Optional sprite squash targets — null in procedural-geometry mode. */
  readonly ballSprite?: { scale: { set(x: number, y: number): void } } | null;
  readonly paddleSprite?: { scale: { set(x: number, y: number): void } } | null;
}

/** Live effect state, exposed for tests and for the reduced-effects gate. */
export interface EffectsState {
  /** 0..1 accumulated shake trauma. */
  trauma: number;
  /** Visual-only freeze frames still owed. */
  hitStopFrames: number;
  /** Live shake displacement in field units. */
  shake: ShakeOffset;
  /** Peak flash alpha and its color, 0 when idle. */
  flashAlpha: number;
  flashColor: number;
  /** Live squash pairs. */
  ballScale: { x: number; y: number };
  paddleScale: { x: number; y: number };
  /** Particles currently alive and pooled. */
  particles: number;
  particlePool: number;
  /** Pops in flight, with their text. */
  pops: readonly string[];
  /** Consecutive brickBreak streak feeding chain escalation. */
  chain: number;
  reducedEffects: boolean;
}

export class VisualEffects {
  private readonly shake = new TraumaShake();
  private readonly hitStop = new HitStop();
  private readonly particles = new ParticleSystem();
  private readonly flash = new FlashLayer();
  private readonly squash = new SquashStretch();
  private readonly pops = new ScorePopManager();

  /**
   * Newest event tick already processed. The snapshot event ring repeats across
   * consecutive rendered frames (guest interpolation replays it), so the same
   * watermark trick `sessionAudio` uses is mandatory here too.
   */
  private lastEventTick = -1;
  private chain = 0;
  private scale: ReducedEffectsScale = FULL_EFFECTS;
  private reduced = false;
  private mounted = false;

  constructor(private scene: VisualEffectsScene) {
    // Nothing to mount yet — FieldView calls mount() once its layers exist.
  }

  /**
   * Live state. Read-only snapshot; safe to assert against in tests. Reads the
   * shake offset that `update()` last computed rather than recomputing it, so
   * reading state never advances the animation.
   */
  get state(): EffectsState {
    const offset = this.shake.offset;
    return {
      trauma: this.shake.traumaLevel,
      hitStopFrames: this.hitStop.pending,
      shake: { x: offset.x, y: offset.y, rotation: offset.rotation },
      flashAlpha: this.flash.currentAlpha,
      flashColor: this.flash.currentColor,
      ballScale: { x: this.squash.scaleX("ball"), y: this.squash.scaleY("ball") },
      paddleScale: { x: this.squash.scaleX("paddle"), y: this.squash.scaleY("paddle") },
      particles: this.particles.activeCount,
      particlePool: this.particles.pooledCount,
      pops: this.pops.activePops.map((p) => p.text),
      chain: this.chain,
      reducedEffects: this.reduced,
    };
  }

  /**
   * Reduced-effects mode (audit §8): drop particles, flash and shake; halve
   * hit-stop. Squash/stretch is preserved — it is a readability channel.
   */
  setReducedEffects(reduced: boolean): void {
    if (this.reduced === reduced) return;
    this.reduced = reduced;
    this.scale = reduced ? REDUCED_EFFECTS : FULL_EFFECTS;
    this.flash.setEnabled(!reduced);
    if (reduced) {
      // Clear live decorative state so toggling mid-match doesn't strand
      // particles or a stuck flash from the full-effects path.
      this.particles.reset();
      this.shake.reset();
    }
  }

  /**
   * Consume the snapshot's event ring. Call once per rendered frame with the
   * snapshot that frame will draw — the anchor positions come from it.
   */
  consume(snap: Snapshot): void {
    const fresh = snap.events.filter((e) => e.tick > this.lastEventTick);
    const newest = fresh[fresh.length - 1];
    if (newest !== undefined) this.lastEventTick = newest.tick;
    for (const event of fresh) this.onSimEvent(event, snap);
  }

  /**
   * Fire one event's recipe. Exposed directly so tests (and any future emitter)
   * can drive effects without a snapshot ring.
   */
  onSimEvent(event: SimEvent, snap: Snapshot): void {
    // Chain (CONTEXT.md): consecutive brick breaks *without the ball touching
    // the paddle* — a paddle bounce breaks it, as does a launch or a loss.
    if (event.type === "brickBreak") this.chain++;
    else if (
      event.type === "paddleBounce" ||
      event.type === "ballLaunch" ||
      event.type === "ballLoss"
    ) {
      this.chain = 0;
    }

    const recipe = EFFECT_RECIPES[event.type];
    if (recipe !== undefined) this.applyRecipe(recipe, this.anchorPoint(recipe.anchor, event, snap));

    // Chain escalation is derived, not emitted — same thresholds as the SFX.
    if (event.type === "brickBreak") {
      const level = chainLevel(this.chain);
      if (level !== null) {
        this.applyRecipe(CHAIN_RECIPES[level], this.anchorPoint("ball", event, snap));
      }
    }
  }

  /** Run a recipe: one burst of trauma, hit-stop, particles, flash, squash, pop. */
  private applyRecipe(recipe: EffectRecipe, at: FieldPoint): void {
    if (this.scale.allowShake && recipe.trauma > 0) this.shake.addTrauma(recipe.trauma);

    const frames = Math.round(recipe.hitStopFrames * this.scale.hitStopFactor);
    if (frames > 0) this.hitStop.trigger(frames);

    if (this.scale.allowParticles && recipe.burst !== undefined) {
      this.particles.burst(at, recipe.burst);
    }
    if (this.scale.allowFlash && recipe.flash !== undefined) {
      this.flash.flash(recipe.flash);
    }
    // Squash/stretch and pops are readability, so they survive reduced effects.
    if (recipe.ballSquash !== undefined) {
      this.squash.hit("ball", recipe.ballSquash.scaleX, recipe.ballSquash.scaleY, recipe.ballSquash.duration);
    }
    if (recipe.paddleSquash !== undefined) {
      this.squash.hit(
        "paddle",
        recipe.paddleSquash.scaleX,
        recipe.paddleSquash.scaleY,
        recipe.paddleSquash.duration,
      );
    }
    if (recipe.pop !== undefined) this.pops.spawn(at, recipe.pop);
  }

  /**
   * Resolve an effect anchor from the snapshot. Brick events carry a flat brick
   * index in `target`; everything else falls back to a player paddle, a ball,
   * or a fixed field point.
   */
  private anchorPoint(anchor: EffectAnchor, event: SimEvent, snap: Snapshot): FieldPoint {
    switch (anchor) {
      case "brick":
        return brickCenter(event.target, snap.bricks.length);
      case "ball":
        return firstBall(snap) ?? FIELD_CENTER;
      case "paddle": {
        const p = playerPaddle(snap, event.source);
        // Without a paddle to aim at, a ball (mid-flight) is the better guess.
        return p ?? firstBall(snap) ?? FIELD_CENTER;
      }
      case "topCenter":
        return TOP_CENTER;
      case "fieldCenter":
        return FIELD_CENTER;
    }
  }

  /** Advance every channel. `dt` is wall-clock seconds. */
  update(dt: number): void {
    const clamped = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    const frozen = this.hitStop.consumeFrame();
    this.shake.update(clamped);
    this.particles.update(clamped, frozen);
    this.flash.update(clamped, frozen);
    this.squash.update(clamped, frozen);
    this.pops.update(clamped, frozen);
  }

  /** Write the live effect state onto the scene. */
  applyToScene(): void {
    const scene = this.scene;
    // The shake target is a child of FieldView's scaled field container, so its
    // local space is field units — shake magnitudes need no conversion.
    const offset = this.shake.offset;
    scene.shakeTarget.x = offset.x;
    scene.shakeTarget.y = offset.y;
    scene.shakeTarget.rotation = offset.rotation;

    scene.flashLayer.visible = this.flash.isFlashing;
    scene.flashLayer.alpha = this.flash.currentAlpha;
    scene.flashLayer.tint = this.flash.currentColor;

    if (scene.ballSprite != null) {
      scene.ballSprite.scale.set(this.squash.scaleX("ball"), this.squash.scaleY("ball"));
    }
    if (scene.paddleSprite != null) {
      scene.paddleSprite.scale.set(this.squash.scaleX("paddle"), this.squash.scaleY("paddle"));
    }
  }

  /** Mount the effect layers into the scene (idempotent). */
  mount(): void {
    if (this.mounted) return;
    this.mounted = true;
    const particleView = this.particles.view;
    if (particleView !== null && this.scene.particleLayer !== null) {
      this.scene.particleLayer.addChild(particleView as never);
    }
    this.scene.popLayer.addChild(this.pops.view as never);
  }

  /** Clear every channel — context restore, rejoin, round change. */
  reset(): void {
    this.shake.reset();
    this.hitStop.reset();
    this.particles.reset();
    this.flash.reset();
    this.squash.reset();
    this.pops.reset();
    this.chain = 0;
  }

  destroy(): void {
    this.particles.destroy();
    this.pops.destroy();
  }
}

/** Flat brick index → field-unit center, via the grid constants (no sim import). */
export function brickCenter(index: number, brickCount: number): FieldPoint {
  if (!Number.isInteger(index) || index < 0 || index >= brickCount) return FIELD_CENTER;
  const col = index % BRICK_COLS;
  const row = Math.floor(index / BRICK_COLS);
  return {
    x: col * BRICK_W + BRICK_W / 2,
    y: BRICK_TOP_OFFSET + row * BRICK_H + BRICK_H / 2,
  };
}

function firstBall(snap: Snapshot): FieldPoint | null {
  const b = snap.balls[0];
  return b === undefined ? null : { x: b.x, y: b.y };
}

function playerPaddle(snap: Snapshot, player: number): FieldPoint | null {
  // Events with source -1 (a duel timeout clear) name no player; fall back to
  // the field's only paddle, then to none.
  const found =
    snap.players.find((p) => p.player === player) ??
    (player < 0 ? undefined : snap.players[0]);
  return found === undefined ? null : { x: found.paddle.x, y: found.paddle.y };
}
