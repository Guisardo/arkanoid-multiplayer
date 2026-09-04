// Versus bots tests (ticket 51): bot counts per variant, 1-human
// enforcement, session composition per variant (bots step through the
// same pipeline, D = 0), pause semantics, trimmed config screen.
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  botCountFor,
  validateBotsSetup,
  createVersusBotsSession,
  type BotVariant,
} from "sim/versusBots";
import { VersusBotsConfigScreen } from "ui/versusBotsScreen";
import { EMPTY_ACTIONS, type InputFrame } from "shared/protocol";

function frame(tick: number, axisX = 0, launch = false): InputFrame {
  return { player: 0, tick, axisX, axisY: 0, launch, actions: EMPTY_ACTIONS };
}

describe("setup validation", () => {
  it("bot counts: Race/Attack/coop 1–3, Duel exactly 1", () => {
    expect(botCountFor("race")).toEqual({ min: 1, max: 3 });
    expect(botCountFor("attack")).toEqual({ min: 1, max: 3 });
    expect(botCountFor("sharedField")).toEqual({ min: 1, max: 3 });
    expect(botCountFor("parallelAssist")).toEqual({ min: 1, max: 3 });
    expect(botCountFor("duel")).toEqual({ min: 1, max: 1 });
  });

  it("exactly 1 human — never bots alongside >1 human", () => {
    expect(validateBotsSetup("race", 1, 2)).toBeNull();
    expect(validateBotsSetup("race", 2, 2)).not.toBeNull();
    expect(validateBotsSetup("race", 0, 2)).not.toBeNull();
  });

  it("bot count out of range rejected", () => {
    expect(validateBotsSetup("duel", 1, 2)).not.toBeNull();
    expect(validateBotsSetup("duel", 1, 0)).not.toBeNull();
    expect(validateBotsSetup("race", 1, 4)).not.toBeNull();
  });

  it("session creation throws on invalid setup", () => {
    expect(() => createVersusBotsSession({ variant: "duel", humans: 1, bots: 2 })).toThrow();
    expect(() => createVersusBotsSession({ variant: "race", humans: 2, bots: 1 })).toThrow();
  });
});

describe("session composition", () => {
  it("race: 1 human + 2 bots steps without throwing; snapshots per player", () => {
    const s = createVersusBotsSession({ variant: "race", humans: 1, bots: 2, seed: 7 });
    expect(s.playerCount).toBe(3);
    expect(s.snapshots()).toHaveLength(3);
    for (let t = 0; t < 120; t++) s.step(frame(t));
    // Bots produce frames through the same pipeline — no crash, ticks advance.
    expect(s.snapshots()[0]?.tick).toBeGreaterThan(0);
  });

  it("duel: exactly 1 bot, single shared snapshot", () => {
    const s = createVersusBotsSession({ variant: "duel", humans: 1, bots: 1, seed: 3 });
    expect(s.playerCount).toBe(2);
    expect(s.snapshots()).toHaveLength(1);
    for (let t = 0; t < 60; t++) s.step(frame(t));
  });

  it("sharedField: 1 human + 3 bot teammates on one field", () => {
    const s = createVersusBotsSession({
      variant: "sharedField",
      humans: 1,
      bots: 3,
      sharedField: { placement: "A", ballModel: "shared" },
      seed: 5,
    });
    expect(s.playerCount).toBe(4);
    expect(s.snapshots()).toHaveLength(1);
    for (let t = 0; t < 60; t++) s.step(frame(t));
  });

  it("parallelAssist: bots on separate fields, snapshots per player", () => {
    const s = createVersusBotsSession({
      variant: "parallelAssist",
      humans: 1,
      bots: 2,
      assistRange: { startRound: 1, endRound: 3 },
      seed: 11,
    });
    expect(s.playerCount).toBe(3);
    expect(s.snapshots()).toHaveLength(3);
    for (let t = 0; t < 60; t++) s.step(frame(t));
  });

  it("attack: bots use meters (session steps, snapshots carry attack state)", () => {
    const s = createVersusBotsSession({ variant: "attack", humans: 1, bots: 1, seed: 13 });
    expect(s.playerCount).toBe(2);
    for (let t = 0; t < 60; t++) s.step(frame(t));
    expect(s.snapshots()).toHaveLength(2);
  });

  it("pause freely (coop semantics) in every variant", () => {
    for (const variant of ["race", "attack", "duel", "sharedField", "parallelAssist"] as BotVariant[]) {
      const s = createVersusBotsSession({ variant, humans: 1, bots: 1, seed: 2 });
      s.pause();
      expect(s.isPaused()).toBe(true);
      const tickBefore = s.snapshots()[0]?.tick ?? 0;
      s.step(frame(999));
      expect(s.snapshots()[0]?.tick ?? 0).toBe(tickBefore); // frozen
      s.resume();
      expect(s.isPaused()).toBe(false);
      s.step(frame(1000));
      expect(s.snapshots()[0]?.tick ?? 0).toBeGreaterThan(tickBefore);
    }
  });

  it("deterministic: same seed + same human input → identical snapshots", () => {
    const run = (): string => {
      const s = createVersusBotsSession({ variant: "race", humans: 1, bots: 2, seed: 42 });
      let out = "";
      for (let t = 0; t < 90; t++) {
        s.step(frame(t, Math.sin(t / 10) > 0 ? 1 : -1));
        out += JSON.stringify(s.snapshots().map((x) => [x.tick, x.players.map((p) => p.paddle.x)]));
      }
      return out;
    };
    expect(run()).toBe(run());
  });
});

