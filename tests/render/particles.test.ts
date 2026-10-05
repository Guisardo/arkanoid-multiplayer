// ParticleSystem (ADR 0009) — the pooled particle lifecycle.
//
// This suite runs under jsdom and primes the sprite cache with real Textures,
// which is the only way the particle path executes at all: `spriteTexture()`
// returns null without a DOM, so under the default node environment the whole
// system silently no-ops and 70% of this file goes untested. That is exactly
// the channel most likely to leak or drop particles, so it gets a real run.
// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest";
import { Texture } from "pixi.js";
import { ParticleSystem, PARTICLE_POOL } from "render/particles";
import { rememberTexture, SPRITE_PATHS } from "render/spriteSheet";
import type { BurstRecipe } from "render/effectPresets";
import type { Particle as PixiParticle } from "pixi.js";

/** particleChildren is typed IParticle; alpha/tint are on the concrete Particle. */
type Shaded = PixiParticle;

/** Prime every particle frame so `spriteTexture()` resolves. */
function primeFrames(): void {
  for (const name of Object.values(SPRITE_PATHS.particles)) {
    rememberTexture(name, Texture.EMPTY);
  }
}

function recipe(over: Partial<BurstRecipe> = {}): BurstRecipe {
  return {
    shape: "circle",
    count: 8,
    speed: 60,
    life: 0.4,
    gravity: 100,
    scale: 0.5,
    color: 0xff8800,
    ...over,
  };
}

beforeEach(() => {
  primeFrames();
});

describe("ParticleSystem — pool", () => {
  it("prewarms the full pool so a burst never allocates mid-match", () => {
    const ps = new ParticleSystem();
    expect(ps.pooledCount).toBe(PARTICLE_POOL);
    expect(ps.activeCount).toBe(0);
    ps.destroy();
  });

  it("prewarms nothing without an atlas — the headless no-op path", () => {
    // Forget every frame, so the constructor sees no texture at all.
    for (const name of Object.values(SPRITE_PATHS.particles)) {
      rememberTexture(name, null as never);
    }
    const ps = new ParticleSystem();
    expect(ps.view).toBeNull();
    expect(ps.pooledCount).toBe(0);
    // A burst against a missing atlas is a no-op, never a throw.
    expect(() => { ps.burst({ x: 1, y: 1 }, recipe()); }).not.toThrow();
    expect(ps.activeCount).toBe(0);
    ps.destroy();
    primeFrames();
  });
});

describe("ParticleSystem — bursts", () => {
  it("emits exactly the recipe's particle count", () => {
    const ps = new ParticleSystem();
    ps.burst({ x: 40, y: 60 }, recipe({ count: 12 }));
    expect(ps.activeCount).toBe(12);
    expect(ps.pooledCount).toBe(PARTICLE_POOL - 12);
    expect(ps.view?.particleChildren.length).toBe(12);
    ps.destroy();
  });

  it("positions particles at the burst point and tints them per recipe", () => {
    const ps = new ParticleSystem();
    ps.burst({ x: 40, y: 60 }, recipe({ count: 3 }));
    const children = ps.view!.particleChildren as Shaded[];
    for (const p of children) {
      expect(p.x).toBe(40);
      expect(p.y).toBe(60);
      expect(p.alpha).toBe(1);
    }
    expect(children[0]!.tint).toBe(0xff8800);
    ps.destroy();
  });

  it("spreads particles around the burst rather than stacking them", () => {
    const ps = new ParticleSystem();
    ps.burst({ x: 40, y: 60 }, recipe({ count: 10, speed: 50 }));
    // Positions start at the burst point; the golden-angle spread shows up as
    // each particle leaves along its own heading once the sim advances.
    expect(new Set(ps.view!.particleChildren.map((p) => p.x)).size).toBe(1);
    ps.update(0.2, false);
    const xs = new Set(ps.view!.particleChildren.map((p) => p.x.toFixed(3)));
    const ys = new Set(ps.view!.particleChildren.map((p) => p.y.toFixed(3)));
    expect(xs.size).toBeGreaterThan(2);
    expect(ys.size).toBeGreaterThan(2);
    ps.destroy();
  });

  it("uses the recipe's particle shape frame", () => {
    const ps = new ParticleSystem();
    ps.burst({ x: 0, y: 0 }, recipe({ shape: "star", count: 1 }));
    expect(ps.view!.particleChildren[0]!.texture).toBe(Texture.EMPTY);
    ps.destroy();
  });

  it("drops the rest of a burst rather than allocating when the pool runs dry", () => {
    const ps = new ParticleSystem();
    ps.burst({ x: 0, y: 0 }, recipe({ count: PARTICLE_POOL }));
    expect(ps.pooledCount).toBe(0);
    // 50 more than the pool can hold: the extras must be dropped, not allocated.
    ps.burst({ x: 0, y: 0 }, recipe({ count: 50 }));
    expect(ps.activeCount).toBe(PARTICLE_POOL);
    expect(ps.pooledCount).toBe(0);
    ps.destroy();
  });
});

