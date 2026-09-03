// Field view: one play field + HUD strip, consuming Snapshots only (spec §2).
import { BitmapText, Container, Graphics } from "pixi.js";
import type { Snapshot } from "shared/protocol";
import { BRICK_COLS, BRICK_ROWS } from "shared/gridConstants";
import { capDpr, type FieldLayout } from "./layout";
import { GAME_FONT_NAME, installGameFont } from "./gameFont";
import { diffBricks } from "./sceneSync";
import type { Locale } from "ui/strings";
import { format, t } from "ui/strings";

const BRICK_COLORS: Record<number, number> = {
  1: 0xd82800,
  2: 0xfc9838,
  3: 0xfcbcd0,
  4: 0x58f898,
  5: 0x00fcfc,
  6: 0x00b8fc,
};
const SILVER_COLOR = 0xbcbcbc;
const GOLD_COLOR = 0xdca850;
const PADDLE_COLOR = 0xe8b04a;
const BALL_COLOR = 0xf8f8f8;

export interface FieldViewOptions {
  layout: FieldLayout;
  player: number;
  locale: Locale;
  /** Field max round for R12/33 display. */
  maxRound: number;
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
    bg.rect(0, 0, 208, 256).fill(0x101018);
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

    // Paddle
    const p = player.paddle;
    this.paddleGfx.clear();
    this.paddleGfx.rect(p.x - p.w / 2, p.y - p.h / 2, p.w, p.h).fill(PADDLE_COLOR);

    // Balls + falling capsules
    this.ballGfx.clear();
    for (const b of snap.balls) {
      this.ballGfx.circle(b.x, b.y, 3).fill(BALL_COLOR);
    }
    this.capsuleGfx.clear();
    for (const c of snap.capsules) {
      this.capsuleGfx.rect(c.x - 6, c.y - 3, 12, 6).fill(0xdc4838);
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
    for (let i = 0; i < bricks.length && i < BRICK_COLS * BRICK_ROWS; i++) {
      const cell = bricks[i] ?? 0;
      if (cell === 0) continue;
      const col = i % BRICK_COLS;
      const row = Math.floor(i / BRICK_COLS);
      const color = this.brickColor(cell);
      this.brickGfx
        .rect(col * 16 + 0.5, 20 + row * 8 + 0.5, 15, 7)
        .fill(color);
    }
  }

  private brickColor(cell: number): number {
    if (cell === 13) return GOLD_COLOR;
    if (cell > 8 && cell < 13) return SILVER_COLOR;
    return BRICK_COLORS[cell] ?? 0xffffff;
  }
}
