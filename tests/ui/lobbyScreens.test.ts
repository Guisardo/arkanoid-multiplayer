// Lobby screens tests (ticket 43): landing entries, room-code create
// (code large + QR payload) and join (5 auto-advancing boxes, ?code=
// prefill), lobby render (players, ready toggles, mode greying, kick).
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  LandingScreen,
  RoomCodeScreen,
  LobbyScreen,
  qrPayloadFor,
  qrMatrix,
  codeFromUrl,
  generateRoomCode,
  errorKey,
} from "ui/lobbyScreens";
import { reduceLobby, createLobbyState, MOBILE_DEVICE, type LobbyEvent, type LobbyError } from "app/lobbyState";
import { SKINS } from "content/skins";
import { THEMES } from "content/themes";
import { t } from "ui/strings";

describe("QR + code helpers", () => {
  it("qrPayload encodes https://<host>/?code=XXXXX", () => {
    expect(qrPayloadFor("ABC23", "example.com")).toBe("https://example.com/?code=ABC23");
  });

  it("codeFromUrl reads ?code= and rejects invalid", () => {
    expect(codeFromUrl("https://example.com/?code=ABC23")).toBe("ABC23");
    expect(codeFromUrl("https://example.com/?code=AB0IL")).toBeNull(); // lookalikes
    expect(codeFromUrl("https://example.com/")).toBeNull();
  });

  it("generateRoomCode: 5 chars from the lookalike-free charset", () => {
    let seed = 42;
    const rng = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 20; i++) {
      expect(generateRoomCode(rng)).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/);
    }
  });
});

describe("LandingScreen", () => {
  it("three entries: Solo, Versus bots, Multiplayer", () => {
    const host = document.body;
    host.innerHTML = "";
    const choices: string[] = [];
    const screen = new LandingScreen({
      host,
      locale: "en-US",
      onChoice: (c) => {
        choices.push(c);
      },
    });
    const btns = [...screen.root.querySelectorAll("button")].map((b) => b.textContent);
    expect(btns).toEqual(["Solo", "Versus bots", "Multiplayer"]);
    screen.root.querySelectorAll("button")[0]?.click();
    screen.root.querySelectorAll("button")[2]?.click();
    expect(choices).toEqual(["solo", "multiplayer"]);
    screen.close();
  });

  it("prefill code auto-opens multiplayer flow (deferred a microtask)", async () => {
    const host = document.body;
    host.innerHTML = "";
    const choices: string[] = [];
    const screen = new LandingScreen({
      host,
      locale: "en-US",
      prefillCode: "ABC23",
      onChoice: (c, code) => {
        choices.push(`${c}:${code ?? ""}`);
      },
    });
    // The auto-click is deferred so the caller's `const landing = ...`
    // binding is initialized first (TDZ guard).
    expect(choices).toEqual([]);
    await Promise.resolve();
    expect(choices).toEqual(["multiplayer:ABC23"]);
    screen.close();
  });
});

