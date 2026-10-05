// spriteSheet (ADR 0004 / 0009): frame resolution out of the packed atlas.
//
// AssetPack writes to `public/assets` and its manifest srcs are bare
// filenames, so a wrong base path silently serves the SPA's index.html and
// drops the whole game to procedural geometry. These tests pin the paths and
// the frame registration that make sprites (and the particle atlas) reach the
// GPU.
// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import type * as PixiModule from "pixi.js";

type Texture = PixiModule.Texture;

// The frame table AssetPack emits. Pixi's atlas parser turns this into a
// Spritesheet; the mock mirrors that shape.
const baseTexture = { source: { id: "shared-source" } };
const frameTexture = (name: string) =>
  ({ source: baseTexture.source, label: name, frame: { x: 0, y: 0, width: 16, height: 16 } }) as unknown as Texture;

const spritesheet = {
  linkedSheets: [],
  cachePrefix: "",
  _texture: baseTexture,
  textureSource: baseTexture.source,
  textures: {
    "pixel-space.png": frameTexture("pixel-space.png"),
    "paddle-a-red.png": frameTexture("paddle-a-red.png"),
    "paddle-b-purple.png": frameTexture("paddle-b-purple.png"),
    "paddle-c-blue.png": frameTexture("paddle-c-blue.png"),
    "ball-red.png": frameTexture("ball-red.png"),
    "ball-yellow.png": frameTexture("ball-yellow.png"),
    "ball-green.png": frameTexture("ball-green.png"),
    "particle-circle.png": frameTexture("particle-circle.png"),
    "particle-square.png": frameTexture("particle-square.png"),
    "particle-triangle.png": frameTexture("particle-triangle.png"),
    "particle-star.png": frameTexture("particle-star.png"),
    "particle-streak.png": frameTexture("particle-streak.png"),
    "particle-debris.png": frameTexture("particle-debris.png"),
    "particle-splat.png": frameTexture("particle-splat.png"),
    "particle-ring.png": frameTexture("particle-ring.png"),
    // A frame nobody looks up — must not be registered.
    "unused-frame.png": frameTexture("unused-frame.png"),
  },
  animations: {},
};

/** Every Assets.init call, so the manifest URL and base path can be asserted. */
const initCalls: Array<{ manifest?: string; basePath?: string }> = [];
const added: Array<{ alias: string; src: string }> = [];
let failInit = false;
/** Swapped per-test to drive the manual frame-cutting fallback. */
let atlasAliasValue: unknown = [spritesheet];

// The real Rectangle/Texture are kept (via importActual) so the shared-source
// guarantee is genuinely exercised; only the Assets registry is faked.
vi.mock("pixi.js", async () => {
  const actual = await vi.importActual<typeof PixiModule>("pixi.js");
  return {
    ...actual,
    Assets: {
      init: vi.fn((opts: { manifest?: string; basePath?: string }) => {
        initCalls.push(opts);
        return failInit ? Promise.reject(new Error("404")) : Promise.resolve();
      }),
      loadBundle: vi.fn(() => Promise.resolve()),
      // AssetPack gives one asset two srcs (PNG + WebP frame tables), so Pixi
      // resolves the alias to an array — mirror that.
      get: vi.fn(() => atlasAliasValue),
      add: vi.fn((a: { alias: string; src: string }) => {
        added.push(a);
      }),
      load: vi.fn(() => Promise.resolve(actual.Texture.WHITE)),
    },
  };
});

const { initAssets, loadSkinSprites, rememberTexture, SPRITE_PATHS, spriteDebugState, spriteTexture } =
  await import("render/spriteSheet");

beforeEach(() => {
  initCalls.length = 0;
  added.length = 0;
  failInit = false;
  atlasAliasValue = [spritesheet];
});

