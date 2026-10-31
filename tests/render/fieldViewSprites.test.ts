// FieldView draws Skin sprites (issue #152). Once the atlas is in, every Paddle
// wears its owner's Skin art and every ball wears the white-base ball frame,
// and the drawn size is the snapshot's size × the live squash. Runs under jsdom
// with real Textures primed into the frame cache, because `spriteTexture()`
// returns null without a DOM and the sprite path would never execute.
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Rectangle, Texture, TextureSource } from "pixi.js";
import { FieldView } from "render/fieldView";
import { layoutField } from "render/layout";
import { gameplayAssetsLoaded, rememberTexture, SPRITE_PATHS } from "render/spriteSheet";
import { SKINS } from "content/skins";
import { ownerColor } from "shared/playerColors";
import type { PlayerSnapshot, Snapshot } from "shared/protocol";
import type * as GameFont from "render/gameFont";

// jsdom has no canvas 2D context, so the bitmap game font cannot be measured.
// Text is not under test here; the font install is the one DOM call skipped.
vi.mock("render/gameFont", async (importOriginal) => ({
  ...(await importOriginal<typeof GameFont>()),
  installGameFont: (): void => undefined,
}));

function frame(w: number, h: number): Texture {
  const source = new TextureSource({ width: w * 4, height: h * 4, resolution: 4 });
  return new Texture({ source, frame: new Rectangle(0, 0, w, h) });
}

function primeFrames(): void {
  for (const name of Object.values(SPRITE_PATHS.paddles)) rememberTexture(name, frame(64, 28));
  rememberTexture(SPRITE_PATHS.balls.base, frame(16, 16));
}

function player(index: number, over: Partial<PlayerSnapshot["paddle"]> = {}): PlayerSnapshot {
  return {
    player: index,
    name: `P${String(index + 1)}`,
    skinIndex: index,
    paddle: { x: 104 + index * 40, y: 240, w: 32, h: 6, edge: "bottom", ...over },
    lives: 3,
    score: 0,
    meter: 0,
    target: -1,
    chain: 0,
    state: "playing",
    effects: {},
  };
}

function snap(over: Partial<Snapshot> = {}): Snapshot {
  return {
    tick: 5,
    round: 1,
    epoch: 0,
    phase: "play",
    bricks: new Array<number>(13 * 18).fill(0),
    capsules: [],
    bossProjectiles: [],
    balls: [{ x: 104, y: 200, vx: 0, vy: 0, attachedTo: null, owner: null }],
    players: [player(0)],
    events: [],
    ...over,
  } as Snapshot;
}

function makeView(skinIds?: readonly string[]): FieldView {
  return new FieldView({
    layout: layoutField({ x: 0, y: 0, w: 800, h: 600 }),
    player: 0,
    locale: "en-US",
    maxRound: 33,
    skinId: SKINS[0]!.id,
    skinIds,
  });
}

beforeEach(() => {
  gameplayAssetsLoaded.reset();
  primeFrames();
});

afterEach(() => {
  gameplayAssetsLoaded.reset();
});

describe("FieldView — sprite Paddles and balls (issue #152)", () => {
  it("draws a solo Paddle and ball from sprites at the snapshot size, ball untinted", () => {
    const view = makeView();
    view.sync(snap());
    const probe = view.spriteProbe;
    expect(probe.paddles).toEqual([
      { player: 0, drawnFrom: "sprite", frame: SPRITE_PATHS.paddles.red, width: 32, height: 6 },
    ]);
    expect(probe.balls).toEqual([{ drawnFrom: "sprite", width: 6, height: 6, tint: 0xffffff }]);
    view.destroy();
  });

  it("drawn size = Paddle w×h × squash after sync + tickEffects", () => {
    const view = makeView();
    const s = snap();
    view.sync(s);
    view.visualEffects.onSimEvent({ type: "paddleBounce", source: 0, target: -1, tick: 5 }, s);
    view.tickEffects(0);
    const { paddleScale, ballScale } = view.effectsState;
    expect(paddleScale.x).not.toBe(1);
    expect(ballScale.x).not.toBe(1);
    let probe = view.spriteProbe;
    expect(probe.paddles[0]!.width).toBeCloseTo(32 * paddleScale.x, 6);
    expect(probe.paddles[0]!.height).toBeCloseTo(6 * paddleScale.y, 6);
    expect(probe.balls[0]!.width).toBeCloseTo(6 * ballScale.x, 6);
    expect(probe.balls[0]!.height).toBeCloseTo(6 * ballScale.y, 6);
    // The next snapshot re-fits the size; the squash in flight must survive it.
    view.sync(snap({ players: [player(0, { w: 48 })] }));
    probe = view.spriteProbe;
    expect(probe.paddles[0]!.width).toBeCloseTo(48 * paddleScale.x, 6);
    view.destroy();
  });

  it("every player's Paddle wears its own Skin sprite; balls carry owner tint with 2+ players", () => {
    const view = makeView([SKINS[0]!.id, SKINS[1]!.id, SKINS[2]!.id]);
    view.sync(
      snap({
        players: [player(0), player(1), player(2)],
        balls: [
          { x: 50, y: 100, vx: 0, vy: 0, attachedTo: null, owner: 1 },
          { x: 60, y: 110, vx: 0, vy: 0, attachedTo: null, owner: 2 },
          { x: 70, y: 120, vx: 0, vy: 0, attachedTo: null, owner: null },
        ],
      }),
    );
    const probe = view.spriteProbe;
    expect(probe.paddles.map((p) => [p.player, p.drawnFrom, p.frame])).toEqual([
      [0, "sprite", SPRITE_PATHS.paddles.red],
      [1, "sprite", SPRITE_PATHS.paddles.purple],
      [2, "sprite", SPRITE_PATHS.paddles.blue],
    ]);
    expect(probe.balls.map((b) => [b.drawnFrom, b.tint])).toEqual([
      ["sprite", ownerColor(1)],
      ["sprite", ownerColor(2)],
      ["sprite", 0xffffff],
    ]);
    view.destroy();
  });

  it("a player leaving the field hides their Paddle sprite", () => {
    const view = makeView();
    view.sync(snap({ players: [player(0), player(1)] }));
    expect(view.spriteProbe.paddles).toHaveLength(2);
    view.sync(snap({ players: [player(0)] }));
    expect(view.spriteProbe.paddles.map((p) => p.player)).toEqual([0]);
    view.destroy();
  });

  it("falls back to procedural geometry per frame that is unavailable, then upgrades when it lands", () => {
    gameplayAssetsLoaded.reset(); // nothing loaded: the multiplayer mount case
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const view = makeView();
    view.sync(snap());
    expect(view.spriteProbe.paddles[0]!.drawnFrom).toBe("procedural");
    expect(view.spriteProbe.balls[0]!.drawnFrom).toBe("procedural");
    primeFrames();
    view.sync(snap());
    expect(view.spriteProbe.paddles[0]!.drawnFrom).toBe("sprite");
    expect(view.spriteProbe.balls[0]!.drawnFrom).toBe("sprite");
    // Not loaded yet is not a content bug: nothing logged.
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
    view.destroy();
  });
});
