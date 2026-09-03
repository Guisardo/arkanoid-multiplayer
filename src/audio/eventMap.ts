// Event → audio mapping (spec §13): brick hit pitched by row, escalating
// chains, per-event SFX. Pure mapping — unit-testable without WebAudio.
import type { SfxEventId } from "./engine";
import type { SimEvent } from "shared/protocol";
import { BRICK_ROWS } from "shared/gridConstants";

/** Pitch by brick row: top rows higher, bottom rows lower. */
export function brickPitch(row: number): number {
  const t = Math.max(0, Math.min(1, row / (BRICK_ROWS - 1)));
  return 1.6 - t * 0.8;
}

/** Chain = current consecutive brickBreak count (resets on launch/loss). */
export function chainLevel(events: readonly SimEvent[], upToTick: number): number {
  let chain = 0;
  for (const e of events) {
    if (e.tick > upToTick) continue;
    if (e.type === "brickBreak") chain++;
    else if (e.type === "ballLaunch" || e.type === "ballLoss") chain = 0;
  }
  return chain;
}

/** Map a sim event to an SFX trigger (id + pitch/gain), or null. */
export function sfxForEvent(
  event: SimEvent,
): { id: SfxEventId; pitch?: number; gain?: number } | null {
  switch (event.type) {
    case "brickBreak":
      return { id: "brickHit", pitch: brickPitch(Math.floor(event.target / 13)) };
    case "brickSilverHit":
      return { id: "brickHit", pitch: 0.8, gain: 0.7 };
    case "ballLaunch":
      return { id: "launch" };
    case "ballLoss":
      return { id: "ballLoss" };
    case "capsuleCatch":
      return { id: "capsuleCatch" };
    case "roundClear":
      return { id: "roundClear" };
    case "attack":
      return { id: "attack" };
    case "assist":
      return { id: "assist" };
    default:
      return null;
  }
}

/** Escalating chain SFX: every tier crossing (4/7/10) fires an escalation. */
export function chainEscalation(chain: number): boolean {
  return chain === 4 || chain === 7 || chain === 10;
}
