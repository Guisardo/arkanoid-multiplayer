// Gamepad menu navigation (ticket 99, spec §11): any connected pad drives a
// DOM overlay — d-pad / left stick move focus, A activates, B cancels,
// left/right adjusts a focused slider or select. One module shared by settings, pause,
// end and lobby screens so every overlay behaves the same. The simulation's
// GamepadAdapter is untouched: menus poll the pad themselves because the
// sim loop does not run while an overlay is up.
import { STICK_DEADZONE, type GamepadButton } from "input/gamepad";

/** Class put on the focused control — styled as a visible ring. */
export const FOCUS_CLASS = "gp-focus";

const FOCUS_RULE = `.${FOCUS_CLASS}{outline:3px solid #ffd54a !important;outline-offset:2px;}`;
const STYLE_ATTR = "data-gamepad-nav";
const DEFAULT_POLL_MS = 50;
const FOCUSABLE =
  "button:not(:disabled), input[type=range]:not(:disabled), " +
  "input[type=checkbox]:not(:disabled), select:not(:disabled)";

type PadButtons = Partial<Record<GamepadButton, boolean>>;

export type GetGamepads = () => readonly (Gamepad | null)[];

export interface GamepadMenuNavOptions {
  /** Overlay whose controls are navigated. */
  root: HTMLElement;
  /** B pressed (and no capture active). Omit when the screen has no "back". */
  onCancel?: (() => void) | undefined;
  /** Injected pad source; defaults to `navigator.getGamepads` when present. */
  getGamepads?: GetGamepads | undefined;
  /** Interval for `start()`. */
  pollMs?: number | undefined;
}

/** Standard-mapping button indices → named buttons (Gamepad API layout). */
export function readPadButtons(pad: Gamepad): PadButtons {
  const b = (i: number): boolean => pad.buttons[i]?.pressed === true;
  return {
    a: b(0), b: b(1), x: b(2), y: b(3),
    lb: b(4), rb: b(5), lt: b(6), rt: b(7),
    start: b(9),
    dpadUp: b(12), dpadDown: b(13), dpadLeft: b(14), dpadRight: b(15),
  };
}

function ensureStyle(): void {
  if (document.head.querySelector(`style[${STYLE_ATTR}]`) !== null) return;
  const style = document.createElement("style");
  style.setAttribute(STYLE_ATTR, "");
  style.textContent = FOCUS_RULE;
  document.head.appendChild(style);
}

export class GamepadMenuNav {
  /**
   * Started navs, oldest first. Overlays stack (settings over landing), and
   * all of them see the same pad — only the newest may act, or the covered
   * one steals focus and fires clicks behind the visible screen.
   */
  private static readonly stack: GamepadMenuNav[] = [];

  /**
   * While set, the next newly pressed button goes here and navigation is
   * suppressed (rebind capture has priority — spec §11).
   */
  capture: ((button: GamepadButton) => void) | null = null;

  private readonly opts: GamepadMenuNavOptions;
  private readonly hasInjectedSource: boolean;
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private prevButtons: PadButtons = {};
  private prevAxes = { x: 0, y: 0 };
  /** Index (among visible controls) last focused by the pad; survives re-renders. */
  private lastIndex = -1;
  // The ring marks pad-driven focus only — mouse/touch/keyboard focus keeps
  // the browser's own indication.
  private readonly onPointerDown = (): void => {
    this.clearFocusClass();
  };
  private readonly onFocusOut = (e: Event): void => {
    if (e.target instanceof HTMLElement) e.target.classList.remove(FOCUS_CLASS);
  };

  constructor(opts: GamepadMenuNavOptions) {
    this.opts = opts;
    this.hasInjectedSource = opts.getGamepads !== undefined;
    ensureStyle();
  }

  /** Begin polling on an interval. */
  start(): void {
    if (this.pollHandle !== null) return;
    this.opts.root.addEventListener("focusout", this.onFocusOut);
    this.opts.root.addEventListener("pointerdown", this.onPointerDown);
    GamepadMenuNav.stack.push(this);
    // Buttons still held from the screen that opened this one (A on "Settings")
    // are not presses here.
    const held = this.readMergedPad();
    this.prevButtons = held?.buttons ?? {};
    this.prevAxes = held?.axes ?? { x: 0, y: 0 };
    this.pollHandle = setInterval(() => {
      this.poll();
    }, this.opts.pollMs ?? DEFAULT_POLL_MS);
  }

  /** Stop polling and forget edge state. */
  stop(): void {
    const at = GamepadMenuNav.stack.indexOf(this);
    if (at >= 0) GamepadMenuNav.stack.splice(at, 1);
    if (this.pollHandle !== null) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
    this.opts.root.removeEventListener("focusout", this.onFocusOut);
    this.opts.root.removeEventListener("pointerdown", this.onPointerDown);
    this.clearFocusClass();
    this.prevButtons = {};
    this.prevAxes = { x: 0, y: 0 };
  }

