// ADR 0006 object pooling (ticket 94): pool mechanics + the reset contract.
// The reset contract is the ADR's stated risk ("manual resetFn must reset all
// fields"), so the exhaustive test below is the guard rail: it dirties every
// field of the canonical object and asserts the reset restores it exactly.
import { describe, expect, it } from "vitest";
import { Pool } from "sim/pool";
import {
  applyBallInit,
  makeBallState,
  makeCapsuleState,
  resetBallState,
  resetCapsuleState,
  type BallState,
  type CapsuleState,
} from "sim/simState";
import {
  makeBossProjectile,
  resetBossProjectile,
  type BossProjectile,
} from "sim/boss";
import { POOL_PREWARM } from "sim/constants";

interface Token {
  id: number;
  label: string;
}

/**
 * Assert `reset` restores a *fully dirtied* object to exactly the canonical
 * fresh shape. A reset function that forgets a field fails here.
 */
function expectExhaustiveReset<T extends object>(
  fresh: T,
  reset: (obj: T) => void,
  dirtyValue: (key: string, freshValue: unknown) => unknown,
): void {
  const dirty = { ...fresh };
  for (const key of Object.keys(dirty)) {
    (dirty as Record<string, unknown>)[key] = dirtyValue(key, fresh[key as keyof T]);
  }
  reset(dirty);
  expect(dirty).toEqual(fresh);
}

describe("Pool<T> (ADR 0006)", () => {
  const makeToken = (): Token => ({ id: 0, label: "" });
  const resetToken = (t: Token): void => {
    t.id = 0;
    t.label = "";
  };

  it("acquire hands out fresh objects when the pool is empty", () => {
    const pool = new Pool<Token>(makeToken, resetToken);
    const a = pool.acquire();
    const b = pool.acquire();
    expect(a).not.toBe(b);
    expect(a).toEqual({ id: 0, label: "" });
    expect(pool.liveCount).toBe(2);
  });

  it("prewarm fills the free list without handing anything out", () => {
    const pool = new Pool<Token>(makeToken, resetToken);
    pool.prewarm(3);
    expect(pool.available).toBe(3);
    expect(pool.liveCount).toBe(0);
    expect(pool.acquire()).toEqual({ id: 0, label: "" });
    expect(pool.available).toBe(2);
  });

  it("prewarm of 0 or a negative count is a no-op", () => {
    const pool = new Pool<Token>(makeToken, resetToken);
    pool.prewarm(0);
    pool.prewarm(-5);
    expect(pool.available).toBe(0);
  });

  it("release resets and returns the object for reuse (no allocation)", () => {
    let created = 0;
    const pool = new Pool<Token>(() => {
      created++;
      return { id: 0, label: "" };
    }, resetToken);
    pool.prewarm(1);
    const first = pool.acquire();
    first.id = 7;
    first.label = "dirty";
    pool.release(first);
    expect(first).toEqual({ id: 0, label: "" });
    const second = pool.acquire();
    expect(second).toBe(first);
    expect(created).toBe(1);
  });

  it("exhaustion grows instead of failing — a lost ball is never dropped", () => {
    const pool = new Pool<Token>(makeToken, resetToken);
    pool.prewarm(2);
    const held = [pool.acquire(), pool.acquire(), pool.acquire(), pool.acquire()];
    expect(pool.available).toBe(0);
    expect(held.every((t) => t.label === "")).toBe(true);
    // Everything comes back and the pool is reusable.
    for (const t of held) pool.release(t);
    expect(pool.available).toBe(4);
    expect(pool.liveCount).toBe(0);
  });

  it("liveCount tracks acquire/release symmetrically", () => {
    const pool = new Pool<Token>(makeToken, resetToken);
    const a = pool.acquire();
    expect(pool.liveCount).toBe(1);
    pool.release(a);
    expect(pool.liveCount).toBe(0);
  });

  it("reused objects are handed out in reverse acquisition order (LIFO)", () => {
    const pool = new Pool<Token>(makeToken, resetToken);
    const a = pool.acquire();
    const b = pool.acquire();
    pool.release(a);
    pool.release(b);
    expect(pool.acquire()).toBe(b);
    expect(pool.acquire()).toBe(a);
  });
});

describe("prewarm sizes (ADR 0006)", () => {
  it("covers 4 serves + multiball, a full script's drops, and Doh's spread", () => {
    expect(POOL_PREWARM.balls).toBeGreaterThanOrEqual(12);
    expect(POOL_PREWARM.capsules).toBeGreaterThanOrEqual(10);
    expect(POOL_PREWARM.bossProjectiles).toBeGreaterThanOrEqual(3);
  });
});

describe("reset contract (the ADR's stated bug risk)", () => {
  it("resetBallState clears every field of a ball", () => {
    expectExhaustiveReset<BallState>(
      makeBallState(),
      resetBallState,
      (_k, fresh) => (typeof fresh === "number" ? 999 : "dirty"),
    );
  });

  it("resetCapsuleState clears every field of a capsule", () => {
    expectExhaustiveReset<CapsuleState>(
      makeCapsuleState(),
      resetCapsuleState,
      (_k, fresh) => (typeof fresh === "number" ? 999 : "M"),
    );
  });

  it("resetBossProjectile clears every field of a projectile", () => {
    expectExhaustiveReset<BossProjectile>(
      makeBossProjectile(),
      resetBossProjectile,
      () => 999,
    );
  });

  it("a reused ball never leaks the previous occupant's fields", () => {
    const pool = new Pool<BallState>(makeBallState, resetBallState);
    pool.prewarm(1);
    const first = applyBallInit(pool.acquire(), {
      x: 12, y: 34, vx: -5, vy: 6, attachedTo: 3, owner: 2,
    });
    pool.release(first);
    const second = pool.acquire();
    expect(second).toBe(first);
    expect(second).toEqual(makeBallState());
  });

  it("applyBallInit leaves unspecified fields at their zero value", () => {
    const fresh = applyBallInit(makeBallState(), {
      x: 1, y: 2, attachedTo: null, owner: 0,
    });
    expect(fresh).toEqual({
      x: 1, y: 2, vx: 0, vy: 0, attachedTo: null, owner: 0, ceilingHits: 0,
    });
  });
});
