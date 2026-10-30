// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FOCUS_CLASS, GamepadMenuNav } from "ui/gamepadNav";

/** Standard-mapping button indices (Gamepad API). */
const BTN = { a: 0, b: 1, dpadUp: 12, dpadDown: 13, dpadLeft: 14, dpadRight: 15 } as const;

interface FakePad {
  buttons: { pressed: boolean }[];
  axes: number[];
}

function padWith(pressed: readonly number[], axes: number[] = [0, 0]): FakePad {
  const buttons = Array.from({ length: 16 }, (_, i) => ({ pressed: pressed.includes(i) }));
  return { buttons, axes };
}

function buildMenu(): { root: HTMLDivElement; buttons: HTMLButtonElement[] } {
  const root = document.createElement("div");
  const buttons = ["one", "two", "three"].map((label) => {
    const b = document.createElement("button");
    b.textContent = label;
    root.appendChild(b);
    return b;
  });
  document.body.appendChild(root);
  return { root, buttons };
}

describe("GamepadMenuNav (ticket 99)", () => {
  let pad: FakePad | null;
  const getGamepads = (): (Gamepad | null)[] => [pad as unknown as Gamepad | null];

  beforeEach(() => {
    pad = padWith([]);
    document.body.innerHTML = "";
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });

  /** One poll with the given pad state (previous state is whatever was last polled). */
  function press(nav: GamepadMenuNav, pressed: readonly number[], axes?: number[]): void {
    pad = padWith(pressed, axes);
    nav.poll();
  }

  it("d-pad down/up moves focus through the menu and clamps at the ends", () => {
    const { root, buttons } = buildMenu();
    const nav = new GamepadMenuNav({ root, getGamepads });
    nav.poll();
    press(nav, [BTN.dpadDown]);
    expect(document.activeElement).toBe(buttons[0]); // first input lands on the first control
    press(nav, []);
    press(nav, [BTN.dpadDown]);
    expect(document.activeElement).toBe(buttons[1]);
    press(nav, []);
    press(nav, [BTN.dpadDown]);
    press(nav, []);
    press(nav, [BTN.dpadDown]);
    expect(document.activeElement).toBe(buttons[2]);
    press(nav, []);
    press(nav, [BTN.dpadUp]);
    expect(document.activeElement).toBe(buttons[1]);
  });

  it("a held d-pad direction moves focus once, not every poll", () => {
    const { root, buttons } = buildMenu();
    const nav = new GamepadMenuNav({ root, getGamepads });
    nav.poll();
    press(nav, [BTN.dpadDown]);
    press(nav, [BTN.dpadDown]);
    press(nav, [BTN.dpadDown]);
    expect(document.activeElement).toBe(buttons[0]);
  });

  it("left stick beyond the 0.2 deadzone moves focus on the crossing edge", () => {
    const { root, buttons } = buildMenu();
    const nav = new GamepadMenuNav({ root, getGamepads });
    nav.poll();
    press(nav, [], [0, 0.9]);
    press(nav, [], [0, 0.9]);
    press(nav, [], [0, 0]);
    press(nav, [], [0, 0.9]);
    expect(document.activeElement).toBe(buttons[1]);
  });

  it("A clicks the focused button", () => {
    const { root, buttons } = buildMenu();
    const onClick = vi.fn();
    buttons[1]!.addEventListener("click", onClick);
    const nav = new GamepadMenuNav({ root, getGamepads });
    nav.poll();
    buttons[1]!.focus();
    press(nav, [BTN.a]);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("B calls onCancel", () => {
    const { root } = buildMenu();
    const onCancel = vi.fn();
    const nav = new GamepadMenuNav({ root, getGamepads, onCancel });
    nav.poll();
    press(nav, [BTN.b]);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("marks exactly the focused control with the focus-indicator class", () => {
    const { root, buttons } = buildMenu();
    const nav = new GamepadMenuNav({ root, getGamepads });
    nav.poll();
    press(nav, [BTN.dpadDown]);
    press(nav, []);
    press(nav, [BTN.dpadDown]);
    expect(buttons.map((b) => b.classList.contains(FOCUS_CLASS))).toEqual([false, true, false]);
  });

  it("injects the focus-indicator style once per document", () => {
    const a = buildMenu();
    const b = buildMenu();
    new GamepadMenuNav({ root: a.root, getGamepads });
    new GamepadMenuNav({ root: b.root, getGamepads });
    expect(document.head.querySelectorAll("style[data-gamepad-nav]")).toHaveLength(1);
  });

  it("d-pad left/right adjusts a focused range slider instead of moving focus", () => {
    const { root, buttons } = buildMenu();
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "100";
    slider.step = "10";
    slider.value = "50";
    root.insertBefore(slider, buttons[0]!);
    const onInput = vi.fn();
    slider.addEventListener("input", onInput);
    const nav = new GamepadMenuNav({ root, getGamepads });
    nav.poll();
    slider.focus();
    press(nav, [BTN.dpadRight]);
    expect(slider.value).toBe("60");
    expect(onInput).toHaveBeenCalledTimes(1);
    press(nav, []);
    press(nav, [BTN.dpadLeft]);
    press(nav, []);
    press(nav, [BTN.dpadLeft]);
    expect(slider.value).toBe("40");
    expect(document.activeElement).toBe(slider);
  });

  it("a capture handler receives the next pressed button and suppresses navigation", () => {
    const { root, buttons } = buildMenu();
    const nav = new GamepadMenuNav({ root, getGamepads });
    const seen: string[] = [];
    nav.poll();
    buttons[0]!.focus();
    nav.capture = (name) => {
      seen.push(name);
    };
    press(nav, [BTN.dpadDown]);
    expect(seen).toEqual(["dpadDown"]);
    expect(document.activeElement).toBe(buttons[0]);
    nav.capture = null;
    press(nav, []);
    press(nav, [BTN.dpadDown]);
    expect(document.activeElement).toBe(buttons[1]);
  });

  it("does nothing without a connected pad or a getGamepads API", () => {
    const { root, buttons } = buildMenu();
    buttons[0]!.focus();
    pad = null;
    const nav = new GamepadMenuNav({ root, getGamepads });
    expect(() => {
      nav.poll();
    }).not.toThrow();
    expect(document.activeElement).toBe(buttons[0]);
    const bare = new GamepadMenuNav({ root, getGamepads: undefined });
    expect(() => {
      bare.poll();
    }).not.toThrow();
  });

  it("start() polls on an interval and stop() halts it", () => {
    vi.useFakeTimers();
    try {
      const { root, buttons } = buildMenu();
      const nav = new GamepadMenuNav({ root, getGamepads, pollMs: 50 });
      nav.start();
      pad = padWith([]);
      vi.advanceTimersByTime(60);
      pad = padWith([BTN.dpadDown]);
      vi.advanceTimersByTime(60);
      expect(document.activeElement).toBe(buttons[0]);
      nav.stop();
      pad = padWith([]);
      vi.advanceTimersByTime(60);
      pad = padWith([BTN.dpadDown]);
      vi.advanceTimersByTime(60);
      expect(document.activeElement).toBe(buttons[0]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops polling by itself once its root leaves the document", () => {
    vi.useFakeTimers();
    try {
      const { root } = buildMenu();
      const getPads = vi.fn(getGamepads);
      const nav = new GamepadMenuNav({ root, getGamepads: getPads, pollMs: 50 });
      nav.start();
      const afterStart = getPads.mock.calls.length; // start() seeds from the held state
      vi.advanceTimersByTime(60);
      expect(getPads).toHaveBeenCalledTimes(afterStart + 1);
      root.remove();
      vi.advanceTimersByTime(60); // notices the detached root and stops
      const callsAfterDetach = getPads.mock.calls.length;
      vi.advanceTimersByTime(500);
      expect(getPads.mock.calls.length).toBe(callsAfterDetach);
    } finally {
      vi.useRealTimers();
    }
  });

  it("start() after stop() resumes navigation and the focus indicator", () => {
    const { root, buttons } = buildMenu();
    const nav = new GamepadMenuNav({ root, getGamepads });
    nav.start();
    nav.stop();
    nav.start();
    nav.poll();
    press(nav, [BTN.dpadDown]);
    expect(buttons[0]!.classList.contains(FOCUS_CLASS)).toBe(true);
    nav.stop();
  });

  it("only the most recently started nav reacts while overlays are stacked", () => {
    vi.useFakeTimers();
    try {
      const under = buildMenu();
      const over = buildMenu();
      const navUnder = new GamepadMenuNav({ root: under.root, getGamepads, pollMs: 50 });
      const navOver = new GamepadMenuNav({ root: over.root, getGamepads, pollMs: 50 });
      const underFocus = vi.spyOn(under.buttons[0]!, "focus");
      navUnder.start();
      navOver.start();
      const tapDown = (): void => {
        pad = padWith([]);
        vi.advanceTimersByTime(60);
        pad = padWith([BTN.dpadDown]);
        vi.advanceTimersByTime(60);
      };
      tapDown();
      expect(document.activeElement).toBe(over.buttons[0]);
      expect(underFocus).not.toHaveBeenCalled(); // the covered overlay never grabs focus
      // Top overlay closes: the one beneath takes over, with no phantom edge from the held d-pad.
      navOver.stop();
      over.root.remove();
      tapDown();
      expect(underFocus).toHaveBeenCalledTimes(1);
      navUnder.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not mark mouse/keyboard focus with the gamepad ring", () => {
    const { root, buttons } = buildMenu();
    const nav = new GamepadMenuNav({ root, getGamepads });
    nav.start();
    buttons[0]!.focus();
    expect(buttons[0]!.classList.contains(FOCUS_CLASS)).toBe(false);
    nav.stop();
  });

  it("a button already held when the nav starts is not a press", () => {
    const { root, buttons } = buildMenu();
    const onClick = vi.fn();
    buttons[0]!.addEventListener("click", onClick);
    buttons[0]!.focus();
    pad = padWith([BTN.a, BTN.b]);
    const onCancel = vi.fn();
    const nav = new GamepadMenuNav({ root, getGamepads, onCancel });
    nav.start();
    try {
      nav.poll();
      expect(onClick).not.toHaveBeenCalled();
      expect(onCancel).not.toHaveBeenCalled();
      press(nav, []);
      press(nav, [BTN.a]);
      expect(onClick).toHaveBeenCalledTimes(1);
    } finally {
      nav.stop();
    }
  });

  it("after the focused control is re-rendered away, navigation continues from where it was", () => {
    const { root, buttons } = buildMenu();
    const nav = new GamepadMenuNav({ root, getGamepads });
    nav.poll();
    press(nav, [BTN.dpadDown]);
    press(nav, []);
    press(nav, [BTN.dpadDown]); // on buttons[1]
    (document.activeElement as HTMLElement).blur(); // focus lost, as after a re-render
    press(nav, []);
    press(nav, [BTN.dpadDown]);
    expect(document.activeElement).toBe(buttons[2]);
  });

  it("skips controls that are not visible", () => {
    const { root, buttons } = buildMenu();
    (buttons[1] as HTMLElement & { checkVisibility?: () => boolean }).checkVisibility = () => false;
    const nav = new GamepadMenuNav({ root, getGamepads });
    nav.poll();
    press(nav, [BTN.dpadDown]);
    press(nav, []);
    press(nav, [BTN.dpadDown]);
    expect(document.activeElement).toBe(buttons[2]);
  });

  it("reads every connected pad, not just the first slot", () => {
    const { root, buttons } = buildMenu();
    const idle = padWith([]);
    let second = padWith([]);
    const nav = new GamepadMenuNav({
      root,
      getGamepads: () => [idle, second] as unknown as (Gamepad | null)[],
    });
    nav.poll();
    second = padWith([BTN.dpadDown]);
    nav.poll();
    expect(document.activeElement).toBe(buttons[0]);
  });

  it("falls back to navigator.getGamepads when the option is explicitly undefined", () => {
    const { root, buttons } = buildMenu();
    const nav = navigator as Navigator & { getGamepads?: () => (Gamepad | null)[] };
    nav.getGamepads = () => [pad as unknown as Gamepad | null];
    try {
      const menu = new GamepadMenuNav({ root, getGamepads: undefined });
      menu.poll();
      press(menu, [BTN.dpadDown]);
      expect(document.activeElement).toBe(buttons[0]);
    } finally {
      Reflect.deleteProperty(nav, "getGamepads");
    }
  });

  it("adjusts a step=\"any\" slider without throwing", () => {
    const { root, buttons } = buildMenu();
    const slider = document.createElement("input");
    slider.type = "range";
    slider.step = "any";
    slider.min = "0";
    slider.max = "100";
    slider.value = "50";
    root.insertBefore(slider, buttons[0]!);
    const nav = new GamepadMenuNav({ root, getGamepads });
    nav.poll();
    slider.focus();
    expect(() => {
      press(nav, [BTN.dpadRight]);
    }).not.toThrow();
    expect(Number(slider.value)).toBeGreaterThan(50);
  });

  it("select adjustment skips disabled options", () => {
    const { root, buttons } = buildMenu();
    const select = document.createElement("select");
    for (const [v, disabled] of [["a", false], ["b", true], ["c", false]] as const) {
      const o = document.createElement("option");
      o.value = v;
      o.disabled = disabled;
      select.appendChild(o);
    }
    root.insertBefore(select, buttons[0]!);
    const nav = new GamepadMenuNav({ root, getGamepads });
    nav.poll();
    select.focus();
    press(nav, [BTN.dpadRight]);
    expect(select.value).toBe("c");
  });
});
