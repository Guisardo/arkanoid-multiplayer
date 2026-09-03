// Bot input source (spec §7): one implementation, three data-driven parameter
// sets. Produces Input frames through the same pipeline as a human local
// player. Deterministic given seed + state sequence — seeded LCG, zero global RNG.
import type { InputFrame, InputFrameActions, Snapshot } from "shared/protocol";
import { EMPTY_ACTIONS } from "shared/protocol";
import { FIELD_H, PADDLE_Y } from "./constants";

export type BotDifficulty = "easy" | "normal" | "hard";

export interface BotParams {
  /** Aim error added to target x, ± units. */
  aimNoise: number;
  /** Lock onto descending ball at y > engagementY × FIELD_H. */
  engagementY: number;
  /** Launch timing tick range [min, max). */
  launchMin: number;
  launchMax: number;
  /** Meter-spend threshold. */
  meterThreshold: number;
  /** Fire chance per tick. */
  fireChance: number;
  /** Hard targets smartly (Race leader / downed teammate in assist). */
  smartTargeting: boolean;
}

export const BOT_PARAMS: Record<BotDifficulty, BotParams> = {
  easy: {
    aimNoise: 24,
    engagementY: 0.65,
    launchMin: 60,
    launchMax: 240,
    meterThreshold: 80,
    fireChance: 0.002,
    smartTargeting: false,
  },
  normal: {
    aimNoise: 8,
    engagementY: 0.4,
    launchMin: 67,
    launchMax: 127,
    meterThreshold: 30,
    fireChance: 0.008,
    smartTargeting: false,
  },
  hard: {
    aimNoise: 2,
    engagementY: 0.25,
    launchMin: 40,
    launchMax: 120,
    meterThreshold: 20,
    fireChance: 0.015,
    smartTargeting: true,
  },
};

/** Deterministic LCG (mulberry-style constants) — never Math.random. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface BotSource {
  sampleFrame(tick: number, snap: Snapshot): InputFrame;
}

export function createBot(player: number, difficulty: BotDifficulty, seed: number): BotSource {
  const params = BOT_PARAMS[difficulty];
  const rng = lcg(seed);
  let noise = 0;
  let lastDescentKey = "";
  let launchAtTick = params.launchMin + Math.floor(rng() * (params.launchMax - params.launchMin));

/** Ball landing x: straight-line projection with wall bounces. */
  function predictLandingX(bx: number, by: number, bvx: number, bvy: number, targetY: number): number {
    if (bvy >= 0) return bx;
    const t = (targetY - by) / bvy;
    let x = bx + bvx * t;
    const span = 208 - 6;
    x = ((x - 3) % (2 * span) + 2 * span) % (2 * span);
    if (x > span) x = 2 * span - x;
    return x + 3;
  }

  /** Center x of the lowest remaining destructible brick column, or -1. */
  function lowestBrickColumn(snap: Snapshot): number {
    const COLS = 13;
    for (let i = snap.bricks.length - 1; i >= 0; i--) {
      const cell = snap.bricks[i] ?? 0;
      if (cell !== 0 && cell !== 13) {
        return (i % COLS) * 16 + 8;
      }
    }
    return -1;
  }

  return {
    sampleFrame(tick, snap) {
      const me = snap.players.find((p) => p.player === player);
      if (!me) return { player, tick, axisX: 0, axisY: 0, launch: false, actions: EMPTY_ACTIONS };

      const attachedBall = snap.balls.find((b) => b.attachedTo === player);
      if (attachedBall) {
        const launch = tick >= launchAtTick;
        if (launch) launchAtTick = Number.MAX_SAFE_INTEGER;
        return { player, tick, axisX: 0, axisY: 0, launch, actions: EMPTY_ACTIONS };
      }

      // Most threatening descending ball past the engagement line.
      const line = params.engagementY * FIELD_H;
      let target: { x: number; y: number; vx: number; vy: number; id: number } | null = null;
      let bestY = -1;
      for (let i = 0; i < snap.balls.length; i++) {
        const b = snap.balls[i];
        if (!b || b.vy <= 0) continue;
        if (b.y <= line) continue;
        if (b.y > bestY) {
          bestY = b.y;
          target = { x: b.x, y: b.y, vx: b.vx, vy: b.vy, id: i };
        }
      }

      // Capsule scan (shared by idle + catch behavior).
      let capsuleX = -1;
      let capsuleY = -1;
      for (const c of snap.capsules) {
        if (c.y > capsuleY) {
          capsuleY = c.y;
          capsuleX = c.x;
        }
      }

      let axisX = 0;
      if (target) {
        // Fresh aim noise per descent phase (ball id + descent counter): a new
        // descent after a paddle/brick bounce re-rolls, breaking periodic orbits.
        const key = `${String(target.id)}:${String(Math.round(target.y / 8))}`;
        if (key !== lastDescentKey) {
          noise = (rng() * 2 - 1) * params.aimNoise;
          lastDescentKey = key;
        }
        const landing = predictLandingX(target.x, target.y, target.vx, target.vy, PADDLE_Y);
        let desired = landing + noise;
        if (params.smartTargeting) {
          // Aim the deflection: offset the paddle so the ball bounces toward
          // the lowest remaining brick column (offset-deflect, spec §5).
          const aimAt = lowestBrickColumn(snap);
          if (aimAt >= 0) {
            // paddle offset from ball landing → deflection toward aimAt
            const offset = Math.max(-14, Math.min(14, (aimAt - landing) * 0.25));
            desired = landing + offset;
          }
        }
        const diff = desired - me.paddle.x;
        if (Math.abs(diff) > 1) axisX = diff > 0 ? 1 : -1;
      } else {
        lastDescentKey = "";
        // Idle: catch a falling capsule if reachable; else (hard) park under
        // the lowest remaining brick column to break orbits, others center.
        let desired = 104;
        if (capsuleX >= 0) {
          desired = capsuleX;
        } else if (params.smartTargeting) {
          const lowest = lowestBrickColumn(snap);
          if (lowest >= 0) desired = lowest;
        }
        const diff = desired - me.paddle.x;
        if (Math.abs(diff) > 4) axisX = diff > 0 ? 1 : -1;
      }

      const actions: InputFrameActions = {
        cycleForward: false,
        cycleBack: false,
        fire: [false, false, false, false],
      };
      if (me.meter >= params.meterThreshold && rng() < params.fireChance) {
        const slot = rng() < 0.5 ? 0 : 1;
        const fire: [boolean, boolean, boolean, boolean] = [...actions.fire] as [
          boolean, boolean, boolean, boolean,
        ];
        fire[slot] = true;
        actions.fire = fire;
      }

      return { player, tick, axisX, axisY: 0, launch: false, actions };
    },
  };
}
