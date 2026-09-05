// Ticket 44 tests: skin/theme lobby override + session sync.
// Reducer (setPlayerSkin/setPlayerName/themeId config), skinSync (UUID→index
// assignment, bot auto-assign), sims (skinIndex flows to snapshots),
// versusBots (distinct bot skins), serializer roundtrip with non-zero
// indices, screens (picker renders, host/guest visibility).
import { describe, expect, it } from "vitest";
import {
  createLobbyState,
  reduceLobby,
  DEFAULT_CONFIG,
  type LobbyState,
} from "app/lobbyState";
import { assignSkinIndices, autoAssignBotSkins, skinUuidFor } from "content/skinSync";
import { SKINS, DEFAULT_SKIN_ID } from "content/skins";
import { THEMES, DEFAULT_THEME_ID } from "content/themes";
import { createRoundSim } from "sim/roundSim";
import { createMultiFieldSession } from "sim/multiField";
import { createSharedFieldSim } from "sim/sharedField";
import { createRoundDuel } from "sim/duel";
import { createVersusBotsSession } from "sim/versusBots";
import { getLevel } from "content/levels";
import { serializeSnapshot, deserializeSnapshot } from "net/serializer";

function hostLobby(): LobbyState {
  return createLobbyState(true);
}

describe("lobby reducer: skins + theme (ticket 44)", () => {
  it("players start with the default skin UUID", () => {
    const s = hostLobby();
    expect(s.players[0]?.skinId).toBe(DEFAULT_SKIN_ID);
  });

  it("setPlayerSkin overrides a local player's skin", () => {
    let s = hostLobby();
    const neon = SKINS[1]?.id ?? "";
    s = reduceLobby(s, { type: "setPlayerSkin", playerId: 0, skinId: neon }).state;
    expect(s.players[0]?.skinId).toBe(neon);
  });

  it("setPlayerSkin with unknown UUID falls back to default", () => {
    let s = hostLobby();
    s = reduceLobby(s, { type: "setPlayerSkin", playerId: 0, skinId: "not-a-uuid" }).state;
    expect(s.players[0]?.skinId).toBe(DEFAULT_SKIN_ID);
  });

  it("setPlayerSkin on missing player errors", () => {
    const s = hostLobby();
    expect(reduceLobby(s, { type: "setPlayerSkin", playerId: 9, skinId: DEFAULT_SKIN_ID }).error)
      .toBe("playerNotFound");
  });

  it("addLocalPlayer carries the device default skin", () => {
    let s = hostLobby();
    const neon = SKINS[1]?.id ?? "";
    s = reduceLobby(s, { type: "addLocalPlayer", skinId: neon }).state;
    expect(s.players[1]?.skinId).toBe(neon);
  });

  it("remoteJoined carries the full skin UUID (wire rule, spec §13)", () => {
    let s = hostLobby();
    const retro = SKINS[2]?.id ?? "";
    s = reduceLobby(s, { type: "remoteJoined", guestIndex: 0, name: "Guest", skinId: retro }).state;
    expect(s.players[1]?.skinId).toBe(retro);
    // Unknown UUID → default, never a crash.
    s = reduceLobby(s, { type: "remoteJoined", guestIndex: 1, name: "G2", skinId: "junk" }).state;
    expect(s.players[2]?.skinId).toBe(DEFAULT_SKIN_ID);
  });

  it("setPlayerName trims, caps at 12, never empties", () => {
    let s = hostLobby();
    s = reduceLobby(s, { type: "setPlayerName", playerId: 0, name: "  Ace  " }).state;
    expect(s.players[0]?.name).toBe("Ace");
    s = reduceLobby(s, { type: "setPlayerName", playerId: 0, name: "X".repeat(30) }).state;
    expect(s.players[0]?.name).toHaveLength(12);
    const before = s.players[0]?.name ?? "";
    s = reduceLobby(s, { type: "setPlayerName", playerId: 0, name: "   " }).state;
    expect(s.players[0]?.name).toBe(before);
  });

  it("host sets theme via setConfig; unknown theme keeps current", () => {
    let s = hostLobby();
    expect(s.config.themeId).toBe(DEFAULT_THEME_ID);
    const deep = THEMES[1]?.id ?? "";
    s = reduceLobby(s, { type: "setConfig", config: { themeId: deep } }).state;
    expect(s.config.themeId).toBe(deep);
    s = reduceLobby(s, { type: "setConfig", config: { themeId: "junk" } }).state;
    expect(s.config.themeId).toBe(deep);
  });

  it("theme change resets ready checks (config change rule)", () => {
    let s = hostLobby();
    s = reduceLobby(s, { type: "setReady", playerId: 0, ready: true }).state;
    expect(s.players[0]?.ready).toBe(true);
    s = reduceLobby(s, { type: "setConfig", config: { themeId: THEMES[2]?.id ?? "" } }).state;
    expect(s.players[0]?.ready).toBe(false);
  });

  it("guests cannot set config (theme included)", () => {
    const s = createLobbyState(false);
    expect(reduceLobby(s, { type: "setConfig", config: { themeId: THEMES[1]?.id ?? "" } }).error)
      .toBe("notHost");
  });

  it("DEFAULT_CONFIG carries the default theme UUID", () => {
    expect(DEFAULT_CONFIG.themeId).toBe(DEFAULT_THEME_ID);
  });
});