describe("ParticleSystem — simulation", () => {
  it("moves particles along their burst heading", () => {
    const ps = new ParticleSystem();
    ps.burst({ x: 0, y: 0 }, recipe({ count: 4, speed: 100, gravity: 0 }));
    const start = ps.view!.particleChildren.map((p) => ({ x: p.x, y: p.y }));
    ps.update(0.1, false);
    let moved = 0;
    ps.view!.particleChildren.forEach((p, i) => {
      if (p.x !== start[i]!.x || p.y !== start[i]!.y) moved++;
    });
    expect(moved).toBe(4);
    ps.destroy();
  });

  it("applies gravity as downward acceleration", () => {
    // A single particle leaves along its own heading, so use a burst whose
    // first particle travels horizontally: only gravity can move it in y.
    const ps = new ParticleSystem();
    ps.burst({ x: 0, y: 0 }, recipe({ count: 1, speed: 100, gravity: 200 }));
    const p = ps.view!.particleChildren[0] as Shaded;
    const x0 = p.x;
    expect(p.y).toBe(0);
    ps.update(0.1, false);
    // Heading is +x, so x moved by the launch speed and nothing else.
    expect(p.x).toBeGreaterThan(x0);
    const y1 = p.y;
    // Gravity accumulates: the second step covers more ground than the first.
    ps.update(0.1, false);
    expect(Math.abs(p.y - y1)).toBeGreaterThan(Math.abs(y1));
    ps.destroy();
  });

  it("holds every particle in place while frozen (hit-stop)", () => {
    const ps = new ParticleSystem();
    ps.burst({ x: 10, y: 10 }, recipe({ count: 5 }));
    const snapshot = ps.view!.particleChildren.map((p) => ({ x: p.x, y: p.y }));
    ps.update(0.5, true);
    ps.view!.particleChildren.forEach((p, i) => {
      expect(p.x).toBe(snapshot[i]!.x);
      expect(p.y).toBe(snapshot[i]!.y);
    });
    expect(ps.activeCount).toBe(5);
    ps.destroy();
  });

  it("fades particles out over the last third of their life", () => {
    const ps = new ParticleSystem();
    ps.burst({ x: 0, y: 0 }, recipe({ count: 1, life: 1 }));
    const p = ps.view!.particleChildren[0] as Shaded;
    // Mid-life (50% remaining): fully opaque.
    ps.update(0.5, false);
    expect(p.alpha).toBe(1);
    // Into the tail (5% remaining): fading.
    ps.update(0.45, false);
    expect(p.alpha).toBeLessThan(1);
    expect(p.alpha).toBeGreaterThan(0);
    ps.destroy();
  });

  it("retires expired particles and returns them to the pool", () => {
    const ps = new ParticleSystem();
    ps.burst({ x: 0, y: 0 }, recipe({ count: 4, life: 0.2 }));
    expect(ps.activeCount).toBe(4);
    ps.update(0.25, false);
    expect(ps.activeCount).toBe(0);
    expect(ps.pooledCount).toBe(PARTICLE_POOL);
    expect(ps.view!.particleChildren.length).toBe(0);
    ps.destroy();
  });

  it("expires a staggered burst without losing particles", () => {
    const ps = new ParticleSystem();
    ps.burst({ x: 0, y: 0 }, recipe({ count: 6, life: 0.1 }));
    ps.burst({ x: 0, y: 0 }, recipe({ count: 6, life: 0.5 }));
    expect(ps.activeCount).toBe(12);
    ps.update(0.2, false);
    // The short-lived burst is gone; the long-lived one is untouched.
    expect(ps.activeCount).toBe(6);
    expect(ps.pooledCount).toBe(PARTICLE_POOL - 6);
    ps.destroy();
  });

  it("an update with nothing alive is a cheap no-op", () => {
    const ps = new ParticleSystem();
    expect(() => {
      ps.update(0.016, false);
    }).not.toThrow();
    expect(ps.activeCount).toBe(0);
    ps.destroy();
  });
});

describe("ParticleSystem — lifecycle", () => {
  it("reset clears live particles and keeps the pool intact", () => {
    const ps = new ParticleSystem();
    ps.burst({ x: 0, y: 0 }, recipe({ count: 20 }));
    ps.reset();
    expect(ps.activeCount).toBe(0);
    expect(ps.pooledCount).toBe(PARTICLE_POOL);
    expect(ps.view!.particleChildren.length).toBe(0);
    // ...and the system is still usable afterwards.
    ps.burst({ x: 0, y: 0 }, recipe({ count: 5 }));
    expect(ps.activeCount).toBe(5);
    ps.destroy();
  });

  it("reset on a no-atlas system does not throw", () => {
    for (const name of Object.values(SPRITE_PATHS.particles)) {
      rememberTexture(name, null as never);
    }
    const ps = new ParticleSystem();
    expect(() => { ps.reset(); }).not.toThrow();
    expect(() => { ps.destroy(); }).not.toThrow();
    primeFrames();
  });

  it("destroy releases the pool and the container", () => {
    const ps = new ParticleSystem();
    ps.burst({ x: 0, y: 0 }, recipe({ count: 3 }));
    ps.destroy();
    expect(ps.pooledCount).toBe(0);
    expect(ps.activeCount).toBe(0);
  });
});