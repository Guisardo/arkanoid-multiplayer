import type { InputFrame, InputFrameActions } from "shared/protocol";
import { EMPTY_ACTIONS } from "shared/protocol";

// Keyboard P1 defaults (spec §11): ←/→ move, Space launch, ,/. cycle, 1–4 fire.
// P2: A/D, W launch, Z/C cycle, R/T/F/G fire. Solo: both keysets drive P1.
export interface KeyboardBindings {
  left: readonly string[];
  right: readonly string[];
  launch: readonly string[];
  cycleForward: readonly string[];
  cycleBack: readonly string[];
  fire1: readonly string[];
  fire2: readonly string[];
  fire3: readonly string[];
  fire4: readonly string[];
  /** Menu/pause key — rebindable like every other action (ticket 41). */
  menu: readonly string[];
}

/** Rebindable keyboard action key (ticket 41). */
export type KeyboardBindingsKey = keyof KeyboardBindings;

/** Keyset 1 (arrows). */
export const KEYSET_1: KeyboardBindings = {
  left: ["ArrowLeft"],
  right: ["ArrowRight"],
  launch: ["Space"],
  cycleForward: ["."],
  cycleBack: [","],
  fire1: ["1"],
  fire2: ["2"],
  fire3: ["3"],
  fire4: ["4"],
  menu: ["Escape"],
};

/** Keyset 2 (WASD cluster). */
export const KEYSET_2: KeyboardBindings = {
  left: ["KeyA"],
  right: ["KeyD"],
  launch: ["KeyW"],
  cycleForward: ["KeyC"],
  cycleBack: ["KeyZ"],
  fire1: ["KeyR"],
  fire2: ["KeyT"],
  fire3: ["KeyF"],
  fire4: ["KeyG"],
  menu: ["Escape"],
};

/** Normalized KeyboardEvent.code key (no location variants). */
export type KeyCodeState = ReadonlySet<string>;

export interface KeyboardAdapterOptions {
  player: number;
  /** Solo: both keysets drive P1 (spec §11). */
  mergeKeysets?: boolean;
}

/**
 * Keyboard device adapter: translates pressed-key sets into Input frames
 * (binary ±1/0 axis, edge events). Emits only InputFrame — sim never sees keys.
 */
export class KeyboardAdapter {
  private readonly player: number;
  private bindings: readonly KeyboardBindings[];
  private readonly pressed = new Set<string>();
  private readonly edgeBuffer: Partial<InputFrameActions> = {};
  private launchEdge = false;
  private menuEdge = false;

  constructor(opts: KeyboardAdapterOptions, bindings: readonly KeyboardBindings[]) {
    this.player = opts.player;
    this.bindings = bindings;
  }

  /** Swap bindings live (rebind screen applies without re-creating). */
  setBindings(bindings: readonly KeyboardBindings[]): void {
    this.bindings = bindings;
  }

  /** Drop all buffered edges + pressed keys (settings overlay close). */
  flush(): void {
    this.pressed.clear();
    this.edgeBuffer.cycleForward = false;
    this.edgeBuffer.cycleBack = false;
    this.fire = [false, false, false, false];
    this.launchEdge = false;
    this.menuEdge = false;
  }

  /** Menu-key edge — consumed once (pause/menu, spec §11). */
  consumeMenuEvent(): "pause" | null {
    if (this.menuEdge) {
      this.menuEdge = false;
      return "pause";
    }
    return null;
  }

  /** Feed raw DOM events (down/up). Track pressed set + edge events. */
  keyDown(code: string): void {
    if (!this.pressed.has(code)) {
      this.pressed.add(code);
      this.markEdge(code);
    }
  }

  keyUp(code: string): void {
    this.pressed.delete(code);
  }

  private markEdge(code: string): void {
    for (const b of this.bindings) {
      if (b.launch.includes(code)) this.launchEdge = true;
      if (b.cycleForward.includes(code)) this.edgeBuffer.cycleForward = true;
      if (b.cycleBack.includes(code)) this.edgeBuffer.cycleBack = true;
      if (b.fire1.includes(code)) this.setFire(0);
      if (b.fire2.includes(code)) this.setFire(1);
      if (b.fire3.includes(code)) this.setFire(2);
      if (b.fire4.includes(code)) this.setFire(3);
      if (b.menu.includes(code)) this.menuEdge = true;
    }
  }

  private fire: [boolean, boolean, boolean, boolean] = [false, false, false, false];
  private setFire(i: number): void {
    this.fire[i] = true;
  }

  /** Sample the Input frame for this tick; clears edge events (buffered max 1). */
  sampleFrame(tick: number): InputFrame {
    let axisX = 0;
    for (const b of this.bindings) {
      let left = false;
      let right = false;
      for (const k of b.left) if (this.pressed.has(k)) left = true;
      for (const k of b.right) if (this.pressed.has(k)) right = true;
      // Keyboard quantizes to −1/0/+1 (spec §11); opposite keys cancel.
      // Merge across keysets (solo: both drive P1) — take the first non-zero.
      if (axisX === 0) axisX = (right ? 1 : 0) + (left ? -1 : 0);
    }
    const actions: InputFrameActions = {
      cycleForward: this.edgeBuffer.cycleForward === true,
      cycleBack: this.edgeBuffer.cycleBack === true,
      fire: [...this.fire] as [boolean, boolean, boolean, boolean],
    };
    this.edgeBuffer.cycleForward = false;
    this.edgeBuffer.cycleBack = false;
    this.fire = [false, false, false, false];
    const frame: InputFrame = {
      player: this.player,
      tick,
      axisX,
      axisY: 0,
      launch: this.launchEdge,
      actions,
    };
    this.launchEdge = false;
    return frame;
  }

  /** Build a solo adapter: both keysets drive P1. */
  static solo(): KeyboardAdapter {
    return new KeyboardAdapter({ player: 0 }, [KEYSET_1, KEYSET_2]);
  }

  static player(playerIndex: number): KeyboardAdapter {
    const set = playerIndex === 0 ? KEYSET_1 : KEYSET_2;
    return new KeyboardAdapter({ player: playerIndex }, [set]);
  }

  static emptyActions(): InputFrameActions {
    return EMPTY_ACTIONS;
  }
}
