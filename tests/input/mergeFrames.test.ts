// Device merge (ticket #143): one Input frame per player per tick from every
// local device. Axis: the highest-priority device moving wins (touch > mouse >
// gamepad > keyboard). Edges and held fire: OR across every device, every
// tick, so a held Space keeps firing while the mouse steers.
import { describe, expect, it } from "vitest";
import { mergeDeviceFrames } from "input/mergeFrames";
import { EMPTY_ACTIONS, type InputFrame } from "shared/protocol";

function frame(over: Partial<InputFrame> = {}): InputFrame {
  return { player: 0, tick: 5, axisX: 0, axisY: 0, launch: false, primaryHeld: false, actions: EMPTY_ACTIONS, ...over };
}

describe("mergeDeviceFrames", () => {
  it("ORs primaryHeld across devices on a tick with no edges", () => {
    const merged = mergeDeviceFrames(0, 5, {
      touch: null,
      mouse: frame({ axisX: 1 }),
      gamepad: frame(),
      keyboard: frame({ primaryHeld: true }),
    });
    expect(merged).toMatchObject({ axisX: 1, primaryHeld: true, launch: false });
  });

  it("axis priority: touch > mouse > gamepad > keyboard", () => {
    const all = {
      touch: frame({ axisX: 0.5, axisY: -0.25 }),
      mouse: frame({ axisX: -1 }),
      gamepad: frame({ axisX: 0.75 }),
      keyboard: frame({ axisX: 1 }),
    };
    expect(mergeDeviceFrames(0, 5, all)).toMatchObject({ axisX: 0.5, axisY: -0.25 });
    expect(mergeDeviceFrames(0, 5, { ...all, touch: null }).axisX).toBe(-1);
    expect(mergeDeviceFrames(0, 5, { ...all, touch: null, mouse: frame() }).axisX).toBe(0.75);
    expect(mergeDeviceFrames(0, 5, { touch: null, mouse: null, gamepad: frame(), keyboard: frame({ axisX: 1 }) }).axisX).toBe(1);
  });

  it("ORs launch and every action edge across devices", () => {
    const merged = mergeDeviceFrames(0, 5, {
      touch: frame({ axisX: 1 }),
      mouse: frame({ launch: true }),
      gamepad: frame({ actions: { cycleForward: false, cycleBack: true, fire: [false, false, true, false] } }),
      keyboard: frame({ actions: { cycleForward: true, cycleBack: false, fire: [true, false, false, false] } }),
    });
    expect(merged.launch).toBe(true);
    expect(merged.actions).toEqual({ cycleForward: true, cycleBack: true, fire: [true, false, true, false] });
  });

  it("stamps the requested player and tick (adapters may be shared)", () => {
    const merged = mergeDeviceFrames(2, 9, { touch: null, mouse: null, gamepad: null, keyboard: frame({ player: 0, tick: 9 }) });
    expect(merged.player).toBe(2);
    expect(merged.tick).toBe(9);
  });

  it("no devices: an idle frame", () => {
    expect(mergeDeviceFrames(1, 3, { touch: null, mouse: null, gamepad: null, keyboard: null })).toEqual(
      frame({ player: 1, tick: 3 }),
    );
  });
});