  /** Read all connected pads once and act on new edges. */
  poll(): void {
    // Overlays are removed from the DOM by their owners without a hook —
    // stop here so a dead menu never keeps a timer alive.
    if (!this.opts.root.isConnected) {
      this.stop();
      return;
    }
    const merged = this.readMergedPad();
    if (!merged) {
      this.prevButtons = {};
      this.prevAxes = { x: 0, y: 0 };
      return;
    }
    const { buttons: now, axes } = merged;
    const edge = (name: GamepadButton): boolean =>
      now[name] === true && this.prevButtons[name] !== true;
    try {
      if (this.isCovered()) return;
      if (this.capture) {
        const pressed = (Object.keys(now) as GamepadButton[]).find(edge);
        if (pressed !== undefined) this.capture(pressed);
        return;
      }
      this.navigate(edge, axes);
    } finally {
      this.prevButtons = now;
      this.prevAxes = axes;
    }
  }

  /** True when a newer started nav sits above this one. */
  private isCovered(): boolean {
    const stack = GamepadMenuNav.stack;
    return stack.includes(this) && stack[stack.length - 1] !== this;
  }

  /** Buttons OR-ed and the strongest stick taken across every connected pad. */
  private readMergedPad(): { buttons: PadButtons; axes: { x: number; y: number } } | null {
    const pads = this.readPads().filter((p): p is Gamepad => p !== null && p !== undefined);
    if (pads.length === 0) return null;
    const buttons: PadButtons = {};
    const axes = { x: 0, y: 0 };
    for (const pad of pads) {
      const read = readPadButtons(pad);
      for (const name of Object.keys(read) as GamepadButton[]) {
        buttons[name] = buttons[name] === true || read[name] === true;
      }
      const x = pad.axes[0] ?? 0;
      const y = pad.axes[1] ?? 0;
      if (Math.abs(x) > Math.abs(axes.x)) axes.x = x;
      if (Math.abs(y) > Math.abs(axes.y)) axes.y = y;
    }
    return { buttons, axes };
  }

  /** Injected source if given, else the live browser API (absent in jsdom/SSR). */
  private readPads(): readonly (Gamepad | null)[] {
    if (this.hasInjectedSource) return this.opts.getGamepads?.() ?? [];
    return typeof navigator.getGamepads === "function" ? navigator.getGamepads() : [];
  }

  private navigate(edge: (name: GamepadButton) => boolean, axes: { x: number; y: number }): void {
    const crossed = (value: number, prev: number, sign: 1 | -1): boolean =>
      sign * value >= STICK_DEADZONE && sign * prev < STICK_DEADZONE;
    const up = edge("dpadUp") || crossed(axes.y, this.prevAxes.y, -1);
    const down = edge("dpadDown") || crossed(axes.y, this.prevAxes.y, 1);
    const left = edge("dpadLeft") || crossed(axes.x, this.prevAxes.x, -1);
    const right = edge("dpadRight") || crossed(axes.x, this.prevAxes.x, 1);

    const focused = document.activeElement;
    const adjustable =
      this.opts.root.contains(focused) &&
      ((focused instanceof HTMLInputElement && focused.type === "range") ||
        focused instanceof HTMLSelectElement)
        ? (focused as HTMLInputElement | HTMLSelectElement)
        : null;

    if (up) this.moveFocus(-1);
    else if (down) this.moveFocus(1);
    else if (adjustable && (left || right)) this.adjust(adjustable, right ? 1 : -1);
    else if (left) this.moveFocus(-1);
    else if (right) this.moveFocus(1);

    if (edge("a")) {
      const active = document.activeElement;
      if (
        this.opts.root.contains(active) &&
        (active instanceof HTMLButtonElement ||
          (active instanceof HTMLInputElement && active.type === "checkbox"))
      ) {
        active.click();
      }
    }
    if (edge("b")) this.opts.onCancel?.();
  }

  private moveFocus(delta: number): void {
    const controls = Array.from(this.opts.root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => (el as HTMLElement & { checkVisibility?: () => boolean }).checkVisibility?.() !== false,
    );
    if (controls.length === 0) return;
    const idx = controls.indexOf(document.activeElement as HTMLElement);
    // Focus lost to a re-render: continue from the last pad position, not the top.
    const from = idx >= 0 ? idx : this.lastIndex;
    const next = from < 0 ? 0 : Math.min(controls.length - 1, Math.max(0, from + delta));
    this.lastIndex = next;
    this.clearFocusClass();
    const target = controls[next];
    target?.focus();
    target?.classList.add(FOCUS_CLASS);
  }

  /** Left/right on a slider or select changes its value (focus stays put). */
  private adjust(control: HTMLInputElement | HTMLSelectElement, direction: 1 | -1): void {
    const before = control.value;
    if (control instanceof HTMLSelectElement) {
      for (let i = control.selectedIndex + direction; i >= 0 && i < control.options.length; i += direction) {
        if (!control.options[i]?.disabled) {
          control.selectedIndex = i;
          break;
        }
      }
    } else {
      // Manual stepping: stepUp() throws for step="any".
      const min = control.min === "" ? 0 : Number(control.min);
      const max = control.max === "" ? 100 : Number(control.max);
      const declared = Number(control.step);
      const step = control.step === "any" || !(declared > 0) ? (max - min) / 20 : declared;
      const next = Math.min(max, Math.max(min, Number(control.value) + direction * step));
      control.value = String(next);
    }
    if (control.value === before) return;
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
  }

  private clearFocusClass(): void {
    for (const el of this.opts.root.querySelectorAll(`.${FOCUS_CLASS}`)) {
      el.classList.remove(FOCUS_CLASS);
    }
  }
}
