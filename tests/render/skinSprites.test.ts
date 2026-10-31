// Sprite-drawn Paddles and balls (issue #152). The Paddle art is 64×28 texture
// units (2.3:1) but a Paddle is 32×6 (5.3:1) and changes width with
// Expand/Reduce, so a plain stretch squashes the rounded ends. The three-slice
// keeps the end caps at the art's aspect and stretches only the middle.
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { Container, Rectangle, Texture, TextureSource } from "pixi.js";
import { BallSpritePool, PaddleSprite } from "render/skinSprites";

/** A 64×28-unit paddle frame at 4 texels per unit, trimmed like the atlas. */
function paddleTexture(): Texture {
  const source = new TextureSource({ width: 256, height: 112, resolution: 4 });
  return new Texture({
    source,
    frame: new Rectangle(0, 0, 62, 26),
    orig: new Rectangle(0, 0, 64, 28),
    trim: new Rectangle(1, 1, 62, 26),
  });
}

/** A 16×16-unit ball frame. */
function ballTexture(): Texture {
  const source = new TextureSource({ width: 64, height: 64, resolution: 4 });
  return new Texture({ source, frame: new Rectangle(0, 0, 16, 16) });
}

/** Cap width the art carries: 20 of its 64×28 units, so 20/28 of the height. */
const CAP_PER_HEIGHT = 20 / 28;

describe("PaddleSprite — three-slice (issue #152)", () => {
  for (const w of [21, 32, 48]) {
    it(`at w=${String(w)} the caps keep the art's aspect and the whole spans w×h`, () => {
      const paddle = new PaddleSprite(paddleTexture());
      paddle.fit(100, 200, w, 6, "bottom");
      const shown = paddle.displayed;
      expect(shown.width).toBeCloseTo(w, 6);
      expect(shown.height).toBeCloseTo(6, 6);
      expect(shown.capWidth).toBeCloseTo(6 * CAP_PER_HEIGHT, 6);
      paddle.view.destroy();
    });
  }

  it("centres on the Paddle position", () => {
    const paddle = new PaddleSprite(paddleTexture());
    paddle.fit(100, 200, 32, 6, "bottom");
    const b = paddle.view.getBounds();
    expect(b.x + b.width / 2).toBeCloseTo(100, 6);
    expect(b.y + b.height / 2).toBeCloseTo(200, 6);
    paddle.view.destroy();
  });

  it("a side Paddle (Shared Field) lies along its edge with the caps on the long axis", () => {
    const paddle = new PaddleSprite(paddleTexture());
    paddle.fit(4, 120, 6, 32, "left");
    const shown = paddle.displayed;
    expect(shown.width).toBeCloseTo(6, 6);
    expect(shown.height).toBeCloseTo(32, 6);
    expect(shown.capWidth).toBeCloseTo(6 * CAP_PER_HEIGHT, 6);
    const b = paddle.view.getBounds();
    expect(b.width).toBeCloseTo(6, 6);
    expect(b.height).toBeCloseTo(32, 6);
    expect(b.x + b.width / 2).toBeCloseTo(4, 6);
    paddle.view.destroy();
  });

  it("squash multiplies the fitted size instead of replacing it", () => {
    const paddle = new PaddleSprite(paddleTexture());
    paddle.fit(100, 200, 32, 6, "bottom");
    paddle.setSquash(1.25, 0.8);
    expect(paddle.displayed.width).toBeCloseTo(40, 6);
    expect(paddle.displayed.height).toBeCloseTo(4.8, 6);
    // A later fit (the next snapshot) keeps the squash in flight.
    paddle.fit(110, 200, 48, 6, "bottom");
    expect(paddle.displayed.width).toBeCloseTo(60, 6);
    paddle.setSquash(1, 1);
    expect(paddle.displayed.width).toBeCloseTo(48, 6);
    paddle.view.destroy();
  });
});

describe("BallSpritePool (issue #152)", () => {
  it("draws every ball, growing to the peak count and hiding the surplus", () => {
    const parent = new Container();
    const pool = new BallSpritePool(ballTexture(), parent, 3);
    pool.sync([
      { x: 10, y: 20, tint: 0xffffff },
      { x: 30, y: 40, tint: 0xff0000 },
      { x: 50, y: 60, tint: 0x00ff00 },
    ]);
    expect(pool.visibleCount).toBe(3);
    expect(parent.children).toHaveLength(3);
    pool.sync([{ x: 10, y: 20, tint: 0xffffff }]);
    expect(pool.visibleCount).toBe(1);
    // Shrinking hides; it never frees, so the next Multiball does not allocate.
    expect(parent.children).toHaveLength(3);
    parent.destroy({ children: true });
  });

  it("sizes each ball to its radius × squash and applies its tint", () => {
    const parent = new Container();
    const pool = new BallSpritePool(ballTexture(), parent, 3);
    pool.sync([{ x: 10, y: 20, tint: 0xff0000 }]);
    expect(pool.displayed(0)).toEqual({ x: 10, y: 20, width: 6, height: 6, tint: 0xff0000 });
    pool.setSquash(1.5, 1 / 1.5);
    const squashed = pool.displayed(0);
    expect(squashed.width).toBeCloseTo(9, 6);
    expect(squashed.height).toBeCloseTo(4, 6);
    parent.destroy({ children: true });
  });
});
