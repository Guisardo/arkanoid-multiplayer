// Held primary action (ticket #143, spec #140): every device reports the held
// state of its primary action (Space / gamepad A / touch launch button /
// mouse button 0) as `primaryHeld`, and `releaseHeld()` clears it, while
// `launch` stays an edge event.
import { describe, expect, it } from "vitest";
import { KeyboardAdapter, KEYSET_1, KEYSET_2 } from "input/keyboard";
import { MouseAdapter } from "input/mouse";
import { DEFAULT_GAMEPAD_MAP, GamepadAdapter, type GamepadState } from "input/gamepad";
import { TouchAdapter, type TouchLayout } from "input/touch";

function padState(over: Partial<GamepadState>): GamepadState {
  return { stickX: 0, stickY: 0, dpadLeft: false, dpadRight: false, buttons: {}, ...over };
}

const LAYOUT: TouchLayout = {
  stick: { x: 80, y: 400 },
  buttons: { launch: { x: 400, y: 400 }, pause: { x: 400, y: 40 } },
  buttonRadius: 24,
};

describe("KeyboardAdapter primaryHeld", () => {
  it("is true on every tick the launch key is held; launch fires once", () => {
    const kb = new KeyboardAdapter({ player: 0 }, [KEYSET_1]);
    kb.keyDown("Space");
    const f0 = kb.sampleFrame(0);
    const f1 = kb.sampleFrame(1);
    expect([f0.launch, f0.primaryHeld]).toEqual([true, true]);
    expect([f1.launch, f1.primaryHeld]).toEqual([false, true]);
    kb.keyUp("Space");
    expect(kb.sampleFrame(2).primaryHeld).toBe(false);
  });

  it("solo merge: either keyset's launch key holds", () => {
    const kb = KeyboardAdapter.solo();
    kb.keyDown("KeyW");
    expect(kb.sampleFrame(0).primaryHeld).toBe(true);
    kb.keyUp("KeyW");
    expect(kb.sampleFrame(1).primaryHeld).toBe(false);
    expect(new KeyboardAdapter({ player: 1 }, [KEYSET_2]).sampleFrame(0).primaryHeld).toBe(false);
  });

  it("follows a rebind of the launch key", () => {
    const kb = new KeyboardAdapter({ player: 0 }, [KEYSET_1]);
    kb.setBindings([{ ...KEYSET_1, launch: ["Enter"] }]);
    kb.keyDown("Space");
    expect(kb.sampleFrame(0).primaryHeld).toBe(false);
    kb.keyDown("Enter");
    expect(kb.sampleFrame(1).primaryHeld).toBe(true);
  });

  it("releaseHeld clears held keys: no held fire and no stuck arrow", () => {
    const kb = new KeyboardAdapter({ player: 0 }, [KEYSET_1]);
    kb.keyDown("Space");
    kb.keyDown("ArrowRight");
    kb.releaseHeld();
    const f = kb.sampleFrame(0);
    expect(f.primaryHeld).toBe(false);
    expect(f.axisX).toBe(0);
    // A fresh press after the release is a new edge.
    kb.keyDown("Space");
    expect(kb.sampleFrame(1).launch).toBe(true);
  });
});

describe("MouseAdapter primaryHeld", () => {
  it("derives held from PointerEvent.buttons bit 0", () => {
    const m = new MouseAdapter({ player: 0 });
    m.feedButtons(1);
    expect(m.sampleFrame(0).primaryHeld).toBe(true);
    m.feedButtons(3); // left + right
    expect(m.sampleFrame(1).primaryHeld).toBe(true);
    m.feedButtons(2); // right only
    expect(m.sampleFrame(2).primaryHeld).toBe(false);
  });

  it("self-heals a missed pointerup on the next pointer event", () => {
    const m = new MouseAdapter({ player: 0 });
    m.feedButtons(1);
    // pointerup lost (released outside the window); the next move reports 0.
    m.feedButtons(0);
    expect(m.sampleFrame(0).primaryHeld).toBe(false);
  });

  it("releaseHeld clears held without touching the launch edge", () => {
    const m = new MouseAdapter({ player: 0 });
    m.feedButtons(1);
    m.feedClick();
    m.releaseHeld();
    const f = m.sampleFrame(0);
    expect(f.primaryHeld).toBe(false);
    expect(f.launch).toBe(true);
  });
});

describe("GamepadAdapter primaryHeld", () => {
  it("is true while the launch button (A) is down", () => {
    const g = new GamepadAdapter({ player: 0 });
    g.feedState(padState({ buttons: { a: true } }));
    const f0 = g.sampleFrame(0);
    expect([f0.launch, f0.primaryHeld]).toEqual([true, true]);
    g.feedState(padState({ buttons: { a: true } }));
    const f1 = g.sampleFrame(1);
    expect([f1.launch, f1.primaryHeld]).toEqual([false, true]);
    g.feedState(padState({ buttons: { a: false } }));
    expect(g.sampleFrame(2).primaryHeld).toBe(false);
  });

  it("follows a rebind of launch", () => {
    const g = new GamepadAdapter({ player: 0 });
    g.setBindings({ ...DEFAULT_GAMEPAD_MAP, launch: ["b"] });
    g.feedState(padState({ buttons: { a: true } }));
    expect(g.sampleFrame(0).primaryHeld).toBe(false);
    g.feedState(padState({ buttons: { b: true } }));
    expect(g.sampleFrame(1).primaryHeld).toBe(true);
  });

  it("releaseHeld resets the pad state", () => {
    const g = new GamepadAdapter({ player: 0 });
    g.feedState(padState({ buttons: { a: true }, dpadRight: true }));
    g.releaseHeld();
    const f = g.sampleFrame(0);
    expect(f.primaryHeld).toBe(false);
    expect(f.axisX).toBe(0);
  });
});

describe("TouchAdapter primaryHeld", () => {
  it("is true while the launch button is held", () => {
    const t = new TouchAdapter({ player: 0, layout: LAYOUT });
    t.pointerDown(7, 400, 400);
    const f0 = t.sampleFrame(0);
    expect([f0.launch, f0.primaryHeld]).toEqual([true, true]);
    expect(t.sampleFrame(1).primaryHeld).toBe(true);
    t.pointerUp(7);
    expect(t.sampleFrame(2).primaryHeld).toBe(false);
  });

  it("the stick and pause never count as held fire", () => {
    const t = new TouchAdapter({ player: 0, layout: LAYOUT });
    t.pointerDown(1, 80, 400);
    t.pointerDown(2, 400, 40);
    expect(t.sampleFrame(0).primaryHeld).toBe(false);
  });

  it("releaseHeld releases every pointer", () => {
    const t = new TouchAdapter({ player: 0, layout: LAYOUT });
    t.pointerDown(7, 400, 400);
    t.pointerDown(8, 120, 400);
    t.releaseHeld();
    const f = t.sampleFrame(0);
    expect(f.primaryHeld).toBe(false);
    expect(f.axisX).toBe(0);
  });
});
