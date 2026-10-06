// Shared shapes + reset functions for the pooled simulation objects (ADR 0006).
// One definition per object type so `roundSim`, `duel` and `sharedField` pool
// identically-shaped objects and so the reset contract has a single place to be
// tested. Pure data: no DOM/Pixi/network.
import type { CapsuleTypeId } from "shared/protocol";

export interface BallState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  attachedTo: number | null;
  owner: number | null;

}

export interface CapsuleState {
  x: number;
  y: number;
  type: CapsuleTypeId;
}

/** All-zero ball: the canonical starting shape for `Pool.acquire`. */
export function makeBallState(): BallState {
  return {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    attachedTo: null,
    owner: null,

  };
}

/** Clear every ball field. Keeping this exhaustive is the ADR's contract. */
export function resetBallState(b: BallState): void {
  b.x = 0;
  b.y = 0;
  b.vx = 0;
  b.vy = 0;
  b.attachedTo = null;
  b.owner = null;

}

/** All-zero capsule (type falls back to the neutral `E`). */
export function makeCapsuleState(): CapsuleState {
  return { x: 0, y: 0, type: "E" };
}

/** Clear every capsule field. */
export function resetCapsuleState(c: CapsuleState): void {
  c.x = 0;
  c.y = 0;
  c.type = "E";
}

/** Fields a spawn may override; everything else stays at its zero value. */
export interface BallInit {
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  attachedTo: number | null;
  owner: number | null;

}

/**
 * Fill a pooled ball from `init`. Every field is assigned explicitly so a
 * spawn can never inherit a stale value even if the pool's `resetFn` were
 * incomplete.
 */
export function applyBallInit(b: BallState, init: BallInit): BallState {
  b.x = init.x;
  b.y = init.y;
  b.vx = init.vx ?? 0;
  b.vy = init.vy ?? 0;
  b.attachedTo = init.attachedTo;
  b.owner = init.owner;

  return b;
}

/** Fill a pooled capsule. */
export function applyCapsuleInit(c: CapsuleState, x: number, y: number, type: CapsuleTypeId): CapsuleState {
  c.x = x;
  c.y = y;
  c.type = type;
  return c;
}
