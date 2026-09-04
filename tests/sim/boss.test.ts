// Doh boss logic tests (ticket 49): hit counting, phase transitions,
// deterministic fire patterns, projectile paddle death, defeat → clear,
// mode-exclusion constraints (Duel/Attack can never reach round 33).
import { describe, expect, it } from "vitest";
import {
  BOSS_MAX_HP,
  BOSS_PHASE2_HP,
  BOSS_FIRE_INTERVAL_P1,
  BOSS_FIRE_INTERVAL_P2,
  BOSS_DRIFT_AMPLITUDE,
  createBossState,
  hitBoss,
  spawnProjectiles,
  stepBoss,
  bossBox,
} from "sim/boss";
import { assertDuelRound, DUEL_MAX_ROUND } from "sim/duel";
import { assertAttackRound, ATTACK_MAX_ROUND, getLevel } from "content/levels";
import { createRoundSim } from "sim/roundSim";
import { createSharedFieldSim } from "sim/sharedField";
import { createMultiFieldSession } from "sim/multiField";
import type { InputFrame } from "shared/protocol";

const PADDLE = { x: 104, y: 242, w: 32, h: 6 };

function idleFrame(tick: number): InputFrame {
  return {
    player: 0,
    tick,
    axisX: 0,
    axisY: 0,
    launch: false,
    actions: { cycleForward: false, cycleBack: false, fire: [false, false, false, false] },
  };
}

describe("boss state", () => {
  it("starts at full HP, phase 1, centered, no projectiles", () => {
    const b = createBossState();
    expect(b.hp).toBe(BOSS_MAX_HP);
    expect(b.phase).toBe(1);
    expect(b.x).toBe(104); // FIELD_W / 2
    expect(b.projectiles).toHaveLength(0);
    expect(b.dead).toBe(false);
  });

  it("hitBoss decrements HP and transitions to phase 2 at the threshold", () => {
    const b = createBossState();
    for (let i = 0; i < BOSS_MAX_HP - BOSS_PHASE2_HP - 1; i++) hitBoss(b);
    expect(b.phase).toBe(1);
    hitBoss(b); // reaches BOSS_PHASE2_HP
    expect(b.phase).toBe(2);
    expect(b.dead).toBe(false);
  });

  it("hitBoss kills at 0 HP exactly once", () => {
    const b = createBossState();
    let dead = false;
    for (let i = 0; i < BOSS_MAX_HP; i++) dead = hitBoss(b) || dead;
    expect(b.dead).toBe(true);
    expect(dead).toBe(true);
    expect(hitBoss(b)).toBe(false); // no double-death
  });

  it("death clears projectiles", () => {
    const b = createBossState();
    spawnProjectiles(b, 90, PADDLE.x);
    expect(b.projectiles.length).toBeGreaterThan(0);
    while (!hitBoss(b)) { /* drain */ }
    expect(b.projectiles).toHaveLength(0);
  });
});

describe("deterministic fire pattern", () => {
  it("phase 1 fires exactly 1 projectile per interval tick", () => {
    const b = createBossState();
    const r = stepBoss(b, BOSS_FIRE_INTERVAL_P1, PADDLE);
    expect(r.fired).toBe(true);
    expect(b.projectiles).toHaveLength(1);
  });

  it("phase 2 fires a 3-projectile spread per interval tick", () => {
    const b = createBossState();
    while (b.phase === 1) hitBoss(b);
    const r = stepBoss(b, BOSS_FIRE_INTERVAL_P2, PADDLE);
    expect(r.fired).toBe(true);
    expect(b.projectiles).toHaveLength(3);
  });

  it("does not fire on non-interval ticks", () => {
    const b = createBossState();
    const r = stepBoss(b, BOSS_FIRE_INTERVAL_P1 - 1, PADDLE);
    expect(r.fired).toBe(false);
    expect(b.projectiles).toHaveLength(0);
  });

  it("phase 2 drifts on a deterministic sine, clamped to the field", () => {
    const b = createBossState();
    while (b.phase === 1) hitBoss(b);
    const seen = new Set<number>();
    for (let t = 1; t <= BOSS_DRIFT_AMPLITUDE * 4; t++) {
      stepBoss(b, t, PADDLE);
      seen.add(Math.round(b.x));
    }
    expect(seen.size).toBeGreaterThan(1); // actually moves
    expect([...seen].every((x) => x >= 0 && x <= 208)).toBe(true);
  });

  it("identical tick sequences produce identical projectile states", () => {
    const run = (): string => {
      const b = createBossState();
      while (b.phase === 1) hitBoss(b);
      let out = "";
      for (let t = 1; t <= 240; t++) {
        stepBoss(b, t, { ...PADDLE, x: 104 + (t % 40) });
        out += `${b.x.toFixed(3)},${b.projectiles.map((p) => `${p.x.toFixed(2)}:${p.y.toFixed(2)}`).join("|")};`;
      }
      return out;
    };
    expect(run()).toBe(run());
  });
});

describe("projectile paddle death", () => {
  it("projectile aimed at a stationary paddle kills it", () => {
    const b = createBossState();
    spawnProjectiles(b, 0, PADDLE.x);
    let died = false;
    for (let t = 1; t <= 300 && !died; t++) {
      const r = stepBoss(b, t, PADDLE);
      died = r.paddleDied;
    }
    expect(died).toBe(true);
  });

  it("projectiles cull below the field", () => {
    const b = createBossState();
    spawnProjectiles(b, 0, 0); // aimed far left — misses the paddle
    // Step odd ticks only: never a fire-interval multiple (90/60), so no
    // new projectiles spawn while the first one falls out of the field.
    for (let t = 1; t <= 399; t += 2) stepBoss(b, t, PADDLE);
    expect(b.projectiles).toHaveLength(0);
  });
});

