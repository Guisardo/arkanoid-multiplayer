import type { InputFrame, InputFrameActions } from "shared/protocol";

// Gamepad adapter (spec §11): left stick (0.2 radial deadzone) and d-pad both
// always live — stick beyond deadzone wins, never summed. A/Cross launch,
// LB/RB cycle, X/Y/B/RT fire (4 slots), Start pause/menu. Disconnect → app
// stops calling feedState → frames idle; reset() clears stale state.
export type GamepadButton =
  | "a" | "b" | "x" | "y"
  | "lb" | "rb" | "rt" | "lt"
  | "start"
  | "dpadLeft" | "dpadRight" | "dpadUp" | "dpadDown";

export interface GamepadState {
  stickX: number;
  stickY: number;
  dpadLeft: boolean;
  dpadRight: boolean;
  buttons: Partial<Record<GamepadButton, boolean>>;
}

export const STICK_DEADZONE = 0.2;

export interface GamepadAdapterOptions {
  player: number;
}

/** Button map consumed by the adapter — action → bound buttons. */
export type GamepadBindingsMap = Readonly<
  Record<"launch" | "cycleForward" | "cycleBack" | "fire1" | "fire2" | "fire3" | "fire4" | "menu", readonly GamepadButton[]>
>;

/** Default gamepad bindings (spec §11). */
export const DEFAULT_GAMEPAD_MAP: GamepadBindingsMap = {
  launch: ["a"],
  cycleForward: ["rb"],
  cycleBack: ["lb"],
  fire1: ["x"],
  fire2: ["y"],
  fire3: ["b"],
  fire4: ["rt"],
  menu: ["start"],
};

export class GamepadAdapter {
  private readonly player: number;
  private bindings: GamepadBindingsMap;
  private state: GamepadState | null = null;
  private readonly pressedEdges = new Set<GamepadButton>();
  private menuEdge = false;

  constructor(opts: GamepadAdapterOptions, bindings?: GamepadBindingsMap) {
    this.player = opts.player;
    this.bindings = bindings ?? DEFAULT_GAMEPAD_MAP;
  }

  /** Swap the button map live (rebind screen applies without re-creating). */
  setBindings(bindings: GamepadBindingsMap): void {
    this.bindings = bindings;
  }

  /** App polls navigator.getGamepads() and feeds normalized state. */
  feedState(state: GamepadState): void {
    // Track newly-pressed buttons (edge events).
    const prev = this.state;
    if (prev) {
      for (const b of Object.keys(state.buttons) as GamepadButton[]) {
        const now = state.buttons[b] === true;
        const was = prev.buttons[b] === true;
        if (now && !was) this.pressedEdges.add(b);
      }
    } else {
      for (const b of Object.keys(state.buttons) as GamepadButton[]) {
        if (state.buttons[b] === true) this.pressedEdges.add(b);
      }
    }
    this.state = { ...state, buttons: { ...state.buttons } };
  }

  /** Clear all state (disconnect / reconnect cycle). */
  reset(): void {
    this.state = null;
    this.pressedEdges.clear();
    this.menuEdge = false;
  }

  /** Start-button pause/menu edge — consumed once. */
  consumeMenuEvent(): "pause" | null {
    if (this.menuEdge) {
      this.menuEdge = false;
      return "pause";
    }
    return null;
  }

  sampleFrame(tick: number): InputFrame {
    let axisX = 0;
    const s = this.state;
    if (s) {
      const mag = Math.hypot(s.stickX, s.stickY);
      if (mag >= STICK_DEADZONE) {
        // Stick beyond deadzone wins — proportional, clamped ±1.
        axisX = Math.max(-1, Math.min(1, s.stickX));
      } else if (s.dpadLeft !== s.dpadRight) {
        // D-pad live when stick is idle; never summed.
        axisX = s.dpadRight ? 1 : -1;
      }
    }

    const actions: InputFrameActions = {
      cycleForward: this.takeEdgeAny(this.bindings.cycleForward),
      cycleBack: this.takeEdgeAny(this.bindings.cycleBack),
      fire: [
        this.takeEdgeAny(this.bindings.fire1),
        this.takeEdgeAny(this.bindings.fire2),
        this.takeEdgeAny(this.bindings.fire3),
        this.takeEdgeAny(this.bindings.fire4),
      ],
    };
    const launch = this.takeEdgeAny(this.bindings.launch);
    for (const b of this.bindings.menu) {
      if (this.pressedEdges.has(b)) {
        this.pressedEdges.delete(b);
        this.menuEdge = true;
      }
    }

    return { player: this.player, tick, axisX, axisY: 0, launch, actions };
  }

  private takeEdge(b: GamepadButton): boolean {
    if (this.pressedEdges.has(b)) {
      this.pressedEdges.delete(b);
      return true;
    }
    return false;
  }

  /** True if any bound button has a pending edge (consumes all matches). */
  private takeEdgeAny(buttons: readonly GamepadButton[]): boolean {
    let hit = false;
    for (const b of buttons) {
      if (this.takeEdge(b)) hit = true;
    }
    return hit;
  }
}
