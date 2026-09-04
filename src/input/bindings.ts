// Rebind model (ticket 41, spec §11): keyboard fully rebindable incl. menu
// keys; gamepad buttons rebindable (movement fixed); touch/mouse fixed.
// Pure data + pure functions — adapters consume the maps. Corrupt stored
// maps fall back to defaults, never throw.

import { KEYSET_1, KEYSET_2, type KeyboardBindings } from "input/keyboard";
import { DEFAULT_GAMEPAD_MAP, type GamepadBindingsMap, type GamepadButton } from "input/gamepad";

/** Rebindable keyboard actions (movement + gameplay + menu). */
export const KEYBOARD_ACTIONS = [
  "left",
  "right",
  "launch",
  "cycleForward",
  "cycleBack",
  "fire1",
  "fire2",
  "fire3",
  "fire4",
  "menu",
] as const;
export type KeyboardAction = (typeof KEYBOARD_ACTIONS)[number];

/** Rebindable gamepad actions — movement (stick/d-pad) stays fixed. */
export const GAMEPAD_ACTIONS = [
  "launch",
  "cycleForward",
  "cycleBack",
  "fire1",
  "fire2",
  "fire3",
  "fire4",
  "menu",
] as const;
export type GamepadAction = (typeof GAMEPAD_ACTIONS)[number];

/** Per-player keyboard map: action → bound key codes. */
export type KeyboardBindingsMap = readonly KeyboardBindings[];
/** Gamepad map (shared shape across players): action → bound buttons. */
export type { GamepadBindingsMap } from "input/gamepad";

/** Default keyboard bindings per local player (spec §11 keysets + menu). */
export const DEFAULT_KEYBOARD_BINDINGS: KeyboardBindingsMap = [
  { ...KEYSET_1, menu: ["Escape"] },
  { ...KEYSET_2, menu: ["Escape"] },
];

/** Default gamepad bindings (spec §11). */
export const DEFAULT_GAMEPAD_BINDINGS: GamepadBindingsMap = DEFAULT_GAMEPAD_MAP;

export interface KeyboardConflict {
  player: number;
  action: KeyboardAction;
  key: string;
}

export interface GamepadConflict {
  action: GamepadAction;
  button: GamepadButton;
}

function isStringArray(v: unknown): v is string[] {
  return (
    Array.isArray(v) && v.length > 0 && v.every((k) => typeof k === "string" && k.length > 0)
  );
}

function parseKeyboardEntry(raw: unknown, fallback: KeyboardBindings): KeyboardBindings {
  if (typeof raw !== "object" || raw === null) return fallback;
  const rec = raw as Record<string, unknown>;
  const out: KeyboardBindings = {
    left: isStringArray(rec.left) ? rec.left : fallback.left,
    right: isStringArray(rec.right) ? rec.right : fallback.right,
    launch: isStringArray(rec.launch) ? rec.launch : fallback.launch,
    cycleForward: isStringArray(rec.cycleForward) ? rec.cycleForward : fallback.cycleForward,
    cycleBack: isStringArray(rec.cycleBack) ? rec.cycleBack : fallback.cycleBack,
    fire1: isStringArray(rec.fire1) ? rec.fire1 : fallback.fire1,
    fire2: isStringArray(rec.fire2) ? rec.fire2 : fallback.fire2,
    fire3: isStringArray(rec.fire3) ? rec.fire3 : fallback.fire3,
    fire4: isStringArray(rec.fire4) ? rec.fire4 : fallback.fire4,
    menu: isStringArray(rec.menu) ? rec.menu : fallback.menu,
  };
  return out;
}

