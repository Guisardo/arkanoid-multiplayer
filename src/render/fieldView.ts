// Field view: one play field + HUD strip, consuming Snapshots only (spec §2).
// Skins/themes (spec §13): paddle/ball from the player's skin registry entry,
// bricks + background from the host-chosen field theme. Owner-colored ball
// glow = render-time tint layer over the white-base ball skin (readability
// gate — never the sole ownership signal).
import { BitmapText, Container, Graphics, Rectangle, TilingSprite } from "pixi.js";
import type { PlayerSnapshot, Snapshot } from "shared/protocol";
import { FIELD_H, FIELD_W } from "shared/gridConstants";
import { ownerColor } from "shared/playerColors";
import { capDpr, fieldCullRect, type FieldLayout } from "./layout";
import { GAME_FONT_NAME, installGameFont } from "./gameFont";
import { skinSpriteTexture } from "./spriteSheet";
import { BallSpritePool, PaddleSprite, type BallDraw, type SquashTarget } from "./skinSprites";
import { VisualEffects, type EffectsState, type VisualEffectsScene } from "./visualEffects";
import { LASER_COLOR, laserShapes, type LaserShapes } from "./laserView";
import { format, t, type Locale } from "ui/strings";
import { DEFAULT_SKIN, getSkin, type PlayerSkin } from "content/skins";
import { DEFAULT_THEME, getTheme, type FieldTheme } from "content/themes";
import { pillFor } from "content/capsulePills";
import { paintFieldBackground } from "./themeBackground";
import { BrickLayer } from "./brickLayer";
import { paintPaddle, paintBall, paintOwnerGlow, paintCapsule, paintBoss } from "./skinPainter";
import { DOH_BOSS } from "content/bosses";
import { BOSS_PROJECTILE_SIZE } from "shared/protocol";

export interface FieldViewOptions {
  layout: FieldLayout;
  player: number;
  locale: Locale;
  /** Field max round for R12/33 display. */
  maxRound: number;
  /** Player skin UUID (Settings Appearance default until lobby override). */
  skinId?: string | undefined;
  /**
   * Per-player skin UUIDs, player-index aligned (single-field variants:
   * duel/sharedField render every player's paddle on one field — ticket 56).
   * Absent → other players render with the default skin.
   */
  skinIds?: readonly string[] | undefined;
  /** Field theme UUID (host-chosen; default theme when absent/unknown). */
  themeId?: string | undefined;
  /**
   * Ticket 54: reduced-effects mode — skips the per-frame decorative
   * layers (owner-glow rings, silver crack overlays, background tile
   * sprite). Measurably fewer Graphics ops per frame.
   */
  reducedEffects?: boolean;
  /**
   * Ticket 102: perf-ladder factor on the cached brick wall's density. The
   * ladder passes 0.5 on the explicit degraded rung (a quarter of the texture
   * bytes); absent → 1, full on-screen density.
   */
  textureResolution?: number;
  /**
   * Ticket #151: the renderer resolution (device pixel ratio). With the
   * layout scale it sets the wall cache's on-screen density; absent → 1.
   */
  rendererResolution?: number;
}

/** How one Paddle or ball was drawn on the last sync (test/e2e probe, issue #152). */
export type DrawnFrom = "sprite" | "procedural";

export interface PaddleProbe {
  player: number;
  drawnFrom: DrawnFrom;
  /** Atlas frame drawn, or null for procedural geometry. */
  frame: string | null;
  /** Drawn size in field units, squash included. */
  width: number;
  height: number;
}

export interface BallProbe {
  drawnFrom: DrawnFrom;
  width: number;
  height: number;
  tint: number;
}

export interface FieldSpriteProbe {
  paddles: readonly PaddleProbe[];
  balls: readonly BallProbe[];
}

/** One Paddle drawn on the last sync; the sprite is read live for the probe. */
interface PaddleDraw {
  player: number;
  sprite: PaddleSprite | null;
  frame: string | null;
  w: number;
  h: number;
}

