// Touch adapter (ticket 42, spec §11): virtual stick (proportional, 0.2
// deadzone) + context button cluster, multi-touch. Emits the same Input
// frame shape as every other device — parity at the seam. Pure logic:
// the app feeds pointer events in, the adapter never touches the DOM.
import type { InputFrame, InputFrameActions } from "shared/protocol";
import { EMPTY_ACTIONS } from "shared/protocol";

export const STICK_DEADZONE = 0.2;
/** Stick base radius in px (screen); knob travel = base radius. */
export const STICK_BASE_RADIUS = 56;
/** Minimum button size in px (spec §11: tap targets ≥48 px). */
export const BUTTON_MIN_PX = 48;

/** Overlay button ids — the context cluster per mode (spec §11). */
export type TouchButtonId =
  | "launch"
  | "fire1"
  | "fire2"
  | "fire3"
  | "fire4"
  | "cycleForward"
  | "cycleBack"
  | "pause";

/** Cluster layout per mode: Launch only / Attack (4 fire + cycle) / Assist (3 fire + cycle). */
export type TouchClusterMode = "solo" | "attack" | "assist";

export function clusterButtons(mode: TouchClusterMode): TouchButtonId[] {
  switch (mode) {
    case "solo":
      return ["launch"];
    case "attack":
      return ["fire1", "fire2", "fire3", "fire4", "cycleForward"];
    case "assist":
      return ["fire1", "fire2", "fire3", "cycleForward"];
  }
}

/** A raw touch pointer sample (app translates DOM events to this). */
export interface TouchPointer {
  /** Adapter-assigned pointer id (DOM pointerId). */
  id: number;
  /** Screen px, overlay-local (relative to the overlay's top-left). */
  x: number;
  y: number;
}

export interface TouchLayout {
  /** Stick base center in overlay-local px. */
  stick: { x: number; y: number };
  /** Button centers in overlay-local px, by id. */
  buttons: Partial<Record<TouchButtonId, { x: number; y: number }>>;
  /** Button radius in px (≥ BUTTON_MIN_PX / 2). */
  buttonRadius: number;
}

export interface TouchAdapterOptions {
  player: number;
  layout: TouchLayout;
  /** Which cluster this overlay drives (solo/attack/assist). */
  mode?: TouchClusterMode;
}

/**
 * Multi-touch state machine: one pointer may own the stick, any number may
 * hold buttons; each pointer owns at most one control (stick OR a button).
 * Buttons are edge-triggered (press = one action tick), the stick is
 * proportional and held while its pointer stays down.
 */
export class TouchAdapter {
  private readonly player: number;
  private layout: TouchLayout;
  private mode: TouchClusterMode;
  /** pointer id → control it owns. */
  private readonly owners = new Map<number, TouchButtonId | "stick">();
  /** Currently-held buttons. */
  private readonly held = new Set<TouchButtonId>();
  /** Edge-queued actions for the next frame. */
  private queued: InputFrameActions = { ...EMPTY_ACTIONS, fire: [...EMPTY_ACTIONS.fire] as [boolean, boolean, boolean, boolean] };
  private queuedLaunch = false;
  private queuedPause = false;
  /** Live stick axis ([-1..1] each, deadzone applied). */
  private axisX = 0;
  private axisY = 0;

  constructor(opts: TouchAdapterOptions) {
    this.player = opts.player;
    this.layout = opts.layout;
    this.mode = opts.mode ?? "solo";
  }

  /** Swap cluster mode live (mode transitions mid-session). */
  setMode(mode: TouchClusterMode): void {
    this.mode = mode;
  }

  /** Swap layout live (resize / orientation change). */
  setLayout(layout: TouchLayout): void {
    this.layout = layout;
  }

  /** Which controls the current mode exposes. */
  activeButtons(): TouchButtonId[] {
    return clusterButtons(this.mode);
  }

