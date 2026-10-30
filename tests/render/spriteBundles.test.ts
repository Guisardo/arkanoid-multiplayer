// Progressive bundle loading (ADR 0004, ticket 87).
//
// The packed art is split into two bundles, each its own atlas:
//   - `boot`     — what the landing/menu draws (the background frame)
//   - `gameplay` — paddles, balls and every particle frame, deferred to match
//                  start so first paint does not wait on game textures.
//
// The particle frames stay together inside `gameplay`: frames cut from one
// image share a `TextureSource`, which is what lets `ParticleContainer` batch
// the whole effect layer into a single draw call.
//
// The behaviours that matter are external: which bundle name is requested and
// when, whether a repeated request is served from cache, that progress is
// reported to whoever is waiting, and — the one that protects players — that a
// gameplay failure degrades to procedural art instead of refusing a match.
// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import type * as PixiModule from "pixi.js";

type Texture = PixiModule.Texture;

const bootSource = { id: "boot-source" };
const gameplaySource = { id: "gameplay-source" };

const frameTexture = (name: string, source: object) =>
  ({ source, label: name, frame: { x: 0, y: 0, width: 16, height: 16 } }) as unknown as Texture;

function sheetOf(names: readonly string[], source: object) {
  return {
    linkedSheets: [],
    cachePrefix: "",
    textureSource: source,
    textures: Object.fromEntries(names.map((n) => [n, frameTexture(n, source)])),
    animations: {},
  };
}

const sheets: Record<string, ReturnType<typeof sheetOf>> = {
  "boot-atlas": sheetOf(["pixel-space.png"], bootSource),
  "gameplay-atlas": sheetOf(
    [
      "paddle-a-red.png",
      "paddle-b-purple.png",
      "paddle-c-blue.png",
      "ball-red.png",
      "ball-yellow.png",
      "ball-green.png",
      "particle-circle.png",
      "particle-square.png",
      "particle-triangle.png",
      "particle-star.png",
      "particle-streak.png",
      "particle-debris.png",
      "particle-splat.png",
      "particle-ring.png",
    ],
    gameplaySource,
  ),
};

/** Every bundle name requested, in order, so deferral is observable. */
const bundleCalls: string[] = [];
/** Bundle names the (mock) manifest does not declare. */
let failBundles = new Set<string>();
/** Aliases that have actually landed in the (mock) Pixi cache. */
const present = new Set<string>();
/** How many times `Assets.init` was called — it must never exceed 1. */
let initCalls = 0;
/** Progress a bundle load reports, in order. */
let progressSteps: number[] = [0.25, 0.6, 1];
/** When set, `loadBundle` waits for this before it resolves. */
let gate: Promise<void> | null = null;

vi.mock("pixi.js", async () => {
  const actual = await vi.importActual<typeof PixiModule>("pixi.js");
  return {
    ...actual,
    Assets: {
      init: vi.fn(() => {
        initCalls += 1;
        return Promise.resolve();
      }),
      // Pixi's real `loadBundle` does NOT reject for a bundle the manifest does
      // not declare — it logs "not found in the Cache" and RESOLVES. Modelling
      // that is the point: the loader must key on the outcome (did the atlas
      // arrive?), not on an exception.
      loadBundle: vi.fn(async (name: string, onProgress?: (p: number) => void) => {
        bundleCalls.push(name);
        for (const step of progressSteps) onProgress?.(step);
        if (gate !== null) await gate;
        if (!failBundles.has(name)) present.add(`${name}-atlas`);
      }),
      get: vi.fn((alias: string) => (present.has(alias) ? [sheets[alias]] : [])),
      add: vi.fn(() => {}),
      load: vi.fn(() => Promise.resolve(actual.Texture.WHITE)),
    },
  };
});

const { ensureGameplayAssets, gameplayAssetsLoaded, initAssets, spriteDebugState, spriteTexture } =
  await import("render/spriteSheet");

beforeEach(() => {
  bundleCalls.length = 0;
  initCalls = 0;
  present.clear();
  failBundles = new Set();
  progressSteps = [0.25, 0.6, 1];
  gate = null;
  // The module-level "already loaded" flag survives between tests, so reset the
  // cache through the public seam rather than re-importing.
  gameplayAssetsLoaded.reset();
});