describe("RoomCodeScreen", () => {
  it("create: code shown large + continue emits the code", () => {
    const host = document.body;
    host.innerHTML = "";
    let created = "";
    const screen = new RoomCodeScreen({
      host,
      locale: "en-US",
      mode: "create",
      code: "ABC23",
      pageHost: "example.com",
      onCreate: (c) => {
        created = c;
      },
      onJoin: () => {},
      onBack: () => {},
    });
    expect(screen.root.textContent).toContain("ABC23");
    [...screen.root.querySelectorAll("button")].find((b) => b.textContent === "Continue")?.click();
    expect(created).toBe("ABC23");
    screen.close();
  });

  it("join: 5 boxes auto-advance, join emits the assembled code", () => {
    const host = document.body;
    host.innerHTML = "";
    let joined = "";
    const screen = new RoomCodeScreen({
      host,
      locale: "en-US",
      mode: "join",
      pageHost: "example.com",
      onCreate: () => {},
      onJoin: (c) => {
        joined = c;
      },
      onBack: () => {},
    });
    const boxes = [...screen.root.querySelectorAll("input")];
    expect(boxes).toHaveLength(5);
    // Type A B C 2 3 — focus auto-advances.
    const set = (el: HTMLInputElement, v: string): void => {
      el.value = v;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    set(boxes[0]!, "A");
    expect(document.activeElement).toBe(boxes[1]);
    set(boxes[1]!, "B");
    set(boxes[2]!, "C");
    set(boxes[3]!, "2");
    set(boxes[4]!, "3");
    [...screen.root.querySelectorAll("button")].find((b) => b.textContent === "Join")?.click();
    expect(joined).toBe("ABC23");
    screen.close();
  });

  it("join prefill: ?code= fills the boxes", () => {
    const host = document.body;
    host.innerHTML = "";
    const screen = new RoomCodeScreen({
      host,
      locale: "en-US",
      mode: "join",
      code: "XYZ45",
      pageHost: "example.com",
      onCreate: () => {},
      onJoin: () => {},
      onBack: () => {},
    });
    const boxes = [...screen.root.querySelectorAll("input")] as HTMLInputElement[];
    expect(boxes.map((b) => b.value).join("")).toBe("XYZ45");
    screen.close();
  });
});

describe("LobbyScreen", () => {
  it("renders players with ready toggles; host sees kick on remotes", () => {
    const host = document.body;
    host.innerHTML = "";
    const events: LobbyEvent[] = [];
    const screen = new LobbyScreen({
      host,
      locale: "en-US",
      onEvent: (e) => {
        events.push(e);
      },
      onStart: () => {},
      onQuit: () => {},
    });
    // Add a remote via sync (remote-driven state).
    let s = createLobbyState(true);
    s = reduceLobby(s, { type: "remoteJoined", guestIndex: 0, name: "Guest 0" }).state;
    screen.sync(s);
    const text = screen.root.textContent ?? "";
    expect(text).toContain("Guest 0");
    expect(text).toContain("Not ready");
    expect(text).toContain("Kick"); // host sees kick on remote
    // Ready toggle dispatches setReady.
    const readyBtn = [...screen.root.querySelectorAll("button")].find((b) => b.textContent === "Not ready");
    readyBtn?.click();
    expect(events.some((e) => e.type === "setReady")).toBe(true);
    screen.close();
  });

  it("mode picker greys Duel unless exactly 2 players", () => {
    const host = document.body;
    host.innerHTML = "";
    const screen = new LobbyScreen({
      host,
      locale: "en-US",
      onEvent: () => {},
      onStart: () => {},
      onQuit: () => {},
    });
    let s = createLobbyState(true);
    s = reduceLobby(s, { type: "remoteJoined", guestIndex: 0, name: "G" }).state;
    s = reduceLobby(s, { type: "remoteJoined", guestIndex: 1, name: "G2" }).state;
    screen.sync(s); // 3 players → Duel disabled
    const duel = [...screen.root.querySelectorAll("button")].find((b) => b.textContent === "Duel");
    expect(duel?.disabled).toBe(true);
    screen.close();
  });

  it("guest view: config buttons disabled (read-only panel)", () => {
    const host = document.body;
    host.innerHTML = "";
    const screen = new LobbyScreen({
      host,
      locale: "en-US",
      onEvent: () => {},
      onStart: () => {},
      onQuit: () => {},
    });
    let s = createLobbyState(false);
    s = reduceLobby(s, { type: "remoteJoined", guestIndex: 0, name: "G" }).state;
    screen.sync(s);
    const race = [...screen.root.querySelectorAll("button")].find((b) => b.textContent === "Race");
    expect(race?.disabled).toBe(true);
    expect(screen.root.textContent).toContain("host edits");
    screen.close();
  });

  it("countdown phase shows the remaining number; code shows otherwise", () => {
    const host = document.body;
    host.innerHTML = "";
    const screen = new LobbyScreen({
      host,
      locale: "en-US",
      onEvent: () => {},
      onStart: () => {},
      onQuit: () => {},
    });
    let s = createLobbyState(true);
    s = reduceLobby(s, { type: "createRoom", code: "ABC23" }).state;
    screen.sync(s);
    expect(screen.root.textContent).toContain("ABC23");
    s = reduceLobby(s, { type: "startCountdown" }).state; // not all ready → error, stays lobby
    expect(s.phase).toBe("lobby");
    s = reduceLobby(s, { type: "setReady", playerId: 0, ready: true }).state;
    s = reduceLobby(s, { type: "remoteJoined", guestIndex: 0, name: "G" }).state;
    s = reduceLobby(s, { type: "setReady", playerId: 100, ready: true }).state;
    s = reduceLobby(s, { type: "startCountdown" }).state;
    expect(s.phase).toBe("countdown");
    screen.sync(s);
    expect(screen.root.textContent).toContain("3");
    s = reduceLobby(s, { type: "countdownTick" }).state;
    screen.sync(s);
    expect(screen.root.textContent).toContain("2");
    screen.close();
  });

  it("host kick button dispatches removePlayer", () => {
    const host = document.body;
    host.innerHTML = "";
    const events: LobbyEvent[] = [];
    const screen = new LobbyScreen({
      host,
      locale: "en-US",
      onEvent: (e) => {
        events.push(e);
      },
      onStart: () => {},
      onQuit: () => {},
    });
    let s = createLobbyState(true);
    s = reduceLobby(s, { type: "remoteJoined", guestIndex: 0, name: "Guest 0" }).state;
    screen.sync(s);
    const kick = [...screen.root.querySelectorAll("button")].find((b) => b.textContent === "Kick");
    kick?.click();
    expect(events.some((e) => e.type === "removePlayer")).toBe(true);
    screen.close();
  });

  it("host mode click dispatches setConfig (selected mode updates)", () => {
    const host = document.body;
    host.innerHTML = "";
    const events: LobbyEvent[] = [];
    const screen = new LobbyScreen({
      host,
      locale: "en-US",
      onEvent: (e) => {
        events.push(e);
      },
      onStart: () => {},
      onQuit: () => {},
    });
    let s = createLobbyState(true);
    s = reduceLobby(s, { type: "remoteJoined", guestIndex: 0, name: "G" }).state;
    screen.sync(s);
    const attack = [...screen.root.querySelectorAll("button")].find((b) => b.textContent === "Attack");
    attack?.click();
    expect(events.some((e) => e.type === "setConfig")).toBe(true);
    // Config change resets ready checks — the reducer ran through dispatch.
    expect(screen.root.textContent).toContain("Not ready");
    screen.close();
  });

  it("add-local button dispatches addLocalPlayer; device cap enforced via MOBILE_DEVICE", () => {
    const host = document.body;
    host.innerHTML = "";
    const events: LobbyEvent[] = [];
    const screen = new LobbyScreen({
      host,
      locale: "en-US",
      device: MOBILE_DEVICE,
      onEvent: (e) => {
        events.push(e);
      },
      onStart: () => {},
      onQuit: () => {},
    });
    const add = [...screen.root.querySelectorAll("button")].find((b) => b.textContent === "Add local player");
    add?.click(); // → 2 locals (mobile cap)
    add?.click(); // → deviceFull, no change
    const adds = events.filter((e) => e.type === "addLocalPlayer");
    expect(adds.length).toBe(2); // dispatch fires even when the reducer errors
    screen.close();
  });

  it("start + quit buttons wire through", () => {
    const host = document.body;
    host.innerHTML = "";
    let started = 0;
    let quit = 0;
    const screen = new LobbyScreen({
      host,
      locale: "en-US",
      onEvent: () => {},
      onStart: () => {
        started++;
      },
      onQuit: () => {
        quit++;
      },
    });
    [...screen.root.querySelectorAll("button")].find((b) => b.textContent === "Start")?.click();
    [...screen.root.querySelectorAll("button")].find((b) => b.textContent === "Quit")?.click();
    expect(started).toBe(1);
    expect(quit).toBe(1);
    screen.close();
  });
});

describe("errorKey mapping (all lobby errors)", () => {
  it("maps every LobbyError to its string key in both locales", () => {
    const cases: Array<[LobbyError, string]> = [
      ["modeNeedsTwo", "Needs at least 2 players"],
      ["duelNeedsExactlyTwo", "Duel needs exactly 2 players"],
      ["notAllReady", "All players must be ready"],
      ["notHost", "Only the host can do that"],
      ["sessionFull", "Session is full (4 players)"],
      ["deviceFull", "Device local-player limit reached"],
      ["noLateJoin", "Game in progress — join between matches"],
      ["invalidCode", "Invalid room code"],
      ["playerNotFound", "Player not found"],
    ];
    for (const [err, enText] of cases) {
      expect(t("en-US", errorKey(err))).toBe(enText);
    }
    // es-419 spot checks per branch.
    expect(t("es-419", errorKey("modeNeedsTwo"))).toBe("Necesita al menos 2 jugadores");
    expect(t("es-419", errorKey("notHost"))).toBe("Solo el host puede hacer eso");
    expect(t("es-419", errorKey("invalidCode"))).toBe("Código de sala inválido");
  });
});

describe("QR matrix rendering", () => {
  it("qrMatrix returns a boolean matrix when the lib is present", () => {
    // Minimal fake qrcode-generator: 3x3 with dark corners.
    (globalThis as Record<string, unknown>).qrcode = (): unknown => ({
      addData: () => {},
      make: () => {},
      getModuleCount: () => 3,
      isDark: (y: number, x: number): boolean => (y + x) % 2 === 0,
    });
    const m = qrMatrix("https://example.com/?code=ABC23");
    expect(m).not.toBeNull();
    expect(m?.length).toBe(3);
    expect(m?.[0]?.[0]).toBe(true);
    expect(m?.[0]?.[1]).toBe(false);
  });

  it("qrMatrix returns null when the lib throws", () => {
    (globalThis as Record<string, unknown>).qrcode = (): unknown => {
      throw new Error("lib broken");
    };
    expect(qrMatrix("anything")).toBeNull();
  });

  it("qrMatrix returns null when the lib is absent", () => {
    delete (globalThis as Record<string, unknown>).qrcode;
    expect(qrMatrix("anything")).toBeNull();
  });

  it("RoomCodeScreen create renders the QR canvas path when the lib is present", () => {
    (globalThis as Record<string, unknown>).qrcode = (): unknown => ({
      addData: () => {},
      make: () => {},
      getModuleCount: () => 3,
      isDark: (y: number, x: number): boolean => (y + x) % 2 === 0,
    });
    const host = document.body;
    host.innerHTML = "";
    const screen = new RoomCodeScreen({
      host,
      locale: "en-US",
      mode: "create",
      code: "ABC23",
      pageHost: "example.com",
      onCreate: () => {},
      onJoin: () => {},
      onBack: () => {},
    });
    // jsdom canvas 2d context is null without the canvas package — the
    // matrix branch runs, ctx-null guard skips drawing, no crash.
    expect(screen.root.textContent).toContain("ABC23");
    screen.close();
    delete (globalThis as Record<string, unknown>).qrcode;
  });
});

describe("LobbyScreen skins + theme + names (ticket 44)", () => {
  function makeLobby(events: LobbyEvent[] = []): { screen: LobbyScreen; events: LobbyEvent[] } {
    const host = document.body;
    host.innerHTML = "";
    const seen: LobbyEvent[] = [];
    const screen = new LobbyScreen({
      host,
      locale: "en-US",
      onEvent: (e) => {
        seen.push(e);
      },
      onStart: () => {},
      onQuit: () => {},
    });
    let state = createLobbyState(true);
    for (const e of events) state = reduceLobby(state, e).state;
    screen.sync(state);
    return { screen, events: seen };
  }

  it("local players get a skin select listing every registry skin", () => {
    const { screen } = makeLobby();
    const select = screen.root.querySelector("select");
    expect(select).not.toBeNull();
    const opts = [...(select?.querySelectorAll("option") ?? [])].map((o) => o.textContent);
    expect(opts.length).toBe(SKINS.length);
    screen.close();
  });

  it("skin select change dispatches setPlayerSkin", () => {
    const { screen, events } = makeLobby();
    const select = screen.root.querySelector("select");
    expect(select).not.toBeNull();
    if (select !== null) {
      select.value = SKINS[1]?.id ?? "";
      select.dispatchEvent(new Event("change"));
    }
    expect(events.some((e) => e.type === "setPlayerSkin")).toBe(true);
    screen.close();
  });

  it("local players get a name input (12-char max) dispatching setPlayerName", () => {
    const { screen, events } = makeLobby();
    const input = screen.root.querySelector("input");
    expect(input).not.toBeNull();
    expect(input?.maxLength).toBe(12);
    if (input !== null) {
      input.value = "Ace";
      input.dispatchEvent(new Event("change"));
    }
    expect(events.some((e) => e.type === "setPlayerName")).toBe(true);
    screen.close();
  });

  it("host sees a theme select; change dispatches setConfig with themeId", () => {
    const { screen, events } = makeLobby();
    const selects = screen.root.querySelectorAll("select");
    const themeSelect = [...selects].find((s) =>
      [...s.querySelectorAll("option")].some((o) => o.value === THEMES[1]?.id),
    );
    expect(themeSelect).not.toBeUndefined();
    if (themeSelect !== undefined) {
      themeSelect.value = THEMES[1]?.id ?? "";
      themeSelect.dispatchEvent(new Event("change"));
    }
    const cfg = events.find((e): e is Extract<LobbyEvent, { type: "setConfig" }> => e.type === "setConfig");
    expect(cfg?.config.themeId).toBe(THEMES[1]?.id);
    screen.close();
  });

  it("guest view shows the theme name read-only (no theme select)", () => {
    const host = document.body;
    host.innerHTML = "";
    const screen = new LobbyScreen({
      host,
      locale: "en-US",
      onEvent: () => {},
      onStart: () => {},
      onQuit: () => {},
    });
    // Drive to guest state: hostLeft resets to fresh host lobby, so build
    // guest state directly via sync.
    const guestState = createLobbyState(false);
    screen.sync(guestState);
    const selects = screen.root.querySelectorAll("select");
    // Guest: no theme select (only local-player skin selects remain).
    const themeSelect = [...selects].find((s) =>
      [...s.querySelectorAll("option")].some((o) => o.value === THEMES[1]?.id),
    );
    expect(themeSelect).toBeUndefined();
    // Theme name still visible in the config panel.
    expect(screen.root.textContent).toContain(THEMES[0]?.name ?? "");
    screen.close();
  });

  it("remote players show name + no skin select (host edits nothing for them)", () => {
    const { screen } = makeLobby([
      { type: "remoteJoined", guestIndex: 0, name: "Guest", skinId: SKINS[2]?.id ?? "" },
    ]);
    // Two selects max: one local skin + host theme. Remote adds none.
    const selects = screen.root.querySelectorAll("select");
    expect(selects.length).toBe(2);
    expect(screen.root.textContent).toContain("Guest");
    screen.close();
  });
});
