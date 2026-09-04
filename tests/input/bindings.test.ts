import { describe, expect, it } from "vitest";
import {
  KEYBOARD_ACTIONS,
  GAMEPAD_ACTIONS,
  DEFAULT_KEYBOARD_BINDINGS,
  DEFAULT_GAMEPAD_BINDINGS,
  serializeKeyboardBindings,
  parseKeyboardBindings,
  serializeGamepadBindings,
  parseGamepadBindings,
  findKeyboardConflicts,
  findGamepadConflicts,
  type KeyboardBindingsMap,
  type GamepadBindingsMap,
} from "input/bindings";

describe("bindings model (ticket 41)", () => {
  it("keyboard defaults match spec §11 keysets", () => {
    expect(DEFAULT_KEYBOARD_BINDINGS[0]).toEqual({
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
    });
    expect(DEFAULT_KEYBOARD_BINDINGS[1]).toEqual({
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
    });
  });

  it("gamepad defaults match spec §11", () => {
    expect(DEFAULT_GAMEPAD_BINDINGS).toEqual({
      launch: ["a"],
      cycleForward: ["rb"],
      cycleBack: ["lb"],
      fire1: ["x"],
      fire2: ["y"],
      fire3: ["b"],
      fire4: ["rt"],
      menu: ["start"],
    });
  });

  it("every keyboard action is rebindable incl. menu (spec §11)", () => {
    expect(KEYBOARD_ACTIONS).toContain("menu");
    expect(KEYBOARD_ACTIONS).toContain("left");
    expect(KEYBOARD_ACTIONS).toContain("fire4");
  });

  it("gamepad actions exclude movement (fixed, spec §11)", () => {
    expect(GAMEPAD_ACTIONS).not.toContain("left");
    expect(GAMEPAD_ACTIONS).not.toContain("dpadLeft");
    expect(GAMEPAD_ACTIONS).toContain("launch");
  });

  it("keyboard serialize → parse round-trips", () => {
    const maps: KeyboardBindingsMap = [
      { ...DEFAULT_KEYBOARD_BINDINGS[0]!, launch: ["KeyP"], menu: ["F2"] },
      DEFAULT_KEYBOARD_BINDINGS[1]!,
    ];
    const json = serializeKeyboardBindings(maps);
    expect(parseKeyboardBindings(json)).toEqual(maps);
  });

  it("gamepad serialize → parse round-trips", () => {
    const map: GamepadBindingsMap = { ...DEFAULT_GAMEPAD_BINDINGS, launch: ["x"], fire1: ["a"] };
    expect(parseGamepadBindings(serializeGamepadBindings(map))).toEqual(map);
  });

  it("corrupt keyboard JSON falls back to defaults, never throws", () => {
    expect(parseKeyboardBindings("{corrupt!!")).toEqual(DEFAULT_KEYBOARD_BINDINGS);
    expect(parseKeyboardBindings("null")).toEqual(DEFAULT_KEYBOARD_BINDINGS);
    expect(parseKeyboardBindings("42")).toEqual(DEFAULT_KEYBOARD_BINDINGS);
  });

  it("corrupt gamepad JSON falls back to defaults, never throws", () => {
    expect(parseGamepadBindings("not json")).toEqual(DEFAULT_GAMEPAD_BINDINGS);
    expect(parseGamepadBindings("[]")).toEqual(DEFAULT_GAMEPAD_BINDINGS);
  });

  it("partial/corrupt keyboard entries fall back per-player", () => {
    // Player 0 valid, player 1 garbage → player 1 falls back to defaults.
    const json = JSON.stringify([
      { ...DEFAULT_KEYBOARD_BINDINGS[0]!, launch: ["KeyP"] },
      { launch: "not-an-array" },
    ]);
    const parsed = parseKeyboardBindings(json);
    expect(parsed[0]!.launch).toEqual(["KeyP"]);
    expect(parsed[1]).toEqual(DEFAULT_KEYBOARD_BINDINGS[1]);
  });

  it("keyboard conflict detection flags duplicates within one player", () => {
    const maps: KeyboardBindingsMap = [
      { ...DEFAULT_KEYBOARD_BINDINGS[0]!, launch: ["1"], fire1: ["1"] },
    ];
    const conflicts = findKeyboardConflicts(maps);
    expect(conflicts).toEqual([
      { player: 0, action: "fire1", key: "1" },
      { player: 0, action: "launch", key: "1" },
    ]);
  });

  it("keyboard conflict detection checks across all local players", () => {
    const maps: KeyboardBindingsMap = [
      DEFAULT_KEYBOARD_BINDINGS[0]!,
      { ...DEFAULT_KEYBOARD_BINDINGS[1]!, fire1: ["Space"] },
    ];
    // P0 launch=Space vs P1 fire1=Space → both flagged.
    expect(findKeyboardConflicts(maps)).toEqual([
      { player: 1, action: "fire1", key: "Space" },
      { player: 0, action: "launch", key: "Space" },
    ]);
  });

  it("menu key shared across players is not a conflict (global action)", () => {
    // Both default maps bind Escape to menu — no conflict expected.
    expect(findKeyboardConflicts(DEFAULT_KEYBOARD_BINDINGS)).toEqual([]);
  });

  it("gamepad conflict detection flags duplicates", () => {
    const map: GamepadBindingsMap = { ...DEFAULT_GAMEPAD_BINDINGS, launch: ["x"], fire1: ["x"] };
    expect(findGamepadConflicts(map)).toEqual([
      { action: "fire1", button: "x" },
      { action: "launch", button: "x" },
    ]);
    expect(findGamepadConflicts(DEFAULT_GAMEPAD_BINDINGS)).toEqual([]);
  });

  it("defaults are conflict-free", () => {
    expect(findKeyboardConflicts(DEFAULT_KEYBOARD_BINDINGS)).toEqual([]);
    expect(findGamepadConflicts(DEFAULT_GAMEPAD_BINDINGS)).toEqual([]);
  });
});
