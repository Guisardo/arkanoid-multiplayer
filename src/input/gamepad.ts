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

export class GamepadAdapter {
  private readonly player: number;
  private state: GamepadState | null = null;
  private readonly pressedEdges = new Set<GamepadButton>();
  private menuEdge = false;

  constructor(opts: GamepadAdapterOptions) {
    this.player = opts.player;
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
      cycleForward: this.takeEdge("rb"),
      cycleBack: this.takeEdge("lb"),
      fire: [
        this.takeEdge("x"),
        this.takeEdge("y"),
        this.takeEdge("b"),
        this.takeEdge("rt"),
      ],
    };
    const launch = this.takeEdge("a");
    if (this.pressedEdges.has("start")) {
      this.pressedEdges.delete("start");
      this.menuEdge = true;
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
}
