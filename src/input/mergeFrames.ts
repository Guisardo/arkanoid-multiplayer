// Device merge (ticket #143): every session samples each local device once a
// tick and needs exactly one Input frame per player. This is the single merge
// policy the solo, versus-bots and multiplayer sessions share.
//
// - Axis: the highest-priority device that is moving wins outright, never
//   summed (touch > mouse > gamepad > keyboard).
// - Edges (`launch`, cycle, the four meter `fire` slots) and held fire
//   (`primaryHeld`): OR across every device. Held fire is ORed on every tick,
//   not only on edge ticks, so holding Space keeps firing while the mouse
//   steers.
import type { InputFrame, InputFrameActions } from "shared/protocol";

/** This tick's frame from each local device (null = device absent). */
export interface DeviceFrames {
  touch: InputFrame | null;
  mouse: InputFrame | null;
  gamepad: InputFrame | null;
  keyboard: InputFrame | null;
}

/** Merge one tick's device frames into the player's Input frame. */
export function mergeDeviceFrames(player: number, tick: number, d: DeviceFrames): InputFrame {
  const byPriority = [d.touch, d.mouse, d.gamepad, d.keyboard];
  let axisX = 0;
  let axisY = 0;
  let launch = false;
  let primaryHeld = false;
  let cycleForward = false;
  let cycleBack = false;
  const fire: [boolean, boolean, boolean, boolean] = [false, false, false, false];
  for (const f of byPriority) {
    if (f === null) continue;
    if (axisX === 0 && f.axisX !== 0) {
      axisX = f.axisX;
      axisY = f.axisY;
    }
    launch ||= f.launch;
    primaryHeld ||= f.primaryHeld;
    cycleForward ||= f.actions.cycleForward;
    cycleBack ||= f.actions.cycleBack;
    for (let i = 0; i < 4; i++) {
      if (f.actions.fire[i] === true) fire[i] = true;
    }
  }
  const actions: InputFrameActions = { cycleForward, cycleBack, fire };
  return { player, tick, axisX, axisY, launch, primaryHeld, actions };
}