  /** Pointer went down at overlay-local (x, y). Returns the control it claimed. */
  pointerDown(id: number, x: number, y: number): TouchButtonId | "stick" | null {
    if (this.owners.has(id)) return null; // already owns something
    // Buttons first (they sit above the stick zone, no overlap by layout).
    for (const b of this.activeButtons()) {
      const c = this.layout.buttons[b];
      if (!c) continue;
      if (Math.hypot(x - c.x, y - c.y) <= this.layout.buttonRadius) {
        this.owners.set(id, b);
        this.held.add(b);
        this.queueEdge(b);
        return b;
      }
    }
    // Pause icon (always active, top corner).
    const p = this.layout.buttons.pause;
    if (p && Math.hypot(x - p.x, y - p.y) <= this.layout.buttonRadius) {
      this.owners.set(id, "pause");
      this.queuedPause = true;
      return "pause";
    }
    // Stick: claim within base radius + slack.
    if (Math.hypot(x - this.layout.stick.x, y - this.layout.stick.y) <= STICK_BASE_RADIUS * 1.5) {
      this.owners.set(id, "stick");
      this.updateStick(id, x, y);
      return "stick";
    }
    return null;
  }

  /** Pointer moved (only meaningful for the stick owner). */
  pointerMove(id: number, x: number, y: number): void {
    if (this.owners.get(id) !== "stick") return;
    this.updateStick(id, x, y);
  }

  /** Pointer lifted — releases whatever it owned. */
  pointerUp(id: number): void {
    const owned = this.owners.get(id);
    if (owned === undefined) return;
    this.owners.delete(id);
    if (owned === "stick") {
      this.axisX = 0;
      this.axisY = 0;
    } else if (owned === "pause") {
      // pause is edge-only
    } else {
      this.held.delete(owned);
    }
  }

  /** All pointers gone (context loss) — release everything. */
  releaseAll(): void {
    this.owners.clear();
    this.held.clear();
    this.axisX = 0;
    this.axisY = 0;
  }

  /** Consume the pause edge (app polls this in render, like menu keys). */
  consumePause(): boolean {
    const p = this.queuedPause;
    this.queuedPause = false;
    return p;
  }

  /** Live stick axis (for render feedback / knob position). */
  stickAxis(): { x: number; y: number } {
    return { x: this.axisX, y: this.axisY };
  }

  /** Buttons currently held (for brighten-on-active render). */
  heldButtons(): TouchButtonId[] {
    return [...this.held];
  }

  /** One Input frame per sim tick — same shape as keyboard/mouse/gamepad. */
  sampleFrame(tick: number): InputFrame {
    const frame: InputFrame = {
      player: this.player,
      tick,
      axisX: this.axisX,
      axisY: this.axisY,
      launch: this.queuedLaunch,
      actions: this.queued,
    };
    // Edge actions clear after one tick (buffered max 1 per action, spec §11).
    this.queued = { ...EMPTY_ACTIONS, fire: [...EMPTY_ACTIONS.fire] as [boolean, boolean, boolean, boolean] };
    this.queuedLaunch = false;
    return frame;
  }

  private updateStick(_id: number, x: number, y: number): void {
    const dx = x - this.layout.stick.x;
    const dy = y - this.layout.stick.y;
    const dist = Math.hypot(dx, dy);
    const max = STICK_BASE_RADIUS;
    // Deadzone boundary belongs INSIDE the deadzone (epsilon-safe compare).
    if (dist <= max * STICK_DEADZONE + 1e-9) {
      this.axisX = 0;
      this.axisY = 0;
      return;
    }
    // Proportional beyond the deadzone: (dist - dz) / (max - dz), clamped.
    const t = Math.min(1, (dist - max * STICK_DEADZONE) / (max * (1 - STICK_DEADZONE)));
    this.axisX = (dx / dist) * t;
    this.axisY = (dy / dist) * t;
  }

  private queueEdge(b: TouchButtonId): void {
    switch (b) {
      case "launch":
        this.queuedLaunch = true;
        break;
      case "cycleForward":
        this.queued.cycleForward = true;
        break;
      case "cycleBack":
        this.queued.cycleBack = true;
        break;
      case "fire1":
      case "fire2":
      case "fire3":
      case "fire4": {
        const slot = Number(b.slice(4)) - 1;
        const fire = [...this.queued.fire] as [boolean, boolean, boolean, boolean];
        fire[slot] = true;
        this.queued = { ...this.queued, fire };
        break;
      }
      case "pause":
        this.queuedPause = true;
        break;
    }
  }
}
