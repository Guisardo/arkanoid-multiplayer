// Sprite-drawn Paddles and balls (issue #152). The Skin's sprite art is its
// canonical look; FieldView falls back to procedural geometry only when a
// frame is unavailable (node tests, atlas load failure).
//
// Sizing contract: each view keeps a *fitted* size (what the snapshot says)
// and a *squash* pair (what the effects orchestrator says), and the scale it
// writes is always fitted × squash. Writing either one alone used to clobber
// the other: squash set `scale` straight over the size `width`/`height` had
// just written, so sprites drew at their natural texture size.
import { NineSliceSprite, Sprite } from "pixi.js";
import type { Container, Texture } from "pixi.js";
import type { PaddleEdge } from "shared/protocol";

/**
 * End-cap width of the Tiny Break-em paddle art, in texture units of its
 * 64×28 frame: the rounded end plus the red chevrons, which stop at 19, and
 * the blue inlay, which starts at 20.
 */
export const PADDLE_CAP_UNITS = 20;

/** A scene node the orchestrator squashes (ADR 0009). */
export interface SquashTarget {
  setSquash(scaleX: number, scaleY: number): void;
}

/** Size a view actually draws at, in field units (field axes). */
export interface DisplayedPaddle {
  width: number;
  height: number;
  /** One end cap's drawn length, along the Paddle's long axis. */
  capWidth: number;
}

/**
 * Turn that lays the art (drawn for a bottom Paddle, lit side up) along each
 * edge with its top facing into the field.
 */
const EDGE_ROTATION: Record<PaddleEdge, number> = {
  bottom: 0,
  top: Math.PI,
  left: Math.PI / 2,
  right: -Math.PI / 2,
};

function isSideEdge(edge: PaddleEdge): boolean {
  return edge === "left" || edge === "right";
}

/**
 * Paddle as a horizontal three-slice. The slice plane is laid out in texture
 * units at the art's own height and then scaled uniformly by Paddle height,
 * so the caps keep the art's aspect at any Paddle width (Expand/Reduce) and
 * only the middle stretches.
 */
export class PaddleSprite implements SquashTarget {
  readonly view: NineSliceSprite;
  private fitScale = 1;
  private squashX = 1;
  private squashY = 1;
  private side = false;

  constructor(texture: Texture) {
    this.view = new NineSliceSprite({
      texture,
      leftWidth: PADDLE_CAP_UNITS,
      rightWidth: PADDLE_CAP_UNITS,
      topHeight: 0,
      bottomHeight: 0,
    });
    // Centre anchor: squash deforms about the Paddle's centre, not its corner.
    this.view.anchor.set(0.5);
  }

  /**
   * Fit to a Paddle centred on (x, y), `w` × `h` field units. Side Paddles
   * (Shared Field) are taller than wide: the slice runs along `h` there.
   */
  fit(x: number, y: number, w: number, h: number, edge: PaddleEdge): void {
    this.side = isSideEdge(edge);
    const length = this.side ? h : w;
    const thickness = this.side ? w : h;
    const artHeight = this.view.originalHeight;
    this.fitScale = thickness / artHeight;
    this.view.setSize(length / this.fitScale, artHeight);
    this.view.rotation = EDGE_ROTATION[edge];
    this.view.position.set(x, y);
    this.applyScale();
  }

  setSquash(scaleX: number, scaleY: number): void {
    this.squashX = scaleX;
    this.squashY = scaleY;
    this.applyScale();
  }

  /** What is drawn, in field units (test/e2e probe). */
  get displayed(): DisplayedPaddle {
    const v = this.view;
    // Pixi shrinks the borders when the plane is narrower than both caps.
    const borderFit = Math.min(1, v.width / (v.leftWidth + v.rightWidth));
    const length = v.width * v.scale.x;
    const thickness = v.height * v.scale.y;
    return {
      width: this.side ? thickness : length,
      height: this.side ? length : thickness,
      capWidth: v.leftWidth * borderFit * v.scale.x,
    };
  }

  private applyScale(): void {
    this.view.scale.set(this.fitScale * this.squashX, this.fitScale * this.squashY);
  }
}

/** One ball to draw: centre and render-time tint (0xffffff = untinted). */
export interface BallDraw {
  x: number;
  y: number;
  tint: number;
}

/** A drawn ball, in field units (test/e2e probe). */
export interface DisplayedBall extends BallDraw {
  width: number;
  height: number;
}

/**
 * Every ball on a field as a sprite. Render-side pool, separate from the sim
 * object pools in ADR 0006: it grows to the peak ball count (Multiball) and
 * then only hides and shows, so a split never allocates mid-match.
 */
export class BallSpritePool implements SquashTarget {
  private readonly sprites: Sprite[] = [];
  private visible = 0;
  private squashX = 1;
  private squashY = 1;

  constructor(
    private readonly texture: Texture,
    private readonly parent: Container,
    private readonly radius: number,
  ) {}

  /** Draw exactly `balls`; surplus sprites hide. */
  sync(balls: readonly BallDraw[]): void {
    while (this.sprites.length < balls.length) this.sprites.push(this.spawn());
    for (const [i, sprite] of this.sprites.entries()) {
      const ball = balls[i];
      sprite.visible = ball !== undefined;
      if (ball === undefined) continue;
      sprite.position.set(ball.x, ball.y);
      sprite.tint = ball.tint;
    }
    this.visible = balls.length;
  }

  setSquash(scaleX: number, scaleY: number): void {
    this.squashX = scaleX;
    this.squashY = scaleY;
    for (const sprite of this.sprites) this.applyScale(sprite);
  }

  /** Balls drawn on the last sync. */
  get visibleCount(): number {
    return this.visible;
  }

  /** The `index`-th drawn ball (test/e2e probe). */
  displayed(index: number): DisplayedBall {
    const sprite = this.sprites[index];
    if (sprite === undefined || index >= this.visible) {
      throw new RangeError(`BallSpritePool.displayed: no ball drawn at index ${String(index)} (visible=${String(this.visible)})`);
    }
    return { x: sprite.x, y: sprite.y, width: sprite.width, height: sprite.height, tint: sprite.tint };
  }

  private spawn(): Sprite {
    const sprite = new Sprite(this.texture);
    sprite.anchor.set(0.5);
    this.applyScale(sprite);
    this.parent.addChild(sprite);
    return sprite;
  }

  private applyScale(sprite: Sprite): void {
    const fit = (this.radius * 2) / this.texture.width;
    sprite.scale.set(fit * this.squashX, fit * this.squashY);
  }
}
