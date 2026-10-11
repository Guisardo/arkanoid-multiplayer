// Progressive bundle loading (ADR 0004, ticket 87).
//
// #86 delivered ONE packed atlas under a single `default` bundle. That is
// correct for the GPU-batching contract — every frame is cut from one image so
// `ParticleContainer` can batch — but it means the landing screen pays for the
// whole texture set before anyone can press Start.
//
// So this split is deliberately about *when*, not *what*: the atlas stays one
// packed unit, and the bundles decide when it is fetched. The `boot` bundle is
// what the landing/menu needs; `gameplay` is deferred to match start.
//
// The behaviours that matter here are external: which bundle name is requested,
// whether a repeated request is served from cache instead of re-fetching, and
// — the one that actually protects players — that a gameplay failure degrades
// to procedural art instead of refusing to start a match.
// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import type * as PixiModule from "pixi.js";

type Texture = PixiModule.Texture;

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
  },
  animations: {},
};

/** Every bundle name requested, in order, so deferral is observable. */
const bundleCalls: string[] = [];
/** Bundle names whose load should reject, to drive the fallback path. */
let failBundles = new Set<string>();

vi.mock("pixi.js", async () => {
  const actual = await vi.importActual<typeof PixiModule>("pixi.js");
  return {
    ...actual,
    Assets: {
      init: vi.fn(() => Promise.resolve()),
      loadBundle: vi.fn((name: string) => {
        bundleCalls.push(name);
        return failBundles.has(name) ? Promise.reject(new Error(`404 ${name}`)) : Promise.resolve();
      }),
      get: vi.fn(() => [spritesheet]),
      add: vi.fn(() => {}),
      load: vi.fn(() => Promise.resolve(actual.Texture.WHITE)),
    },
  };
});

const { ensureGameplayAssets, gameplayAssetsLoaded, spriteDebugState, spriteTexture } =
  await import("render/spriteSheet");

beforeEach(() => {
  bundleCalls.length = 0;
  failBundles = new Set();
  // The module-level "already loaded" flag survives between tests, so reset the
  // cache through the public seam rather than re-importing.
  gameplayAssetsLoaded.reset();
});

describe("progressive bundles (ticket 87)", () => {
  it("defers the gameplay bundle until a match actually starts", async () => {
    await ensureGameplayAssets();
    expect(bundleCalls).toContain("gameplay");
  });

  it("does not re-request the gameplay bundle once loaded", async () => {
    await ensureGameplayAssets();
    const first = bundleCalls.filter((b) => b === "gameplay").length;
    await ensureGameplayAssets();
    await ensureGameplayAssets();
    const after = bundleCalls.filter((b) => b === "gameplay").length;
    expect(after).toBe(first);
  });

  it("recovers from a failed gameplay bundle via the single-bundle manifest", async () => {
    failBundles = new Set(["gameplay"]);
    // A match must still start. `gameplay` is absent but `default` is not, so
    // this resolves WITH art rather than degrading to procedural geometry.
    await expect(ensureGameplayAssets()).resolves.toBeUndefined();
    expect(spriteDebugState().error).toBeNull();
    expect(spriteTexture("ball-red.png")).not.toBeNull();
  });

  it("degrades to procedural geometry when no bundle can load", async () => {
    // Neither the progressive name nor the legacy name exists — the worst
    // case. Must still resolve; the match starts on geometry.
    failBundles = new Set(["gameplay", "boot", "default"]);
    await expect(ensureGameplayAssets()).resolves.toBeUndefined();
    expect(spriteDebugState().error).toBeInstanceOf(Error);
  });

  it("keeps retrying after a total failure so a later match can still get art", async () => {
    failBundles = new Set(["gameplay", "boot", "default"]);
    await ensureGameplayAssets();
    failBundles = new Set();
    await ensureGameplayAssets();
    // Failed loads must not be cached as success, or this would be a no-op.
    expect(bundleCalls.filter((b) => b === "gameplay").length).toBeGreaterThan(1);
  });

  it("concurrent callers share one in-flight load rather than racing", async () => {
    await Promise.all([ensureGameplayAssets(), ensureGameplayAssets(), ensureGameplayAssets()]);
    expect(bundleCalls.filter((b) => b === "gameplay").length).toBe(1);
  });

  it("leaves the shared-source batching contract intact", async () => {
    await ensureGameplayAssets();
    const star = spriteTexture("particle-star.png");
    const ball = spriteTexture("ball-red.png");
    expect(star?.source).toBe(ball?.source);
  });

  it("falls back to the single-bundle manifest shipped by #86", async () => {
    // The committed manifest declares only `default` (one packed atlas). A
    // checkout that has not re-run `npm run assetpack` must still get art.
    failBundles = new Set(["gameplay", "boot"]);
    await expect(ensureGameplayAssets()).resolves.toBeUndefined();
    expect(bundleCalls).toContain("default");
    expect(spriteDebugState().error).toBeNull();
    expect(spriteTexture("ball-red.png")).not.toBeNull();
  });
});