describe("round 33 sim integration", () => {
  it("round 33 snapshot carries boss state; other rounds do not", () => {
    const bossSim = createRoundSim(getLevel(33), { lives: 3, score: 0 });
    const snap33 = bossSim.snapshot();
    expect(snap33.boss).toBeDefined();
    expect(snap33.boss?.hp).toBe(BOSS_MAX_HP);

    const normalSim = createRoundSim(getLevel(1), { lives: 3, score: 0 });
    expect(normalSim.snapshot().boss).toBeUndefined();
  });

  it("ball hitting the boss decrements HP and emits bossHit", () => {
    const sim = createRoundSim(getLevel(33), { lives: 3, score: 0 });
    // Launch, then teleport the ball into the boss box heading up.
    sim.step([{ ...idleFrame(0), launch: true }]);
    sim.debugSetBall(104, 80, 0, -174);
    const before = sim.snapshot().boss?.hp ?? 0;
    for (let t = 0; t < 30; t++) sim.step([idleFrame(t)]);
    const snap = sim.snapshot();
    expect(snap.boss?.hp).toBeLessThan(before);
    expect(snap.events.some((e) => e.type === "bossHit")).toBe(true);
  });

  it("16 ball hits defeat the boss and clear the round", () => {
    // lives 99: boss projectiles kill an idle paddle — the test hammers the
    // boss via debug ball placement, so paddle deaths must not end the run.
    const sim = createRoundSim(getLevel(33), { lives: 99, score: 0 });
    sim.step([{ ...idleFrame(0), launch: true }]);
    for (let t = 0; t < 4000 && sim.snapshot().phase !== "roundClear"; t += 20) {
      const boss = sim.snapshot().boss;
      if (boss && !boss.dead) {
        // Place once per batch — the ball then travels to the boss freely.
        sim.debugSetBall(boss.x, boss.y + 40, 0, -174);
      }
      for (let s = 0; s < 20; s++) sim.step([idleFrame(t + s)]);
    }
    const snap = sim.snapshot();
    expect(snap.phase).toBe("roundClear");
    expect(snap.boss?.dead).toBe(true);
    expect(snap.events.some((e) => e.type === "bossDead")).toBe(true);
  });

  it("clearing all bricks while the boss lives does NOT clear the round", () => {
    const sim = createRoundSim(getLevel(33), { lives: 3, score: 0 });
    // Drain destructibles via the assist hook (removes lowest bricks).
    let removed = 0;
    do {
      removed = sim.clearLowestBricks(20);
    } while (removed > 0);
    expect(sim.snapshot().phase).not.toBe("roundClear");
    expect(sim.snapshot().boss?.dead).toBe(false);
  });

  it("shared-field coop round 33 carries the boss and clears on its death", () => {
    // Team pool 3×players is small vs projectile deaths — but the shared
    // ball-loss path only triggers when balls hit zero; debug placement
    // re-serves immediately, so the run survives to the boss's death.
    const sim = createSharedFieldSim(getLevel(33), {
      placement: "A",
      ballModel: "shared",
      playerCount: 2,
    });
    const snap0 = sim.snapshot();
    expect(snap0.boss).toBeDefined();
    // Launch and hammer the boss via debug ball placement (once per batch).
    sim.step([
      { ...idleFrame(0), launch: true },
      idleFrame(1),
    ]);
    for (let t = 0; t < 4000 && sim.snapshot().phase !== "roundClear"; t += 20) {
      const boss = sim.snapshot().boss;
      if (boss && !boss.dead) sim.debugSetBall(boss.x, boss.y + 40, 0, -174);
      for (let s = 0; s < 20; s++) sim.step([idleFrame(t + s), idleFrame(t + s)]);
    }
    expect(sim.snapshot().phase).toBe("roundClear");
    expect(sim.snapshot().boss?.dead).toBe(true);
  });

  it("Race (multiField) can reach round 33; Attack cannot (maxRound ceiling)", () => {
    const race = createMultiFieldSession({
      playerCount: 2,
      config: { structure: "oneOff", bestOf: 1, levelSelection: "hostPick", hostPickRound: 33, timeCapTicks: null },
    });
    expect(race.state().round).toBe(33);

    expect(() =>
      createMultiFieldSession({
        playerCount: 2,
        config: { structure: "oneOff", bestOf: 1, levelSelection: "hostPick", hostPickRound: 33, timeCapTicks: null, maxRound: 32 },
      }),
    ).toThrow();
  });
});

describe("mode exclusion constraints (regression)", () => {
  it("Duel ceiling is 32 and round 33 is rejected", () => {
    expect(DUEL_MAX_ROUND).toBe(32);
    expect(() => { assertDuelRound(32); }).not.toThrow();
    expect(() => { assertDuelRound(33); }).toThrow();
  });

  it("Attack ceiling is 32 and round 33 is rejected", () => {
    expect(ATTACK_MAX_ROUND).toBe(32);
    expect(() => { assertAttackRound(32); }).not.toThrow();
    expect(() => { assertAttackRound(33); }).toThrow();
  });

  it("bossBox matches the sprite footprint", () => {
    const b = createBossState();
    const box = bossBox(b);
    expect(box.w).toBe(48);
    expect(box.h).toBe(32);
  });
});