export class FieldView {
  readonly container = new Container();
  private readonly fieldContainer = new Container();
  private readonly hudText: BitmapText;
  private readonly paddleGfx = new Graphics();
  private readonly ballGfx = new Graphics();
  private readonly capsuleGfx = new Graphics();
  /** ADR 0005: the static brick wall — one cached render group. */
  private readonly brickLayer: BrickLayer;
  private readonly bossGfx = new Graphics();
  /** Laser (ticket #148): Bolts + ready-ticks, and the Bolt Brick flashes. */
  private readonly laserGfx = new Graphics();
  private readonly brickFlashGfx = new Graphics();
  private lastLaserShapes: LaserShapes = { bolts: [], readyTicks: [] };
  /**
   * Issue #152: one three-slice sprite per player slot, each wearing that
   * player's Skin, and a pool covering every ball. Created on the first sync
   * that finds the frame, so a field built before the gameplay atlas lands
   * (multiplayer mounts without waiting) upgrades from geometry on its own.
   */
  private readonly paddleSpriteLayer = new Container();
  private readonly ballSpriteLayer = new Container();
  private readonly paddleSprites = new Map<number, PaddleSprite>();
  private ballPool: BallSpritePool | null = null;
  /** Squash pairs last written by the orchestrator (ADR 0009). */
  private paddleSquash = { x: 1, y: 1 };
  private ballSquash = { x: 1, y: 1 };
  /** Player whose Paddle the paddle squash deforms: this field's own. */
  private squashedPlayer = -1;
  private lastPaddleDraws: PaddleDraw[] = [];
  private lastProceduralBalls: BallProbe[] = [];
  private readonly bgSprite: TilingSprite | null;
  private readonly layout: FieldLayout;
  private readonly player: number;
  private readonly locale: Locale;
  private readonly maxRound: number;
  private readonly skin: PlayerSkin;
  /** Per-player skin UUIDs (single-field multi-paddle render, ticket 56). */
  private readonly skinIds: readonly string[] | undefined;
  private readonly theme: FieldTheme;
  private lives = -1;
  private score = -1;
  private round = -1;
  private readonly nameText: BitmapText;
  /** Ticket 54: reduced-effects mode (decorative layers skipped). */
  private reducedEffects: boolean;
  /** Ticket 102: cached-wall texture resolution (perf ladder degraded rung). */
  private wallResolution: number;
  /** ADR 0009: one effects orchestrator per field (split-screen isolated). */
  private readonly effects: VisualEffects;
  /** Shake target, pivoted on the field center and parented by fieldContainer. */
  private readonly shakeLayer = new Container();
  /** Effect layers, mounted inside the shake layer (field-unit coordinates). */
  private readonly particleLayer = new Container();
  private readonly popLayer = new Container();
  private readonly flashGfx = new Graphics();
  /** Wall-clock of the last tickEffects() call — FieldView owns the frame clock. */
  private lastFrameMs = 0;

