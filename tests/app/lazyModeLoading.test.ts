// ADR 0007: session creators load their mode sim on demand. A player who
// starts Duel must not pay for Race/Attack/Assist code, and a Solo run must
// not download the multiplayer variants — the mode modules are dynamic
// imports, so these tests prove the import happens at session creation, not
// at module load.
import { describe, expect, it, vi } from "vitest";
import { EMPTY_ACTIONS, type Snapshot } from "shared/protocol";
import { Storage, type StorageBackend } from "persistence/storage";
import { createRoundDuel } from "sim/duel";
import { createRoundSim } from "sim/roundSim";
import { createMultiFieldSession } from "sim/multiField";
import { createVersusBotsSession } from "sim/versusBots";
import type { LevelData } from "content/levelFormat";
import type { HostGamePlayer } from "app/hostGame";

vi.mock("sim/duel", () => ({
  createRoundDuel: vi.fn((_level: LevelData, opts: { playerNames?: string[] }) => ({
    currentTick: 0,
    step: () => undefined,
    snapshot: () => snap(),
    getMatchResult: () => null,
    playerNames: opts.playerNames ?? [],
  })),
}));

vi.mock("sim/roundSim", () => ({
  createRoundSim: vi.fn(() => ({
    currentTick: 0,
    step: () => undefined,
    snapshot: () => snap(),
    debugSetBall: () => undefined,
  })),
}));

vi.mock("sim/multiField", () => ({
  createMultiFieldSession: vi.fn(() => ({
    playerCount: 1,
    step: () => undefined,
    snapshots: () => [snap()],
    state: () => ({
      round: 1,
      roundPoints: [0],
      levelsCleared: [0],
      bricksThisLevel: [0],
      matchWinner: null,
      phase: "playing" as const,
    }),
    setNextRound: () => undefined,
    debugSetBall: () => undefined,
    simAt: () => undefined,
  })),
}));

function snap(round = 1): Snapshot {
  return {
    tick: 0,
    phase: "serve",
    round,
    players: [
      {
        player: 0,
        name: "P1",
        skinIndex: 0,
        paddle: { x: 0, y: 0, w: 32, h: 6, edge: "bottom" },
        lives: 3,
        score: 0,
        meter: 0,
        target: -1,
        chain: 0,
        state: "playing",
        effects: {},
      },
    ],
    balls: [],
    capsules: [],
    bricks: [],
    events: [],
    inputAcks: [0],
  };
}

function fakeBackend(): StorageBackend {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

const noopSend = (): void => undefined;

const duelPlayers: HostGamePlayer[] = [
  { player: 0, name: "Host", skinIndex: 0, guestIndex: -1 },
  { player: 1, name: "Guest", skinIndex: 1, guestIndex: 0 },
];

const raceConfig = {
  mode: "race" as const,
  matchStructure: "oneOff" as const,
  bestOf: 1,
  levelSelection: "hostPick" as const,
  hostPickRound: 1,
  timeCapTicks: null,
  themeId: "t",
};

describe("session creators lazy-load their mode sim (ADR 0007)", () => {
  it("importing the host session module builds no mode sim", async () => {
    const hostGame = await import("app/hostGame");
    expect(vi.mocked(createRoundDuel)).not.toHaveBeenCalled();
    expect(vi.mocked(createMultiFieldSession)).not.toHaveBeenCalled();
    expect(hostGame.createHostGameSession).toBeTypeOf("function");
  });

  it("a duel host session imports sim/duel on demand and drives it", async () => {
    vi.mocked(createRoundDuel).mockClear();
    const { createHostGameSession } = await import("app/hostGame");
    const session = await createHostGameSession(
      {
        mode: "duel",
        config: { ...raceConfig, mode: "duel" },
        players: duelPlayers,
        hostLocalPlayers: [0],
      },
      noopSend,
    );
    // Built exactly once, from the preloaded level data.
    expect(vi.mocked(createRoundDuel)).toHaveBeenCalledTimes(1);
    const [level, opts] = vi.mocked(createRoundDuel).mock.calls[0] ?? [];
    expect(level?.round).toBe(1);
    expect(opts?.playerNames).toEqual(["Host", "Guest"]);
    session.tick([{ player: 0, tick: 0, axisX: 0, axisY: 0, launch: false, actions: EMPTY_ACTIONS }]);
    expect(session.snapshots()[0]?.round).toBe(1);
  });

  it("a race host session imports sim/multiField on demand", async () => {
    vi.mocked(createMultiFieldSession).mockClear();
    const { createHostGameSession } = await import("app/hostGame");
    const session = await createHostGameSession(
      {
        mode: "race",
        config: raceConfig,
        players: [{ player: 0, name: "Host", skinIndex: 0, guestIndex: -1 }],
        hostLocalPlayers: [0],
      },
      noopSend,
    );
    expect(vi.mocked(createMultiFieldSession)).toHaveBeenCalledTimes(1);
    session.tick([{ player: 0, tick: 0, axisX: 0, axisY: 0, launch: false, actions: EMPTY_ACTIONS }]);
    expect(session.snapshots()).toHaveLength(1);
  });

  it("a solo episode imports sim/roundSim on demand", async () => {
    vi.mocked(createRoundSim).mockClear();
    const { createSoloEpisode } = await import("app/soloEpisode");
    const episode = await createSoloEpisode({ storage: new Storage(fakeBackend()) });
    expect(vi.mocked(createRoundSim)).toHaveBeenCalledTimes(1);
    const [level] = vi.mocked(createRoundSim).mock.calls[0] ?? [];
    expect(level?.round).toBe(1);
    expect(episode.round()).toBe(1);
    episode.step([{ player: 0, tick: 0, axisX: 0, axisY: 0, launch: false, actions: EMPTY_ACTIONS }]);
    expect(episode.snapshot().phase).toBe("serve");
  });

  it("a duel versus-bots session imports sim/duel on demand", async () => {
    vi.mocked(createRoundDuel).mockClear();
    const session = await createVersusBotsSession({ variant: "duel", humans: 1, bots: 1, seed: 3 });
    expect(vi.mocked(createRoundDuel)).toHaveBeenCalledTimes(1);
    expect(session.variant).toBe("duel");
  });
});
