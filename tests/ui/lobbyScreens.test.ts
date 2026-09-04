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
  codeFromUrl,
  generateRoomCode,
} from "ui/lobbyScreens";
import { reduceLobby, createLobbyState, type LobbyEvent } from "app/lobbyState";

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

  it("prefill code auto-opens multiplayer flow", () => {
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
    expect(choices).toEqual(["multiplayer:"]);
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
});
