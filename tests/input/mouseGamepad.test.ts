import { describe, expect, it } from "vitest";
import { MouseAdapter } from "input/mouse";
import { GamepadAdapter, type GamepadState } from "input/gamepad";
import { KeyboardAdapter, KEYSET_1 } from "input/keyboard";

function padState(over: Partial<GamepadState>): GamepadState {
  return { stickX: 0, stickY: 0, dpadLeft: false, dpadRight: false, buttons: {}, ...over };
}

describe("MouseAdapter (spec §11)", () => {
  it("dead band → axis 0", () => {
    const m = new MouseAdapter({ player: 0 });
    m.feedPointer(104, 105);
    expect(m.sampleFrame(0).axisX).toBe(0);
  });
  it("beyond band → ±1 toward pointer (binary, full-speed parity)", () => {
    const m = new MouseAdapter({ player: 0 });
    m.feedPointer(150, 104);
    expect(m.sampleFrame(0).axisX).toBe(1);
    m.feedPointer(50, 104);
    expect(m.sampleFrame(1).axisX).toBe(-1);
  });
  it("click = launch edge once", () => {
    const m = new MouseAdapter({ player: 0 });
    m.feedClick();
    expect(m.sampleFrame(0).launch).toBe(true);
    expect(m.sampleFrame(1).launch).toBe(false);
  });
  it("no pointer data → idle axis", () => {
    const m = new MouseAdapter({ player: 0 });
    expect(m.sampleFrame(0).axisX).toBe(0);
  });
});

describe("GamepadAdapter (spec §11)", () => {
  it("radial deadzone: below 0.2 → zero; above → proportional", () => {
    const g = new GamepadAdapter({ player: 0 });
    g.feedState(padState({ stickX: 0.15, stickY: 0 }));
    expect(g.sampleFrame(0).axisX).toBe(0);
    g.feedState(padState({ stickX: 0.25, stickY: 0.25 }));
    expect(g.sampleFrame(1).axisX).toBeCloseTo(0.25, 5);
  });
  it("stick clamps to ±1 per component", () => {
    const g = new GamepadAdapter({ player: 0 });
    g.feedState(padState({ stickX: 1.5, stickY: 0.9 }));
    expect(g.sampleFrame(0).axisX).toBe(1);
    g.feedState(padState({ stickX: -1.5, stickY: 0 }));
    expect(g.sampleFrame(1).axisX).toBe(-1);
  });
  it("d-pad alone → ±1", () => {
    const g = new GamepadAdapter({ player: 0 });
    g.feedState(padState({ dpadRight: true }));
    expect(g.sampleFrame(0).axisX).toBe(1);
    g.feedState(padState({ dpadLeft: true }));
    expect(g.sampleFrame(1).axisX).toBe(-1);
  });
  it("stick wins over d-pad, never summed", () => {
    const g = new GamepadAdapter({ player: 0 });
    g.feedState(padState({ stickX: 0.5, dpadRight: true }));
    expect(g.sampleFrame(0).axisX).toBe(0.5);
  });
  it("A = launch edge once per press", () => {
    const g = new GamepadAdapter({ player: 0 });
    g.feedState(padState({ buttons: { a: true } }));
    expect(g.sampleFrame(0).launch).toBe(true);
    g.feedState(padState({ buttons: { a: true } }));
    expect(g.sampleFrame(1).launch).toBe(false);
    g.feedState(padState({ buttons: {} }));
    g.feedState(padState({ buttons: { a: true } }));
    expect(g.sampleFrame(2).launch).toBe(true);
  });
  it("fire slots X/Y/B/RT as edges", () => {
    const g = new GamepadAdapter({ player: 0 });
    g.feedState(padState({ buttons: { x: true, rt: true } }));
    const f = g.sampleFrame(0);
    expect(f.actions.fire).toEqual([true, false, false, true]);
    expect(g.sampleFrame(1).actions.fire).toEqual([false, false, false, false]);
  });
  it("LB/RB cycle edges", () => {
    const g = new GamepadAdapter({ player: 0 });
    g.feedState(padState({ buttons: { rb: true } }));
    expect(g.sampleFrame(0).actions.cycleForward).toBe(true);
    g.feedState(padState({ buttons: { lb: true } }));
    expect(g.sampleFrame(1).actions.cycleBack).toBe(true);
  });
  it("Start = pause edge consumed once", () => {
    const g = new GamepadAdapter({ player: 0 });
    g.feedState(padState({ buttons: { start: true } }));
    g.sampleFrame(0);
    expect(g.consumeMenuEvent()).toBe("pause");
    expect(g.consumeMenuEvent()).toBeNull();
  });
  it("reset() zeroes state; no feedState → idle frames", () => {
    const g = new GamepadAdapter({ player: 0 });
    g.feedState(padState({ stickX: 1, buttons: { a: true } }));
    g.reset();
    const f = g.sampleFrame(0);
    expect(f.axisX).toBe(0);
    expect(f.launch).toBe(false);
    const idle = new GamepadAdapter({ player: 0 });
    expect(idle.sampleFrame(0).axisX).toBe(0);
  });
});

