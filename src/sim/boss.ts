// Doh boss logic (ticket 49, spec §4/§5): round 33 boss finale.
// Pure, deterministic, headless — no DOM/Pixi/network ever. All patterns
// derive from tick count (zero RNG, capsule-script philosophy).
import { FIELD_W, PADDLE_Y, TICK_DT } from "./constants";
import { aabbOverlap } from "./collision";
import type { Box } from "./collision";

/** Boss box: 48×32 moai at the field top (matches DOH_BOSS sprite, §13). */
export const BOSS_W = 48;
export const BOSS_H = 32;
/** Classic-accurate hit count: Doh takes 16 ball hits (1986 original ~14–16). */
export const BOSS_MAX_HP = 16;
/** Phase 2 begins at or below this HP (final-tier escalation). */
export const BOSS_PHASE2_HP = 8;
/** Boss vertical anchor: top of the gold arena, below the top wall. */
export const BOSS_Y = 44;
/** Phase 2 horizontal drift: sine amplitude in field units. */
export const BOSS_DRIFT_AMPLITUDE = 40;
/** Drift period in ticks (4 s at 60 Hz). */
export const BOSS_DRIFT_PERIOD = 240;
/** Phase 1 fire interval (ticks): 1 projectile every 2.5 s. */
export const BOSS_FIRE_INTERVAL_P1 = 150;
/** Phase 2 fire interval (ticks): 3-projectile spread every 2 s. */
export const BOSS_FIRE_INTERVAL_P2 = 120;
/** Projectile size (square) and speed. Size lives in shared/protocol (render seam). */
import { BOSS_PROJECTILE_SIZE } from "shared/protocol";
export const BOSS_PROJECTILE_SIZE_SIM = BOSS_PROJECTILE_SIZE;
export const BOSS_PROJECTILE_SPEED = 90;

export interface BossProjectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface BossState {
  x: number;
  y: number;
  hp: number;
  /** 1 = opening, 2 = final tier (≤ BOSS_PHASE2_HP). */
  phase: 1 | 2;
  projectiles: BossProjectile[];
  dead: boolean;
}

/** Boss box for collision (center-anchored, matches render anchor). */
export function bossBox(b: BossState): Box {
  return { x: b.x, y: b.y, w: BOSS_W, h: BOSS_H };
}

/** Deterministic fire pattern: aimed at paddle x with a fixed spread. */
export function spawnProjectiles(
  b: BossState,
  tick: number,
  paddleX: number,
): void {
  const dx = paddleX - b.x;
  const dy = PADDLE_Y - b.y;
  const len = Math.hypot(dx, dy) || 1;
  const speed = BOSS_PROJECTILE_SPEED;
  const base = { vx: (dx / len) * speed, vy: (dy / len) * speed };
  b.projectiles.push({ x: b.x, y: b.y + BOSS_H / 2, vx: base.vx, vy: base.vy });
  if (b.phase === 2) {
    // Fixed ±20° spread — deterministic, no RNG.
    for (const spread of [Math.PI / 9, -Math.PI / 9]) {
      const a = Math.atan2(base.vy, base.vx) + spread;
      b.projectiles.push({
        x: b.x,
        y: b.y + BOSS_H / 2,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
      });
    }
  }
  // Pattern is tick-interval driven, not tick-seeded — tick kept for API symmetry.
  if (tick < 0) throw new Error("negative tick");
}

/** Advance boss + projectiles one tick. Returns true if the paddle died. */
export function stepBoss(
  b: BossState,
  tick: number,
  paddle: Box,
): { paddleDied: boolean; fired: boolean } {
  if (b.dead) return { paddleDied: false, fired: false };

  // Phase 2 drift: sine from tick, clamped to the field.
  if (b.phase === 2) {
    const t = (tick % BOSS_DRIFT_PERIOD) / BOSS_DRIFT_PERIOD;
    b.x = FIELD_W / 2 + Math.sin(t * Math.PI * 2) * BOSS_DRIFT_AMPLITUDE;
  }

  // Deterministic fire cadence.
  const interval = b.phase === 2 ? BOSS_FIRE_INTERVAL_P2 : BOSS_FIRE_INTERVAL_P1;
  let fired = false;
  if (tick > 0 && tick % interval === 0) {
    spawnProjectiles(b, tick, paddle.x);
    fired = true;
  }

  // Projectiles: move, cull below field, kill paddle on contact.
  let paddleDied = false;
  const size = BOSS_PROJECTILE_SIZE;
  for (let i = b.projectiles.length - 1; i >= 0; i--) {
    const p = b.projectiles[i];
    if (!p) continue;
    p.x += p.vx * TICK_DT;
    p.y += p.vy * TICK_DT;
    if (p.y - size / 2 > 256 || p.x < -size || p.x > FIELD_W + size) {
      b.projectiles.splice(i, 1);
      continue;
    }
    if (
      aabbOverlap(
        p.x, p.y, size, size,
        paddle.x, paddle.y, paddle.w, paddle.h,
      )
    ) {
      b.projectiles.splice(i, 1);
      paddleDied = true;
    }
  }
  return { paddleDied, fired };
}

/** Ball hit: HP−1, phase transition, death at 0. Returns true on death. */
export function hitBoss(b: BossState): boolean {
  if (b.dead) return false;
  b.hp--;
  if (b.hp <= BOSS_PHASE2_HP && b.phase === 1) b.phase = 2;
  if (b.hp <= 0) {
    b.dead = true;
    b.projectiles.length = 0;
    return true;
  }
  return false;
}

/** Fresh boss state for round 33. */
export function createBossState(): BossState {
  return {
    x: FIELD_W / 2,
    y: BOSS_Y,
    hp: BOSS_MAX_HP,
    phase: 1,
    projectiles: [],
    dead: false,
  };
}