  constructor(opts: FieldViewOptions) {
    installGameFont();
    this.layout = opts.layout;
    this.player = opts.player;
    this.locale = opts.locale;
    this.maxRound = opts.maxRound;
    this.skin = getSkinSafe(opts.skinId);
    this.skinIds = opts.skinIds;
    this.theme = getTheme(opts.themeId ?? null) ?? DEFAULT_THEME;
    this.reducedEffects = opts.reducedEffects ?? false;
    this.wallResolution = opts.textureResolution ?? 1;

    const s = this.layout.scale;
    // HUD strip above the field
    this.nameText = new BitmapText({
      text: "",
      style: { fontFamily: GAME_FONT_NAME, fontSize: 8 * capDpr(s) },
    });
    this.nameText.position.set(this.layout.hud.x, this.layout.hud.y);
    this.hudText = new BitmapText({
      text: "",
      style: { fontFamily: GAME_FONT_NAME, fontSize: 8 * capDpr(s) },
    });
    this.hudText.position.set(this.layout.hud.x, this.layout.hud.y + 9 * s);

    // Field content, clipped and scaled from logical units
    this.fieldContainer.position.set(this.layout.field.x, this.layout.field.y);
    this.fieldContainer.scale.set(s);

    const bg = new Graphics();
    paintFieldBackground(bg, this.theme.background);
    this.fieldContainer.addChild(bg);

    // Real CC0 sprites (Tiny Break-em paddles/balls, Pixel Space background)
    // layer over the procedural geometry. Null in node tests / load failure —
    // geometry fallback stays the source of truth for readability. Reduced
    // effects (ticket 54) skips the background tile entirely.
    const bgTex =
      this.theme.background.sprite !== null
        ? skinSpriteTexture(this.theme.background.sprite, { kind: "theme", id: this.theme.id })
        : null;
    this.bgSprite =
      bgTex !== null && !this.reducedEffects
        ? new TilingSprite({ texture: bgTex, width: FIELD_W, height: FIELD_H })
        : null;
    if (this.bgSprite !== null) {
      this.bgSprite.tint = 0x808080; // darkening pass (spec §13) over the tile
      this.fieldContainer.addChild(this.bgSprite);
    }
    // ADR 0009: the shake layer pivots on the field center so camera roll swings
    // the field about its middle instead of whipping it around the top-left.
    this.shakeLayer.pivot.set(FIELD_W / 2, FIELD_H / 2);
    this.shakeLayer.position.set(FIELD_W / 2, FIELD_H / 2);
    // ADR 0005: the brick wall is a cached render group, mounted first so the
    // dynamic layers (capsules, paddles, balls, boss) always draw over it.
    this.brickLayer = new BrickLayer({
      theme: this.theme,
      reducedEffects: this.reducedEffects,
      textureResolution: this.wallResolution,
      layoutScale: s,
      rendererResolution: opts.rendererResolution ?? 1,
    });
    this.shakeLayer.addChild(
      this.brickLayer.view,
      this.brickFlashGfx,
      this.capsuleGfx,
      this.paddleGfx,
      this.ballGfx,
      this.bossGfx,
    );
    // Sprites over the geometry layers: the owner glow ring (ballGfx) sits
    // under the ball sprites, so it stays visible around them.
    this.shakeLayer.addChild(this.paddleSpriteLayer, this.ballSpriteLayer, this.laserGfx);

    // Effect layers sit inside the shake layer, so they inherit both the field
    // scale and the shake — and their coordinates are field units.
    this.flashGfx.rect(0, 0, FIELD_W, FIELD_H).fill(0xffffff);
    this.flashGfx.blendMode = "add";
    this.flashGfx.visible = false;
    this.shakeLayer.addChild(this.particleLayer, this.popLayer, this.flashGfx);
    this.fieldContainer.addChild(this.shakeLayer);

    this.effects = new VisualEffects(this.effectScene());
    this.effects.setReducedEffects(this.reducedEffects);
    this.effects.mount();
    this.lastFrameMs = nowMs();

    this.container.addChild(this.nameText, this.hudText, this.fieldContainer);

    // Ticket 93: opt into Pixi's culler. The area is the drawn rect, not the
    // region: letterboxing leaves empty margin the culler should not count.
    const cull = fieldCullRect(this.layout);
    this.container.cullable = true;
    this.container.cullArea = new Rectangle(cull.x, cull.y, cull.width, cull.height);
  }

  /**
   * The orchestrator writes a shake *offset* (0,0 at rest). The shake layer is
   * pivoted on the field center, so its resting position is that center, not
   * the origin: map the offset onto it, or the field content jumps by the
   * pivot and renders off-screen.
   */
  private shakeOffsetTarget(): VisualEffectsScene["shakeTarget"] {
    const layer = this.shakeLayer;
    return {
      get x() {
        return layer.x - FIELD_W / 2;
      },
      set x(v: number) {
        layer.x = FIELD_W / 2 + v;
      },
      get y() {
        return layer.y - FIELD_H / 2;
      },
      set y(v: number) {
        layer.y = FIELD_H / 2 + v;
      },
      get rotation() {
        return layer.rotation;
      },
      set rotation(v: number) {
        layer.rotation = v;
      },
    };
  }

  /**
   * The scene surface the orchestrator writes to. Shake targets the shake
   * layer (in field units); flash/pops/particles are separate mount points.
   */
  private effectScene(): VisualEffectsScene {
    return {
      shakeTarget: this.shakeOffsetTarget(),
      particleLayer: this.particleLayer,
      popLayer: this.popLayer,
      flashLayer: this.flashGfx,
      ballSquash: this.squashTarget((x, y) => {
        this.ballSquash = { x, y };
        this.ballPool?.setSquash(x, y);
      }),
      paddleSquash: this.squashTarget((x, y) => {
        this.paddleSquash = { x, y };
        this.paddleSprites.get(this.squashedPlayer)?.setSquash(x, y);
      }),
      brickFlashLayer: this.brickFlashGfx,
    };
  }

  private squashTarget(apply: (x: number, y: number) => void): SquashTarget {
    return { setSquash: apply };
  }