describe("skinSync: UUID → compact session index (ticket 44)", () => {
  it("distinct UUIDs get first-appearance indices 0,1,2…", () => {
    const a = SKINS[0]?.id ?? "a";
    const b = SKINS[1]?.id ?? "b";
    const c = SKINS[2]?.id ?? "c";
    const r = assignSkinIndices([b, a, b, c, a]);
    expect(r.indices).toEqual([0, 1, 0, 2, 1]);
    expect(r.uuids).toEqual([b, a, c]);
  });

  it("deterministic: same input → same output", () => {
    const ids = [SKINS[1]?.id ?? "", SKINS[0]?.id ?? "", SKINS[1]?.id ?? ""];
    expect(assignSkinIndices(ids)).toEqual(assignSkinIndices(ids));
  });

  it("skinUuidFor resolves session indices; out-of-range falls back to default", () => {
    const a = SKINS[0]?.id ?? "";
    const b = SKINS[1]?.id ?? "";
    const r = assignSkinIndices([b, a]);
    expect(skinUuidFor(r, 0)).toBe(b);
    expect(skinUuidFor(r, 1)).toBe(a);
    expect(skinUuidFor(r, 99)).toBe(DEFAULT_SKIN_ID);
  });

  it("autoAssignBotSkins never collides with human choices", () => {
    const human = SKINS[0]?.id ?? "";
    const bots = autoAssignBotSkins([human], 2);
    expect(bots).toHaveLength(2);
    for (const b of bots) expect(b).not.toBe(human);
    expect(new Set(bots).size).toBe(bots.length); // distinct among bots
  });

  it("autoAssignBotSkins wraps deterministically when bots outnumber free skins", () => {
    const human = SKINS[0]?.id ?? "";
    const bots = autoAssignBotSkins([human], 5);
    expect(bots).toHaveLength(5);
    for (const b of bots) expect(b).not.toBe(human);
    expect(bots).toEqual(autoAssignBotSkins([human], 5));
  });
});

describe("sims: skinIndex flows to snapshots (ticket 44)", () => {
  it("roundSim carries the option into PlayerSnapshot", () => {
    const sim = createRoundSim(getLevel(1), { lives: 3, score: 0, skinIndex: 2 });
    expect(sim.snapshot().players[0]?.skinIndex).toBe(2);
  });

  it("roundSim defaults to 0", () => {
    const sim = createRoundSim(getLevel(1), { lives: 3, score: 0 });
    expect(sim.snapshot().players[0]?.skinIndex).toBe(0);
  });

  it("multiField passes per-player indices (incl. after field reset)", () => {
    const sim = createMultiFieldSession({
      playerCount: 3,
      config: { structure: "oneOff", bestOf: 1, levelSelection: "hostPick", hostPickRound: 1, timeCapTicks: null },
      skinIndices: [2, 0, 1],
    });
    const snaps = sim.snapshots();
    expect(snaps[0]?.players[0]?.skinIndex).toBe(2);
    expect(snaps[1]?.players[0]?.skinIndex).toBe(0);
    expect(snaps[2]?.players[0]?.skinIndex).toBe(1);
  });

  it("sharedField passes per-player indices", () => {
    const sim = createSharedFieldSim(getLevel(1), {
      placement: "A",
      ballModel: "shared",
      playerCount: 3,
      skinIndices: [1, 2, 0],
    });
    const players = sim.snapshot().players;
    expect(players[0]?.skinIndex).toBe(1);
    expect(players[1]?.skinIndex).toBe(2);
    expect(players[2]?.skinIndex).toBe(0);
  });

  it("duel passes [p0, p1] indices", () => {
    const sim = createRoundDuel(getLevel(1), {
      ballModel: "shared",
      timeCapTicks: null,
      skinIndices: [2, 1],
    });
    const players = sim.snapshot().players;
    expect(players[0]?.skinIndex).toBe(2);
    expect(players[1]?.skinIndex).toBe(1);
  });
});

describe("versusBots: distinct bot skins (ticket 44)", () => {
  it("bots get skins distinct from the human's choice, per variant", () => {
    for (const variant of ["race", "attack", "duel", "sharedField", "parallelAssist"] as const) {
      const human = SKINS[1]?.id ?? "";
      const session = createVersusBotsSession({
        variant,
        humans: 1,
        bots: variant === "duel" ? 1 : 3,
        humanSkinId: human,
      });
      const snaps = session.snapshots();
      const indices = snaps.flatMap((s) => s.players.map((p) => p.skinIndex));
      // Human index 0; every bot index differs from it.
      for (let i = 1; i < indices.length; i++) {
        expect(indices[i]).not.toBe(indices[0]);
      }
    }
  });

  it("default human skin when none given", () => {
    const session = createVersusBotsSession({ variant: "race", humans: 1, bots: 2 });
    const snaps = session.snapshots();
    expect(snaps[0]?.players[0]?.skinIndex).toBe(0);
  });
});

describe("serializer: skinIndex roundtrip (ticket 44)", () => {
  it("non-zero skin indices survive serialize → deserialize", () => {
    const sim = createMultiFieldSession({
      playerCount: 3,
      config: { structure: "oneOff", bestOf: 1, levelSelection: "hostPick", hostPickRound: 1, timeCapTicks: null },
      skinIndices: [2, 1, 0],
    });
    for (const snap of sim.snapshots()) {
      const back = deserializeSnapshot(serializeSnapshot(snap));
      expect(back.players[0]?.skinIndex).toBe(snap.players[0]?.skinIndex);
    }
  });
});