describe("progressive bundles (ticket 87)", () => {
  it("boot loads only the boot bundle: the background, not the gameplay art", async () => {
    await initAssets();
    expect(bundleCalls).toEqual(["boot"]);
    expect(spriteTexture("pixel-space.png")).not.toBeNull();
    expect(spriteTexture("ball-red.png")).toBeNull();
  });

  it("defers the gameplay bundle until a match actually starts", async () => {
    await initAssets();
    expect(bundleCalls).not.toContain("gameplay");
    await ensureGameplayAssets();
    expect(bundleCalls).toContain("gameplay");
    expect(spriteTexture("ball-red.png")).not.toBeNull();
  });

  it("does not re-request the gameplay bundle once loaded", async () => {
    await ensureGameplayAssets();
    await ensureGameplayAssets();
    await ensureGameplayAssets();
    expect(bundleCalls.filter((b) => b === "gameplay")).toHaveLength(1);
  });

  it("degrades to procedural geometry when the gameplay bundle cannot load", async () => {
    failBundles = new Set(["gameplay"]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(ensureGameplayAssets()).resolves.toBeUndefined();
    expect(spriteTexture("ball-red.png")).toBeNull();
    expect(spriteDebugState().atlasResolved).toBe(false);
    expect(spriteDebugState().error).toBeInstanceOf(Error);
    warn.mockRestore();
  });

  it("does not paper over a missing bundle by loading a different one", async () => {
    failBundles = new Set(["gameplay"]);
    await ensureGameplayAssets();
    expect(bundleCalls).toEqual(["gameplay"]);
  });

  it("keeps retrying after a failure so a later match can still get art", async () => {
    failBundles = new Set(["gameplay"]);
    await ensureGameplayAssets();
    failBundles = new Set();
    await ensureGameplayAssets();
    expect(bundleCalls.filter((b) => b === "gameplay")).toHaveLength(2);
    expect(spriteTexture("ball-red.png")).not.toBeNull();
    expect(spriteDebugState().error).toBeNull();
  });

  it("concurrent callers share one in-flight load rather than racing", async () => {
    await Promise.all([ensureGameplayAssets(), ensureGameplayAssets(), ensureGameplayAssets()]);
    expect(bundleCalls.filter((b) => b === "gameplay")).toHaveLength(1);
  });

  it("keeps every particle frame on one source so the effect layer stays one draw call", async () => {
    await ensureGameplayAssets();
    const sources = new Set(
      [
        "particle-circle.png",
        "particle-square.png",
        "particle-triangle.png",
        "particle-star.png",
        "particle-streak.png",
        "particle-debris.png",
        "particle-splat.png",
        "particle-ring.png",
      ].map((n) => spriteTexture(n)?.source),
    );
    expect(sources.size).toBe(1);
    expect(sources.has(undefined)).toBe(false);
  });

  it("initialises the Assets pipeline exactly once across both entry points", async () => {
    // `initAssets` and `ensureGameplayAssets` run CONCURRENTLY at match start.
    // `Assets.init` is not idempotent: the second call leaves the cache
    // unpopulated, so the atlas silently vanishes for the whole session.
    await Promise.all([initAssets(), ensureGameplayAssets()]);
    await initAssets();
    expect(initCalls).toBe(1);
    expect(spriteTexture("ball-red.png")).not.toBeNull();
    expect(spriteTexture("pixel-space.png")).not.toBeNull();
  });
});

describe("gameplay bundle progress (ticket 87)", () => {
  it("reports progress to the caller, ending at 1", async () => {
    const seen: number[] = [];
    await ensureGameplayAssets((p) => seen.push(p));
    expect(seen).toEqual([0.25, 0.6, 1]);
  });

  it("never reports progress going backwards", async () => {
    progressSteps = [0.5, 0.3, 0.9, 0.9, 1];
    const seen: number[] = [];
    await ensureGameplayAssets((p) => seen.push(p));
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(seen.at(-1)).toBe(1);
  });

  it("clamps out-of-range progress into 0..1", async () => {
    progressSteps = [-0.2, 1.4];
    const seen: number[] = [];
    await ensureGameplayAssets((p) => seen.push(p));
    expect(seen).toEqual([0, 1]);
  });

  it("gives every concurrent caller progress from the one shared load", async () => {
    const a: number[] = [];
    const b: number[] = [];
    await Promise.all([
      ensureGameplayAssets((p) => a.push(p)),
      ensureGameplayAssets((p) => b.push(p)),
    ]);
    expect(bundleCalls.filter((n) => n === "gameplay")).toHaveLength(1);
    expect(a.at(-1)).toBe(1);
    expect(b.at(-1)).toBe(1);
  });

  it("tells a late joiner where the load already is", async () => {
    let release: () => void = () => undefined;
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = ensureGameplayAssets();
    await Promise.resolve();
    await Promise.resolve();
    const late: number[] = [];
    const second = ensureGameplayAssets((p) => late.push(p));
    expect(late[0]).toBe(1);
    release();
    await Promise.all([first, second]);
  });

  it("is silent when the bundle is already loaded", async () => {
    await ensureGameplayAssets();
    const seen: number[] = [];
    await ensureGameplayAssets((p) => seen.push(p));
    expect(seen).toEqual([]);
  });

  it("finishes at 1 even when the load failed, so a progress bar cannot hang", async () => {
    failBundles = new Set(["gameplay"]);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    progressSteps = [0.4];
    const seen: number[] = [];
    await ensureGameplayAssets((p) => seen.push(p));
    expect(seen.at(-1)).toBe(1);
  });
});