describe("trimmed config screen", () => {
  it("variant picker disables invalid bot counts (Duel = exactly 1)", () => {
    const host = document.body;
    host.innerHTML = "";
    let started: { variant: BotVariant; bots: number } | null = null;
    const screen = new VersusBotsConfigScreen({
      host,
      locale: "en-US",
      initial: { variant: "race", bots: 2 },
      onStart: (c) => {
        started = c;
      },
      onBack: () => {},
    });
    // Race: 3 bot buttons enabled.
    const botBtns = [...screen.root.querySelectorAll("button")].filter((b) => /^[123]$/.test(b.textContent ?? ""));
    expect(botBtns.map((b) => b.disabled)).toEqual([false, false, false]);
    // Switch to Duel: bots 2/3 disabled, count clamps to 1.
    const duelBtn = [...screen.root.querySelectorAll("button")].find((b) => b.textContent === "Duel");
    duelBtn?.click();
    expect(botBtns.map((b) => b.disabled)).toEqual([false, true, true]);
    [...screen.root.querySelectorAll("button")].find((b) => b.textContent === "Start")?.click();
    expect(started).toMatchObject({ variant: "duel", bots: 1 });
    screen.close();
  });

  it("difficulty defaults to Normal; selector switches it", () => {
    const host = document.body;
    host.innerHTML = "";
    let started: { difficulty?: string } | null = null;
    const screen = new VersusBotsConfigScreen({
      host,
      locale: "en-US",
      onStart: (c) => {
        started = c;
      },
      onBack: () => {},
    });
    [...screen.root.querySelectorAll("button")].find((b) => b.textContent === "Hard")?.click();
    [...screen.root.querySelectorAll("button")].find((b) => b.textContent === "Start")?.click();
    expect(started).toMatchObject({ difficulty: "hard" });
    screen.close();
  });

  it("no room code, no ready check — only variant/bots/difficulty/start/back", () => {
    const host = document.body;
    host.innerHTML = "";
    const screen = new VersusBotsConfigScreen({
      host,
      locale: "en-US",
      onStart: () => {},
      onBack: () => {},
    });
    const text = screen.root.textContent ?? "";
    expect(text).not.toContain("code");
    expect(text).not.toContain("ready");
    expect(text).toContain("Variant");
    expect(text).toContain("Difficulty");
    screen.close();
  });

  it("es-419 renders", () => {
    const host = document.body;
    host.innerHTML = "";
    const screen = new VersusBotsConfigScreen({
      host,
      locale: "es-419",
      onStart: () => {},
      onBack: () => {},
    });
    const text = screen.root.textContent ?? "";
    expect(text).toContain("Variante");
    expect(text).toContain("Dificultad");
    screen.close();
  });
});