describe("GamepadAdapter rebinds (ticket 41)", () => {
  it("custom button map drives the adapter", () => {
    const g = new GamepadAdapter({ player: 0 }, {
      launch: ["b"],
      cycleForward: ["y"],
      cycleBack: ["x"],
      fire1: ["a"],
      fire2: ["rb"],
      fire3: ["lb"],
      fire4: ["lt"],
      menu: ["start"],
    });
    g.feedState(padState({ buttons: { b: true } }));
    expect(g.sampleFrame(0).launch).toBe(true);
    g.feedState(padState({ buttons: { a: true } }));
    expect(g.sampleFrame(1).actions.fire[0]).toBe(true);
    g.feedState(padState({ buttons: { y: true } }));
    expect(g.sampleFrame(2).actions.cycleForward).toBe(true);
  });

  it("setBindings swaps the map live", () => {
    const g = new GamepadAdapter({ player: 0 });
    g.setBindings({
      launch: ["x"],
      cycleForward: ["rb"],
      cycleBack: ["lb"],
      fire1: ["a"],
      fire2: ["y"],
      fire3: ["b"],
      fire4: ["rt"],
      menu: ["start"],
    });
    g.feedState(padState({ buttons: { x: true } }));
    expect(g.sampleFrame(0).launch).toBe(true);
    g.feedState(padState({ buttons: { a: true } }));
    expect(g.sampleFrame(1).actions.fire[0]).toBe(true);
  });

  it("movement stays fixed — stick/d-pad never rebindable", () => {
    const g = new GamepadAdapter({ player: 0 }, {
      launch: ["a"],
      cycleForward: ["rb"],
      cycleBack: ["lb"],
      fire1: ["x"],
      fire2: ["y"],
      fire3: ["b"],
      fire4: ["rt"],
      menu: ["start"],
    });
    g.feedState(padState({ stickX: 0.8 }));
    expect(g.sampleFrame(0).axisX).toBeCloseTo(0.8, 5);
    g.feedState(padState({ dpadRight: true }));
    expect(g.sampleFrame(1).axisX).toBe(1);
  });
});

describe("frame-shape parity across devices (spec §11 seam)", () => {
  it("all adapters emit the identical InputFrame shape", () => {
    const k = new KeyboardAdapter({ player: 0 }, [KEYSET_1]);
    const m = new MouseAdapter({ player: 0 });
    const g = new GamepadAdapter({ player: 0 });

    k.keyDown("ArrowRight");
    m.feedPointer(150, 104);
    g.feedState(padState({ stickX: 1 }));

    const kf = k.sampleFrame(7);
    const mf = m.sampleFrame(7);
    const gf = g.sampleFrame(7);
    for (const f of [kf, mf, gf]) {
      expect(Object.keys(f).sort()).toEqual(["actions", "axisX", "axisY", "launch", "player", "tick"]);
      expect(f.player).toBe(0);
      expect(f.tick).toBe(7);
      expect(f.axisX).toBe(1);
      expect(f.axisY).toBe(0);
      expect(f.launch).toBe(false);
    }
  });
});