  /**
   * Consume a snapshot; sync scene. Reads Snapshot only — never sim.
   * `replayEvents` false redraws state without feeding the event ring to the
   * effects orchestrator (ticket 100: resize re-sync must not re-fire effects).
   */
  sync(snap: Snapshot, replayEvents = true): void {
    // Field-local snapshots (multiField variants) carry player 0 only —
    // fall back to the first player so session-indexed FieldViews still
    // render (ticket 56: bot fields were blank).
    const player =
      snap.players.find((p) => p.player === this.player) ?? snap.players[0];
    if (!player) return;

    // Bricks: ADR 0005 static layer. The layer owns its own diff against the
    // grid it last recorded, so an unchanged frame costs nothing.
    this.brickLayer.sync(snap.bricks);

    // Paddles: EVERY player on this field (single-field variants — duel/
    // sharedField — carry all players in one snapshot, ticket 56), each in
    // its owner's Skin: the own player's from `skinId`, the others' from
    // `skinIds`. Sprite art when the frame is loaded, geometry otherwise.
    // Owner bar (readability): a 2px strip in the player's color under
    // every paddle — maps paddle ↔ owner color ↔ ball tint/ring.
    // Ownership marking (readability gate): only when 2+ players share
    // this field (duel/sharedField) — solo fields carry no ownership
    // semantics, so no tint, no ring, no bars.
    const markOwnership = snap.players.length >= 2;
    this.squashedPlayer = player.player;
    this.paddleGfx.clear();
    this.lastPaddleDraws = snap.players.map((pl) => this.drawPaddle(pl, pl === player ? this.skin : this.skinFor(pl)));
    for (const [slot, sprite] of this.paddleSprites) {
      if (!snap.players.some((pl) => pl.player === slot)) sprite.view.visible = false;
    }
    if (markOwnership) {
      for (const pl of snap.players) {
        this.paddleGfx
          .rect(pl.paddle.x - pl.paddle.w / 2, pl.paddle.y + pl.paddle.h / 2 + 1, pl.paddle.w, 2)
          .fill(ownerColor(pl.player));
      }
    }
    this.paddleGfx.visible = true;

    // Balls: owner-colored outline glow UNDER the ball skin (readability
    // gate — glow ring stays visible around whatever skin the ball wears;
    // never the sole ownership signal). Glow always renders on ballGfx;
    // every body is a pooled sprite when the frame is loaded, geometry
    // otherwise. The white-base frame carries the owner tint with 2+
    // players (spec §13: owner variants = render-time tint, never per-owner
    // PNGs); solo balls stay untinted white.
    // Reduced effects (ticket 54): skip the glow ring layer — the ball
    // body still carries the owner tint (readability gate preserved).
    this.ballGfx.clear();
    this.ballGfx.visible = true;
    const pool = this.ensureBallPool();
    const draws: BallDraw[] = [];
    this.lastProceduralBalls = [];
    for (const b of snap.balls) {
      const owner = markOwnership && b.owner !== null ? ownerColor(b.owner) : null;
      if (owner !== null && !this.reducedEffects) {
        paintOwnerGlow(this.ballGfx, b.x, b.y, this.skin.ball.radius, owner);
      }
      if (pool !== null) {
        draws.push({ x: b.x, y: b.y, tint: owner ?? 0xffffff });
      } else {
        paintBall(this.ballGfx, this.skin.ball, b.x, b.y, owner ?? undefined);
        const d = this.skin.ball.radius * 2;
        this.lastProceduralBalls.push({ drawnFrom: "procedural", width: d, height: d, tint: owner ?? this.skin.ball.baseColor });
      }
    }
    pool?.sync(draws);

    // Falling capsules: lettered pills
    this.capsuleGfx.clear();
    for (const c of snap.capsules) {
      paintCapsule(this.capsuleGfx, pillFor(c.type), c.x, c.y);
    }

    // Doh boss (ticket 49): moai sprite + projectiles, snapshot-driven only.
    if (snap.boss !== undefined && !snap.boss.dead) {
      paintBoss(this.bossGfx, DOH_BOSS, snap.boss.x, snap.boss.y);
      const size = BOSS_PROJECTILE_SIZE;
      for (const p of snap.bossProjectiles ?? []) {
        this.bossGfx
          .rect(p.x - size / 2, p.y - size / 2, size, size)
          .fill(DOH_BOSS.accentColor);
      }
    } else {
      this.bossGfx.clear();
    }

    // HUD strip: name + color chip, lives icons, score, R12/33
    if (player.lives !== this.lives || player.score !== this.score || snap.round !== this.round) {
      this.lives = player.lives;
      this.score = player.score;
      this.round = snap.round;
      const livesIcons = "❤".repeat(Math.max(0, player.lives));
      this.nameText.text = player.name;
      this.hudText.text = `${livesIcons}  ${String(player.score).padStart(6, "0")}  ${format(t(this.locale, "hud.roundOf"), { round: snap.round, max: this.maxRound })}`;
    }

    // ADR 0009: events fire after the state draw so anchors read this frame's
    // geometry. The effects advance themselves in tickEffects().
    if (replayEvents) this.syncEffects(snap);
    this.drawLaser(snap);
  }