describe("spriteSheet — SPRITE_PATHS", () => {
  it("covers paddles, balls, backgrounds and the 8 particle frames", () => {
    expect(Object.keys(SPRITE_PATHS.paddles).length).toBe(3);
    expect(Object.keys(SPRITE_PATHS.balls).length).toBe(3);
    expect(Object.keys(SPRITE_PATHS.backgrounds).length).toBe(1);
    expect(Object.keys(SPRITE_PATHS.particles).length).toBe(8);
    expect(SPRITE_PATHS.paddles.red).toBe("paddle-a-red.png");
    expect(SPRITE_PATHS.balls.red).toBe("ball-red.png");
    expect(SPRITE_PATHS.backgrounds.pixelSpace).toBe("pixel-space.png");
    const names = Object.values(SPRITE_PATHS.particles);
    expect(new Set(names).size).toBe(8);
  });
});

describe("spriteSheet — frame cache", () => {
  it("spriteTexture returns null for unknown paths", () => {
    expect(spriteTexture("unknown.png")).toBeNull();
  });

  it("rememberTexture caches; spriteTexture returns the same instance", () => {
    const tex = { texture: "x" } as unknown as Texture;
    rememberTexture("paddle-a-red.png", tex);
    expect(spriteTexture("paddle-a-red.png")).toBe(tex);
  });
});

describe("spriteSheet — atlas registration", () => {
  it("requests the manifest AND a base path under AssetPack's output dir", async () => {
    await initAssets();
    // Both matter: the manifest's own srcs are bare filenames, so without a
    // matching basePath they resolve to the site root and 404 into index.html.
    expect(initCalls).toHaveLength(1);
    expect(initCalls[0]!.manifest).toContain("assets/manifest.json");
    expect(initCalls[0]!.basePath).toContain("assets");
  });

  it("registers every frame the game looks up", async () => {
    await initAssets();
    const debug = spriteDebugState();
    expect(debug.atlasResolved).toBe(true);
    for (const name of [
      ...Object.values(SPRITE_PATHS.paddles),
      ...Object.values(SPRITE_PATHS.balls),
      ...Object.values(SPRITE_PATHS.backgrounds),
      ...Object.values(SPRITE_PATHS.particles),
    ]) {
      expect(debug.frames, `${name} was not registered`).toContain(name);
      expect(spriteTexture(name), `${name} did not resolve`).not.toBeNull();
    }
  });

  it("does not register frames the game never looks up", async () => {
    await initAssets();
    expect(spriteDebugState().frames).not.toContain("unused-frame.png");
    expect(spriteTexture("unused-frame.png")).toBeNull();
  });

  it("all frames share one GPU source — the ParticleContainer batching contract", async () => {
    await initAssets();
    const star = spriteTexture(SPRITE_PATHS.particles.star)!;
    const circle = spriteTexture(SPRITE_PATHS.particles.circle)!;
    const ball = spriteTexture(SPRITE_PATHS.balls.red)!;
    expect(star.source).toBe(circle.source);
    expect(star.source).toBe(ball.source);
  });

  it("records the failure so a silent fallback is diagnosable", async () => {
    failInit = true;
    await expect(initAssets()).resolves.toBeUndefined();
    expect(spriteDebugState().error).toBeInstanceOf(Error);
    expect(spriteDebugState().atlasResolved).toBe(false);
  });

  it("loadSkinSprites delegates to initAssets", async () => {
    await expect(loadSkinSprites()).resolves.toBeUndefined();
    expect(initCalls.length).toBeGreaterThan(0);
  });
});

// Keep the mocked Spritesheet shape honest: if Pixi renames `textures`, the
// silent-fallback path returns and these tests would stop catching it.
describe("spriteSheet — mocked atlas shape", () => {
  it("the fixture exposes a `textures` record", () => {
    expect(typeof spritesheet.textures).toBe("object");
    expect(Object.keys(spritesheet.textures).length).toBeGreaterThan(8);
  });
});

