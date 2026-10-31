// Laser wiring shared by the three Bolt consumers (roundSim, sharedField,
// duel; spec #140). The Bolt module owns motion and collision; this module
// owns what every sim must wire the same way around it: the exclusive E/C/L
// Paddle slot and its width rule, the Bolt hooks' event pairing, and the
// Armed fields a player snapshot carries. Each sim keeps its own `hitBrick`.
import { PADDLE_W } from "./constants";
import { CAPSULE_EFFECTS } from "./capsules";
import { bossBox, type BossState } from "./boss";
import type { BoltHooks } from "./bolts";
import {
  ARMED_EFFECT,
  BRICK_EMPTY,
  type CapsuleTypeId,
  type PlayerSnapshot,
  type SimEventType,
} from "shared/protocol";

/** `effects.L` while Armed: a presence flag, not a timer. */
export const ARMED_FLAG = 1;

/** E, C and L are one mutually exclusive Paddle slot. */
export type PaddleSlotEffect = "E" | "C" | "L";
export const PADDLE_SLOT_EFFECTS: readonly PaddleSlotEffect[] = ["E", "C", "L"];

export function isPaddleSlotEffect(type: CapsuleTypeId): type is PaddleSlotEffect {
  return type === "E" || type === "C" || type === "L";
}

/**
 * A Paddle's width sources and slot. `p.w` alone cannot tell an
 * expanded-then-reduced Paddle from a plain one, so the sources are kept
 * apart and the width is always recomputed from them.
 */
export interface PaddleLoadout {
  slot: PaddleSlotEffect | null;
  reduced: boolean;
}

export function makeLoadout(): PaddleLoadout {
  return { slot: null, reduced: false };
}

/** Effective width from a Paddle's sources (E and R stack). */
export function loadoutWidth(loadout: PaddleLoadout): number {
  let w = PADDLE_W;
  if (loadout.slot === "E") w *= CAPSULE_EFFECTS.expandFactor;
  if (loadout.reduced) w *= CAPSULE_EFFECTS.reduceFactor;
  return w;
}

/** The player-snapshot fields for a Paddle's Laser state (none when unarmed). */
export function armedFields(
  armed: boolean,
  cooldown: number,
): Pick<PlayerSnapshot, "effects" | "laserReady"> {
  return armed ? { effects: { [ARMED_EFFECT]: ARMED_FLAG }, laserReady: cooldown === 0 } : { effects: {} };
}

/** What a sim lends `laserHooks`: its grid, events, Brick hit and boss. */
export interface LaserSimWiring {
  readonly bricks: readonly number[];
  pushEvent(type: SimEventType, source: number, target: number): void;
  /** The sim's own Brick hit (normal break or silver hit), credited to `shooter`. */
  hitBrick(index: number, shooter: number): void;
  /** The live boss, or null (no boss round, or Doh is dead). */
  liveBoss(): BossState | null;
  /** The boss loses 1 HP, as a ball contact would. */
  damageBoss(shooter: number): void;
}

/**
 * Bolt hooks for a sim. `boltHit` goes out immediately before the sim's
 * Brick result so feedback can pair them (`isBoltBrickEvent`).
 */
export function laserHooks(sim: LaserSimWiring): BoltHooks {
  return {
    cellAt: (index) => sim.bricks[index] ?? BRICK_EMPTY,
    hitBrick: (index, shooter) => {
      sim.pushEvent("boltHit", shooter, index);
      sim.hitBrick(index, shooter);
    },
    goldHit: (index, shooter) => {
      sim.pushEvent("boltGoldHit", shooter, index);
    },
    bossBox: () => {
      const boss = sim.liveBoss();
      return boss === null ? null : bossBox(boss);
    },
    hitBoss: (shooter) => {
      sim.damageBoss(shooter);
    },
  };
}