  /** Skin for a player other than this field's own (ticket 56). */
  private skinFor(pl: PlayerSnapshot): PlayerSkin {
    return getSkin(this.skinIds?.[pl.player] ?? null) ?? DEFAULT_SKIN;
  }

  /** Draw one Paddle in `skin`: its sprite slot when the frame is in, geometry otherwise. */
  private drawPaddle(pl: PlayerSnapshot, skin: PlayerSkin): PaddleDraw {
    const p = pl.paddle;
    const key = skin.paddle.sprite;
    const sprite = key !== null ? this.paddleSpriteFor(pl.player, key, skin) : null;
    if (sprite === null) {
      paintPaddle(this.paddleGfx, skin.paddle, p.x, p.y, p.w, p.h);
      return { player: pl.player, sprite: null, frame: null, w: p.w, h: p.h };
    }
    sprite.view.visible = true;
    sprite.fit(p.x, p.y, p.w, p.h, p.edge);
    // Only this field's own Paddle squashes: the channel is per field, and
    // another player's bounce must not deform it.
    const squash = pl.player === this.squashedPlayer ? this.paddleSquash : { x: 1, y: 1 };
    sprite.setSquash(squash.x, squash.y);
    return { player: pl.player, sprite, frame: key, w: p.w, h: p.h };
  }

  /** The slot's sprite, created once its Skin's frame is available; null until then. */
  private paddleSpriteFor(slot: number, key: string, skin: PlayerSkin): PaddleSprite | null {
    const existing = this.paddleSprites.get(slot);
    if (existing !== undefined) return existing;
    const texture = skinSpriteTexture(key, { kind: "skin", id: skin.id });
    if (texture === null) return null;
    const sprite = new PaddleSprite(texture);
    this.paddleSprites.set(slot, sprite);
    this.paddleSpriteLayer.addChild(sprite.view);
    return sprite;
  }

  /** The ball pool, created once the Skin's ball frame is available; null until then. */
  private ensureBallPool(): BallSpritePool | null {
    if (this.ballPool !== null) return this.ballPool;
    const key = this.skin.ball.sprite;
    if (key === null) return null;
    const texture = skinSpriteTexture(key, { kind: "skin", id: this.skin.id });
    if (texture === null) return null;
    this.ballPool = new BallSpritePool(texture, this.ballSpriteLayer, this.skin.ball.radius);
    this.ballPool.setSquash(this.ballSquash.x, this.ballSquash.y);
    return this.ballPool;
  }

  /** Test/e2e probe (issue #152): how each Paddle and ball was drawn on the last sync. */
  get spriteProbe(): FieldSpriteProbe {
    const paddles = this.lastPaddleDraws.map((d): PaddleProbe => {
      if (d.sprite === null) {
        return { player: d.player, drawnFrom: "procedural", frame: null, width: d.w, height: d.h };
      }
      const shown = d.sprite.displayed;
      return { player: d.player, drawnFrom: "sprite", frame: d.frame, width: shown.width, height: shown.height };
    });
    const pool = this.ballPool;
    const balls: BallProbe[] =
      pool === null
        ? this.lastProceduralBalls
        : Array.from({ length: pool.visibleCount }, (_, i) => {
            const b = pool.displayed(i);
            return { drawnFrom: "sprite", width: b.width, height: b.height, tint: b.tint };
          });
    return { paddles, balls };
  }

  /** Bolts + ready-ticks (ticket #148): thin yellow bars, no trail, no glow. */
  private drawLaser(snap: Snapshot): void {
    const shapes = laserShapes(snap);
    this.lastLaserShapes = shapes;
    this.laserGfx.clear();
    for (const r of shapes.bolts) this.laserGfx.rect(r.x, r.y, r.w, r.h).fill(LASER_COLOR);
    for (const r of shapes.readyTicks) this.laserGfx.rect(r.x, r.y, r.w, r.h).fill(LASER_COLOR);
  }

  /** Test probe (ticket #148): the laser rectangles drawn on the last sync. */
  get laserShapes(): LaserShapes {
    return this.lastLaserShapes;
  }

