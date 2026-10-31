// Held-fire safety (ticket #143, spec #140): `bindInputSafety` releases every
// device's held state on window blur, tab hidden and any context menu, and
// `bindMouseHeld` keeps the mouse's held button honest across pointer events
// (buttons-based self-heal, capture, cancel, lost capture).
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { bindInputSafety, bindMouseHeld } from "input/inputSafety";
import { MouseAdapter } from "input/mouse";
import { KeyboardAdapter, KEYSET_1 } from "input/keyboard";

/** A pointer event jsdom can dispatch (jsdom has no PointerEvent). */
function pointer(type: string, init: { button?: number; buttons?: number; pointerId?: number; pointerType?: string }): Event {
  const e = new MouseEvent(type, { button: init.button ?? 0, buttons: init.buttons ?? 0, bubbles: true, cancelable: true });
  Object.defineProperty(e, "pointerId", { value: init.pointerId ?? 1 });
  Object.defineProperty(e, "pointerType", { value: init.pointerType ?? "mouse" });
  return e;
}

function setVisibility(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
}

describe("bindInputSafety", () => {
  const unbinds: (() => void)[] = [];
  afterEach(() => {
    for (const u of unbinds) u();
    unbinds.length = 0;
    setVisibility("visible");
  });

  function held(): { kb: KeyboardAdapter; mouse: MouseAdapter } {
    const kb = new KeyboardAdapter({ player: 0 }, [KEYSET_1]);
    const mouse = new MouseAdapter({ player: 0 });
    kb.keyDown("Space");
    kb.keyDown("ArrowRight");
    mouse.feedButtons(1);
    return { kb, mouse };
  }

  it("window blur releases every device mid-hold", () => {
    const { kb, mouse } = held();
    const safety = bindInputSafety(() => [kb, mouse]);
    unbinds.push(safety.unbind);
    window.dispatchEvent(new Event("blur"));
    expect(kb.sampleFrame(0)).toMatchObject({ primaryHeld: false, axisX: 0 });
    expect(mouse.sampleFrame(0).primaryHeld).toBe(false);
  });

  it("tab hidden releases; tab shown does not", () => {
    const { kb } = held();
    const safety = bindInputSafety(() => [kb]);
    unbinds.push(safety.unbind);
    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(kb.sampleFrame(0).primaryHeld).toBe(true);
    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(kb.sampleFrame(1).primaryHeld).toBe(false);
  });

  it("any contextmenu releases (the menu swallows the matching up events)", () => {
    const { kb, mouse } = held();
    const safety = bindInputSafety(() => [kb, mouse]);
    unbinds.push(safety.unbind);
    const elsewhere = document.createElement("div");
    document.body.appendChild(elsewhere);
    elsewhere.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    expect(kb.sampleFrame(0).primaryHeld).toBe(false);
    expect(mouse.sampleFrame(0).primaryHeld).toBe(false);
  });

  it("reads the device list at release time (devices created later count)", () => {
    const devices: KeyboardAdapter[] = [];
    const safety = bindInputSafety(() => devices);
    unbinds.push(safety.unbind);
    const late = new KeyboardAdapter({ player: 1 }, [KEYSET_1]);
    late.keyDown("Space");
    devices.push(late);
    window.dispatchEvent(new Event("blur"));
    expect(late.sampleFrame(0).primaryHeld).toBe(false);
  });

  it("release() is the hook for pause / settings / end-screen open", () => {
    const { kb } = held();
    const safety = bindInputSafety(() => [kb]);
    unbinds.push(safety.unbind);
    safety.release();
    expect(kb.sampleFrame(0).primaryHeld).toBe(false);
  });

  it("unbind releases once more and removes every listener", () => {
    const { kb } = held();
    const removeWin = vi.spyOn(window, "removeEventListener");
    const removeDoc = vi.spyOn(document, "removeEventListener");
    const safety = bindInputSafety(() => [kb]);
    safety.unbind();
    expect(kb.sampleFrame(0).primaryHeld).toBe(false);
    expect(removeWin.mock.calls.map((c) => c[0]).sort()).toEqual(["blur", "contextmenu"]);
    expect(removeDoc.mock.calls.map((c) => c[0])).toEqual(["visibilitychange"]);
    kb.keyDown("Space");
    window.dispatchEvent(new Event("blur"));
    expect(kb.sampleFrame(1).primaryHeld).toBe(true);
    removeWin.mockRestore();
    removeDoc.mockRestore();
  });
});

describe("bindMouseHeld", () => {
  function setup(): { canvas: HTMLCanvasElement; mouse: MouseAdapter; unbind: () => void; capture: ReturnType<typeof vi.fn> } {
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    const capture = vi.fn();
    canvas.setPointerCapture = capture;
    const mouse = new MouseAdapter({ player: 0 });
    const unbind = bindMouseHeld(canvas, mouse);
    return { canvas, mouse, unbind, capture };
  }

  it("button-0 pointerdown holds and captures the pointer", () => {
    const { canvas, mouse, unbind, capture } = setup();
    canvas.dispatchEvent(pointer("pointerdown", { button: 0, buttons: 1, pointerId: 4 }));
    expect(mouse.sampleFrame(0).primaryHeld).toBe(true);
    expect(capture).toHaveBeenCalledWith(4);
    canvas.dispatchEvent(pointer("pointerup", { button: 0, buttons: 0, pointerId: 4 }));
    expect(mouse.sampleFrame(1).primaryHeld).toBe(false);
    unbind();
  });

  it("a right-button press neither holds nor captures", () => {
    const { canvas, mouse, unbind, capture } = setup();
    canvas.dispatchEvent(pointer("pointerdown", { button: 2, buttons: 2 }));
    expect(mouse.sampleFrame(0).primaryHeld).toBe(false);
    expect(capture).not.toHaveBeenCalled();
    unbind();
  });

  it("self-heals from buttons on a pointermove after a missed pointerup", () => {
    const { canvas, mouse, unbind } = setup();
    canvas.dispatchEvent(pointer("pointerdown", { button: 0, buttons: 1 }));
    canvas.dispatchEvent(pointer("pointermove", { buttons: 0 }));
    expect(mouse.sampleFrame(0).primaryHeld).toBe(false);
    unbind();
  });

  it.each(["pointercancel", "lostpointercapture"])("%s mid-hold releases", (type) => {
    const { canvas, mouse, unbind } = setup();
    canvas.dispatchEvent(pointer("pointerdown", { button: 0, buttons: 1 }));
    canvas.dispatchEvent(pointer(type, { buttons: 1 }));
    expect(mouse.sampleFrame(0).primaryHeld).toBe(false);
    unbind();
  });

  it("prevents the canvas context menu", () => {
    const { canvas, unbind } = setup();
    const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    canvas.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    unbind();
  });

  it("ignores touch pointers (touch has its own button cluster)", () => {
    const { canvas, mouse, unbind, capture } = setup();
    canvas.dispatchEvent(pointer("pointerdown", { button: 0, buttons: 1, pointerType: "touch" }));
    expect(mouse.sampleFrame(0).primaryHeld).toBe(false);
    expect(capture).not.toHaveBeenCalled();
    unbind();
  });

  it("unbind removes the listeners", () => {
    const { canvas, mouse, unbind } = setup();
    unbind();
    canvas.dispatchEvent(pointer("pointerdown", { button: 0, buttons: 1 }));
    expect(mouse.sampleFrame(0).primaryHeld).toBe(false);
    const e = new MouseEvent("contextmenu", { cancelable: true });
    canvas.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });
});