/** Parse stored keyboard maps; corrupt/partial data falls back per-player. */
export function parseKeyboardBindings(json: string | null): KeyboardBindingsMap {
  if (json === null) return DEFAULT_KEYBOARD_BINDINGS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return DEFAULT_KEYBOARD_BINDINGS;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_KEYBOARD_BINDINGS;
  return parsed.slice(0, 4).map((entry, i) => {
    // Corrupt entries fall back to that player's default keyset — never a
    // duplicate of another player's live keys (no phantom conflicts).
    const fallback = DEFAULT_KEYBOARD_BINDINGS[i] ?? KEYSET_1;
    return parseKeyboardEntry(entry, fallback);
  });
}

export function serializeKeyboardBindings(maps: KeyboardBindingsMap): string {
  return JSON.stringify(maps);
}

const GAMEPAD_BUTTONS: readonly GamepadButton[] = [
  "a", "b", "x", "y", "lb", "rb", "rt", "lt", "start",
  "dpadLeft", "dpadRight", "dpadUp", "dpadDown",
];

function isGamepadButton(v: string): v is GamepadButton {
  return (GAMEPAD_BUTTONS as readonly string[]).includes(v);
}

function parseGamepadEntry(raw: unknown): GamepadBindingsMap | null {
  if (typeof raw !== "object" || raw === null) return null;
  const rec = raw as Record<string, unknown>;
  const out: Partial<Record<GamepadAction, readonly GamepadButton[]>> = {};
  for (const action of GAMEPAD_ACTIONS) {
    const v = rec[action];
    if (!isStringArray(v)) return null;
    if (!v.every(isGamepadButton)) return null;
    out[action] = v;
  }
  return out as GamepadBindingsMap;
}

/** Parse stored gamepad map; any corrupt action falls back to defaults. */
export function parseGamepadBindings(json: string | null): GamepadBindingsMap {
  if (json === null) return DEFAULT_GAMEPAD_BINDINGS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return DEFAULT_GAMEPAD_BINDINGS;
  }
  const entry = parseGamepadEntry(parsed);
  return entry ?? DEFAULT_GAMEPAD_BINDINGS;
}

export function serializeGamepadBindings(map: GamepadBindingsMap): string {
  return JSON.stringify(map);
}

/**
 * Duplicate-binding detection across ALL local players' maps on the device
 * (spec §11). Menu is a global action — shared menu keys are not conflicts.
 * Pairwise: every (player, action) pair sharing a key is flagged.
 */
export function findKeyboardConflicts(maps: KeyboardBindingsMap): KeyboardConflict[] {
  const conflicts: KeyboardConflict[] = [];
  // key → all (player, action) claims so far.
  const claims = new Map<string, { player: number; action: KeyboardAction }[]>();
  for (let player = 0; player < maps.length; player++) {
    const map = maps[player];
    if (map === undefined) continue;
    for (const action of KEYBOARD_ACTIONS) {
      for (const key of map[action]) {
        const list = claims.get(key) ?? [];
        list.push({ player, action });
        claims.set(key, list);
      }
    }
  }
  for (const [key, list] of claims) {
    // Conflict iff a non-menu claim shares the key with anything else.
    // Menu+menu alone is fine (shared global menu key); menu vs gameplay is not.
    const hasNonMenu = list.some((c) => c.action !== "menu");
    if (hasNonMenu && list.length > 1) {
      for (const c of list) {
        conflicts.push({ player: c.player, action: c.action, key });
      }
    }
  }
  return conflicts;
}

/** Duplicate-binding detection for the gamepad map (pairwise). */
export function findGamepadConflicts(map: GamepadBindingsMap): GamepadConflict[] {
  const conflicts: GamepadConflict[] = [];
  const claims = new Map<GamepadButton, GamepadAction[]>();
  for (const action of GAMEPAD_ACTIONS) {
    for (const button of map[action]) {
      const list = claims.get(button) ?? [];
      list.push(action);
      claims.set(button, list);
    }
  }
  for (const [button, actions] of claims) {
    if (actions.length > 1) {
      for (const action of actions) {
        conflicts.push({ action, button });
      }
    }
  }
  return conflicts;
}
