// Field view: one play field + HUD strip, consuming Snapshots only (spec §2).
// Skins/themes (spec §13): paddle/ball from the player's skin registry entry,
// bricks + background from the host-chosen field theme. Owner-colored ball
// glow = render-time tint layer over the white-base ball skin (readability
// gate — never the sole ownership signal).
import { BitmapText, Container, Graphics } from "pixi.js";
import { cellSilverHits, type Snapshot } from "shared/protocol";
import { BRICK_COLS, BRICK_ROWS } from "shared/gridConstants";
import { ownerColor } from "shared/playerColors";
import { capDpr, type FieldLayout } from "./layout";
import { GAME_FONT_NAME, installGameFont } from "./gameFont";
import { diffBricks } from "./sceneSync";
import { format, t, type Locale } from "ui/strings";
import { DEFAULT_SKIN, getSkin, type PlayerSkin } from "content/skins";
import { DEFAULT_THEME, getTheme, type FieldTheme } from "content/themes";
import { pillFor } from "content/capsulePills";
import { paintFieldBackground } from "./themeBackground";
import { crackSegments } from "./brickCracks";
import { paintPaddle, paintBall, paintOwnerGlow, paintCapsule } from "./skinPainter";

export interface FieldViewOptions {
  layout: FieldLayout;
  player: number;
  locale: Locale;
  /** Field max round for R12/33 display. */
  maxRound: number;
  /** Player skin UUID (Settings Appearance default until lobby override). */
  skinId?: string | undefined;
  /** Field theme UUID (host-chosen; default theme when absent/unknown). */
  themeId?: string | undefined;
}

export class FieldView {
  readonly container = new Container();
  private readonly fieldContainer = new Container();
  private readonly hudText: BitmapText;
  private readonly paddleGfx = new Graphics();
  private readonly ballGfx = new Graphics();
  private readonly capsuleGfx = new Graphics();
  private readonly brickGfx = new Graphics();
  private readonly layout: FieldLayout;
  private readonly player: number;
  private readonly locale: Locale;
  private readonly maxRound: number;
  private readonly skin: PlayerSkin;
  private readonly theme: FieldTheme;
  private prevBricks: number[] | null = null;
  private lives = -1;
  private score = -1;
  private round = -1;
  private readonly nameText: BitmapText;

  constructor(opts: FieldViewOptions) {
    installGameFont();
    this.layout = opts.layout;
    this.player = opts.player;
    this.locale = opts.locale;
    this.maxRound = opts.maxRound;
    this.skin = getSkinSafe(opts.skinId);
    this.theme = getTheme(opts.themeId ?? null) ?? DEFAULT_THEME;

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
    this.fieldContainer.addChild(this.brickGfx, this.capsuleGfx, this.paddleGfx, this.ballGfx);

    this.container.addChild(this.nameText, this.hudText, this.fieldContainer);
  }

  /** Consume a snapshot; sync scene. Reads Snapshot only — never sim. */
  sync(snap: Snapshot): void {
    const player = snap.players.find((p) => p.player === this.player);
    if (!player) return;

    // Bricks: incremental diff redraw
    const diff = diffBricks(this.prevBricks ?? new Array(snap.bricks.length).fill(0), snap.bricks);
    if (diff.added.length + diff.removed.length + diff.changed.length > 0) {
      this.redrawBricks(snap.bricks);
    }
    this.prevBricks = [...snap.bricks];

    // Paddle (skin geometry)
    const p = player.paddle;
    this.paddleGfx.clear();
    paintPaddle(this.paddleGfx, this.skin.paddle, p.x, p.y, p.w, p.h);

    // Balls: owner-colored outline glow UNDER the white-base ball skin
    // (readability gate — glow ring stays visible around whatever skin the
    // ball wears; never the sole ownership signal). Owner color also tints
    // the white-base ball body at render time (never authored PNGs).
    this.ballGfx.clear();
    for (const b of snap.balls) {
      const owner = b.owner === null ? null : ownerColor(b.owner);
      if (owner !== null) {
        paintOwnerGlow(this.ballGfx, b.x, b.y, this.skin.ball.radius, owner);
      }
      paintBall(this.ballGfx, this.skin.ball, b.x, b.y, owner ?? undefined);
    }

    // Falling capsules: lettered pills
    this.capsuleGfx.clear();
    for (const c of snap.capsules) {
      paintCapsule(this.capsuleGfx, pillFor(c.type), c.x, c.y);
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
  }

  private redrawBricks(bricks: readonly number[]): void {
    this.brickGfx.clear();
    const set = this.theme.brickSet;
    for (let i = 0; i < bricks.length && i < BRICK_COLS * BRICK_ROWS; i++) {
      const cell = bricks[i] ?? 0;
      if (cell === 0) continue;
      const col = i % BRICK_COLS;
      const row = Math.floor(i / BRICK_COLS);
      const x = col * 16 + 0.5;
      const y = 20 + row * 8 + 0.5;
      this.brickGfx.rect(x, y, 15, 7).fill(this.brickColor(cell));
      // Silver hit-state crack overlay (procedural tint+crack, spec §13)
      if (cellSilverHits(cell) !== null) {
        for (const seg of crackSegments(cell, set.crackStyle)) {
          this.brickGfx
            .moveTo(x + seg.x1, y + seg.y1)
            .lineTo(x + seg.x2, y + seg.y2)
            .stroke({ width: 0.5, color: 0x101018 });
        }
      }
    }
  }

  private brickColor(cell: number): number {
    const set = this.theme.brickSet;
    if (cell === 13) return set.goldColor;
    if (cell > 8 && cell < 13) return set.silverColor;
    return set.tierColors[cell] ?? 0xffffff;
  }
}

/** Resolve a skin UUID with fallback to the default skin (unknown/null ids). */
function getSkinSafe(id: string | undefined): PlayerSkin {
  if (id === undefined) return DEFAULT_SKIN;
  return getSkin(id) ?? DEFAULT_SKIN;
}