  // ---- visual effects (ADR 0009) -------------------------------------------

  /**
   * Feed the snapshot's event ring to the effects orchestrator. Called from
   * sync() after the state draw so anchors read the same frame's geometry.
   */
  private syncEffects(snap: Snapshot): void {
    this.effects.consume(snap);
  }

  /**
   * Advance and apply the effects for one rendered frame. Called by the
   * session render callback (not sync) so dt reflects the real frame gap —
   * on the perf ladder's 30 fps rung that is ~33 ms, not a rendered frame.
   */
  tickEffects(dt: number): void {
    this.lastFrameMs = nowMs();
    this.effects.update(dt);
    this.effects.applyToScene();
  }

  /**
   * Advance effects using the wall-clock gap since the previous call. Lets
   * callers that have no dt (or want the frame budget measured by someone
   * else) drive the same clock.
   */
  tickEffectsAuto(): void {
    const now = nowMs();
    const dt = Math.min((now - this.lastFrameMs) / 1000, 0.1);
    this.lastFrameMs = now;
    this.tickEffects(dt);
  }

  /** Ticket 100 probe: the rendered HUD strip text (name line, stats line). */
  get hudLines(): readonly [string, string] {
    return [this.nameText.text, this.hudText.text];
  }

  /** Live effect state — read by tests and the reduced-effects gate. */
  get effectsState(): EffectsState {
    return this.effects.state;
  }

  /** The orchestrator, exposed for session-level assertions. */
  get visualEffects(): VisualEffects {
    return this.effects;
  }

  /**
   * Ticket 54: context-restore resync — drop every cached render state so
   * the next sync() redraws the full scene from the snapshot (never from
   * partial GPU state). Also used when reduced-effects toggles live.
   */
  invalidate(): void {
    this.lives = -1;
    this.score = -1;
    this.round = -1;
    // ADR 0005: the cached brick wall holds GPU-side texture state, so it is
    // re-recorded from the snapshot too.
    this.brickLayer.reset();
    // A context restore / rejoin drops transient effect state too (audit §7):
    // a stranded particle burst or stuck flash would survive the resync.
    this.effects.reset();
  }

  /** Ticket 54: live reduced-effects toggle (invalidates caches). */
  setReducedEffects(reduced: boolean): void {
    if (this.reducedEffects === reduced) return;
    this.reducedEffects = reduced;
    if (this.bgSprite !== null) this.bgSprite.visible = !reduced;
    this.effects.setReducedEffects(reduced);
    // The brick layer records a crack-free variant set in reduced mode.
    this.brickLayer.setReducedEffects(reduced);
    this.invalidate();
  }

  /**
   * Ticket 102: live cached-wall texture resolution (perf ladder). Kept in a
   * field so a resize rebuild — which constructs fresh FieldViews — inherits
   * the resolution the session is currently on instead of snapping back to
   * full while the ladder sits degraded.
   */
  get textureResolution(): number {
    return this.wallResolution;
  }

  /** Ticket 102: downscale (or restore) this field's cached wall texture. */
  setTextureResolution(resolution: number): void {
    if (this.wallResolution === resolution) return;
    this.wallResolution = resolution;
    this.brickLayer.setTextureResolution(resolution);
  }

  /**
   * Ticket #151: tear the field down. The effects orchestrator goes first — it
   * owns pooled particles and pop BitmapTexts that a bare container teardown
   * leaks — then the brick layer (pooled spares share contexts across fields),
   * then the display tree. Idempotent.
   */
  destroy(): void {
    if (this.container.destroyed) return;
    this.effects.destroy();
    this.brickLayer.destroy();
    this.container.destroy({ children: true });
  }

  /** Ticket #151: renderer resolution changed — re-record the wall to match. */
  setRendererResolution(resolution: number): void {
    this.brickLayer.setRendererResolution(resolution);
  }

  /** Ticket #151: texels per field unit the wall cache is recorded at. */
  get wallCacheResolution(): number {
    return this.brickLayer.cacheResolution;
  }
}

/** Wall clock in ms, guarded so node tests still get a usable (0) value. */
function nowMs(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : 0;
}

/** Resolve a skin UUID with fallback to the default skin (unknown/null ids). */
function getSkinSafe(id: string | undefined): PlayerSkin {
  if (id === undefined) return DEFAULT_SKIN;
  return getSkin(id) ?? DEFAULT_SKIN;
}
