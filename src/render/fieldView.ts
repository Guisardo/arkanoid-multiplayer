// Field view: one play field + HUD strip, consuming Snapshots only (spec §2).
// Skins/themes (spec §13): paddle/ball from the player's skin registry entry,
// bricks + background from the host-chosen field theme. Owner-colored ball
// glow = render-time tint layer over the white-base ball skin (readability
// gate — never the sole ownership signal).
import { BitmapText, Container, Graphics, Sprite, TilingSprite } from "pixi.js";
import type { Snapshot } from "shared/protocol";
import { FIELD_H, FIELD_W } from "shared/gridConstants";
import { ownerColor } from "shared/playerColors";
import { capDpr, type FieldLayout } from "./layout";
import { GAME_FONT_NAME, installGameFont } from "./gameFont";
import { spriteTexture } from "./spriteSheet";
import { VisualEffects, type EffectsState, type VisualEffectsScene } from "./visualEffects";
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
  private readonly paddleSprite: Sprite | null;
  private readonly ballSprite: Sprite | null;
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
    const bgTex = this.theme.background.sprite !== null ? spriteTexture(this.theme.background.sprite) : null;
    this.bgSprite =
      bgTex !== null && !this.reducedEffects
        ? new TilingSprite({ texture: bgTex, width: FIELD_W, height: FIELD_H })
        : null;
    if (this.bgSprite !== null) {
      this.bgSprite.tint = 0x808080; // darkening pass (spec §13) over the tile
      this.fieldContainer.addChild(this.bgSprite);
    }
    const paddleTex = this.skin.paddle.sprite !== null ? spriteTexture(this.skin.paddle.sprite) : null;
    this.paddleSprite = paddleTex !== null ? new Sprite(paddleTex) : null;
    const ballTex = this.skin.ball.sprite !== null ? spriteTexture(this.skin.ball.sprite) : null;
    this.ballSprite = ballTex !== null ? new Sprite(ballTex) : null;
    // ADR 0009: the shake layer pivots on the field center so camera roll swings
    // the field about its middle instead of whipping it around the top-left.
    this.shakeLayer.pivot.set(FIELD_W / 2, FIELD_H / 2);
    this.shakeLayer.position.set(FIELD_W / 2, FIELD_H / 2);
    // ADR 0005: the brick wall is a cached render group, mounted first so the
    // dynamic layers (capsules, paddles, balls, boss) always draw over it.
    this.brickLayer = new BrickLayer({ theme: this.theme, reducedEffects: this.reducedEffects });
    this.shakeLayer.addChild(
      this.brickLayer.view,
      this.capsuleGfx,
      this.paddleGfx,
      this.ballGfx,
      this.bossGfx,
    );
    if (this.paddleSprite !== null) this.shakeLayer.addChild(this.paddleSprite);
    if (this.ballSprite !== null) this.shakeLayer.addChild(this.ballSprite);

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
  }

  /**
   * The scene surface the orchestrator writes to. Shake targets the shake
   * layer (in field units); flash/pops/particles are separate mount points.
   */
  private effectScene(): VisualEffectsScene {
    return {
      shakeTarget: this.shakeLayer,
      particleLayer: this.particleLayer,
      popLayer: this.popLayer,
      flashLayer: this.flashGfx,
      ballSprite: this.ballSprite,
      paddleSprite: this.paddleSprite,
    };
  }

  /** Consume a snapshot; sync scene. Reads Snapshot only — never sim. */
  sync(snap: Snapshot): void {
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
    // sharedField — carry all players in one snapshot, ticket 56). Own
    // player renders with the skin sprite (when loaded); every other
    // player renders procedurally via their own skin — paddleGfx stays
    // visible so other players' paddles never disappear behind the sprite.
    // Owner bar (readability): a 2px strip in the player's color under
    // every paddle — maps paddle ↔ owner color ↔ ball tint/ring.
    // Ownership marking (readability gate): only when 2+ players share
    // this field (duel/sharedField) — solo fields carry no ownership
    // semantics, so no tint, no ring, no bars.
    const markOwnership = snap.players.length >= 2;
    const me = player;
    this.paddleGfx.clear();
    for (const pl of snap.players) {
      if (pl === me) continue; // own paddle = sprite below (or fallback paint)
      const otherSkin = getSkin(this.skinIds?.[pl.player] ?? null) ?? DEFAULT_SKIN;
      paintPaddle(this.paddleGfx, otherSkin.paddle, pl.paddle.x, pl.paddle.y, pl.paddle.w, pl.paddle.h);
      if (markOwnership) {
        this.paddleGfx
          .rect(pl.paddle.x - pl.paddle.w / 2, pl.paddle.y + pl.paddle.h / 2 + 1, pl.paddle.w, 2)
          .fill(ownerColor(pl.player));
      }
    }
    if (this.paddleSprite !== null) {
      const p = me.paddle;
      this.paddleSprite.visible = true;
      this.paddleSprite.position.set(p.x - p.w / 2, p.y - p.h / 2);
      this.paddleSprite.width = p.w;
      this.paddleSprite.height = p.h;
    } else {
      paintPaddle(this.paddleGfx, this.skin.paddle, me.paddle.x, me.paddle.y, me.paddle.w, me.paddle.h);
    }
    if (markOwnership) {
      this.paddleGfx
        .rect(me.paddle.x - me.paddle.w / 2, me.paddle.y + me.paddle.h / 2 + 1, me.paddle.w, 2)
        .fill(ownerColor(me.player));
    }
    this.paddleGfx.visible = true;

    // Balls: owner-colored outline glow UNDER the ball skin (readability
    // gate — glow ring stays visible around whatever skin the ball wears;
    // never the sole ownership signal). Glow always renders on ballGfx;
    // the body is either the sprite (when loaded) or procedural geometry.
    // Reduced effects (ticket 54): skip the glow ring layer — the ball
    // body still carries the owner tint (readability gate preserved).
    this.ballGfx.clear();
    this.ballGfx.visible = true;
    if (this.ballSprite !== null) this.ballSprite.visible = false;
    for (const b of snap.balls) {
      const owner = markOwnership && b.owner !== null ? ownerColor(b.owner) : null;
      if (owner !== null && !this.reducedEffects) {
        paintOwnerGlow(this.ballGfx, b.x, b.y, this.skin.ball.radius, owner);
      }
      if (this.ballSprite === null) {
        paintBall(this.ballGfx, this.skin.ball, b.x, b.y, owner ?? undefined);
      }
    }
    // Single-ball fields: sprite body over the glow ring (ring stays
    // visible). White-base sprite tinted with the owner color (spec §13:
    // owner variants = render-time tint, never per-owner PNGs) — the ball
    // body itself carries ownership; no owner → untinted white.
    if (this.ballSprite !== null && snap.balls.length === 1) {
      const b0 = snap.balls[0];
      if (b0 !== undefined) {
        this.ballSprite.visible = true;
        this.ballSprite.tint =
          markOwnership && b0.owner !== null ? ownerColor(b0.owner) : 0xffffff;
        this.ballSprite.position.set(b0.x - this.skin.ball.radius, b0.y - this.skin.ball.radius);
        this.ballSprite.width = this.skin.ball.radius * 2;
        this.ballSprite.height = this.skin.ball.radius * 2;
      }
    }

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
    this.syncEffects(snap);
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