describe("spriteSheet — manual frame-cutting fallback", () => {
  // The frame cache is module-level and `initAssets` never clears it, and
  // earlier tests already registered these names via the Spritesheet path. So
  // these assert on the *identity and geometry* of the cut texture, which is
  // what actually distinguishes the manual path from the shared-source one.
  interface Recut {
    beforePaddle: Texture | null;
    beforeBall: Texture | null;
    paddle: Texture | null;
    ball: Texture | null;
  }

  async function recut(): Promise<Recut> {
    atlasAliasValue = rawTable;
    const beforePaddle = spriteTexture("paddle-a-red.png");
    const beforeBall = spriteTexture("ball-red.png");
    await initAssets();
    return {
      beforePaddle,
      beforeBall,
      paddle: spriteTexture("paddle-a-red.png"),
      ball: spriteTexture("ball-red.png"),
    };
  }
  // A manifest can resolve to a bare frame table instead of a Spritesheet (no
  // atlas parser registered, or a hand-written manifest). The loader then
  // cuts the sub-textures itself — a real code path, so it gets a real test.
  const rawTable = {
    frames: {
      "paddle-a-red.png": {
        frame: { x: 130, y: 1348, w: 62, h: 26 },
        rotated: false,
        trimmed: true,
        spriteSourceSize: { x: 1, y: 1, w: 62, h: 26 },
        sourceSize: { w: 64, h: 28 },
      },
      "ball-red.png": {
        frame: { x: 1348, y: 145, w: 14, h: 14 },
        rotated: false,
        trimmed: true,
        spriteSourceSize: { x: 1, y: 1, w: 14, h: 14 },
        sourceSize: { w: 16, h: 16 },
      },
      // Rotated frames are skipped rather than rendered with wrong UVs.
      "ball-green.png": {
        frame: { x: 0, y: 0, w: 16, h: 16 },
        rotated: true,
        trimmed: false,
        spriteSourceSize: { x: 0, y: 0, w: 16, h: 16 },
        sourceSize: { w: 16, h: 16 },
      },
    },
    meta: { image: "atlas-raw.png" },
  };

  it("cuts a sub-texture per frame from the frame table's image", async () => {
    const r = await recut();
    // The manual path built fresh textures, replacing the Spritesheet ones.
    expect(r.paddle).not.toBe(r.beforePaddle);
    expect(r.ball).not.toBe(r.beforeBall);
    expect(r.paddle).not.toBeNull();
    // The atlas image was registered under AssetPack's output dir.
    expect(added).toHaveLength(1);
    expect(added[0]!.src).toContain("assets/atlas-raw.png");
    expect(added[0]!.alias).toContain("atlas-raw.png");
  });

  it("gives every cut frame the frame rect and the trim rect", async () => {
    atlasAliasValue = rawTable;
    await initAssets();
    const paddle = spriteTexture("paddle-a-red.png")!;
    expect(paddle.frame.x).toBe(130);
    expect(paddle.frame.y).toBe(1348);
    expect(paddle.frame.width).toBe(62);
    // A trimmed sprite must keep its original size, not the trimmed one.
    expect(paddle.orig?.width).toBe(64);
    expect(paddle.trim?.x).toBe(1);
    // All cut frames share the loaded image's source — the batching contract.
    expect(paddle.source).toBe(spriteTexture("ball-red.png")!.source);
  });

  it("skips a rotated frame rather than rendering it with wrong UVs", async () => {
    atlasAliasValue = rawTable;
    const before = spriteTexture("ball-green.png");
    await initAssets();
    // Untouched: the previous registration (or absence) still stands.
    expect(spriteTexture("ball-green.png")).toBe(before);
  });

  it("a table with no image yields nothing instead of throwing", async () => {
    atlasAliasValue = { frames: rawTable.frames, meta: {} };
    const before = spriteTexture("paddle-a-red.png");
    await expect(initAssets()).resolves.toBeUndefined();
    expect(spriteTexture("paddle-a-red.png")).toBe(before);
    expect(spriteDebugState().error).toBeNull();
    expect(added).toHaveLength(0);
  });

  it("an alias that resolves to nothing usable leaves the cache alone", async () => {
    const before = spriteTexture("paddle-a-red.png");
    atlasAliasValue = undefined;
    await initAssets();
    expect(spriteTexture("paddle-a-red.png")).toBe(before);
    expect(spriteDebugState().error).toBeNull();
  });
});