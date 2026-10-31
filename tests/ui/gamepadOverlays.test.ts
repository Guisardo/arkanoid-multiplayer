// @vitest-environment jsdom
// Ticket 99: pause, end and lobby overlays are driven by the gamepad (d-pad
// moves focus, A activates) through the shared GamepadMenuNav.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PauseOverlay } from "ui/pauseOverlay";
import { EndScreen, raceStandings, type EndScreenChoice } from "ui/endScreens";
import { LandingScreen, LobbyScreen, RoomCodeScreen } from "ui/lobbyScreens";
import { FOCUS_CLASS } from "ui/gamepadNav";
import { createLobbyState } from "app/lobbyState";
import type { MatchState } from "sim/multiField";

const A = 0;
const B = 1;
const DPAD_DOWN = 13;
const POLL_MS = 50;

type NavigatorWithPads = Navigator & { getGamepads?: () => (Gamepad | null)[] };

let held: number[];
let realGetGamepads: (() => (Gamepad | null)[]) | undefined;

/** Press the given pad buttons for one poll, then release for one poll. */
function tap(...indices: number[]): void {
  held = indices;
  vi.advanceTimersByTime(POLL_MS);
  held = [];
  vi.advanceTimersByTime(POLL_MS);
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = "";
  held = [];
  const nav = navigator as NavigatorWithPads;
  realGetGamepads = nav.getGamepads?.bind(nav);
  nav.getGamepads = () =>
    [
      {
        buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: held.includes(i) })),
        axes: [0, 0],
      },
    ] as unknown as (Gamepad | null)[];
  // Let the nav see a released baseline before the test's first press.
  vi.advanceTimersByTime(POLL_MS * 2);
});

afterEach(() => {
  const nav = navigator as NavigatorWithPads;
  if (realGetGamepads) nav.getGamepads = realGetGamepads;
  else Reflect.deleteProperty(nav, "getGamepads");
  vi.useRealTimers();
});

function matchState(): MatchState {
  return {
    round: 1,
    roundPoints: [0, 0],
    levelsCleared: [3, 5],
    bricksThisLevel: [10, 2],
    matchWinner: null,
    phase: "playing",
  };
}

/** Step through the overlay with the d-pad until a button has focus (selects come first in the lobby). */
function focusButtonViaPad(maxSteps = 12): void {
  for (let i = 0; i < maxSteps && !(document.activeElement instanceof HTMLButtonElement); i++) {
    tap(DPAD_DOWN);
  }
  expect(document.activeElement).toBeInstanceOf(HTMLButtonElement);
}

describe("PauseOverlay gamepad navigation", () => {
  it("d-pad down then A resumes; a second d-pad down reaches Quit", () => {
    const choices: string[] = [];
    const pause = new PauseOverlay({
      host: document.body,
      locale: "en-US",
      pausedBy: "Ana",
      onChoice: (c) => choices.push(c),
    });
    tap(DPAD_DOWN);
    expect(document.activeElement?.classList.contains(FOCUS_CLASS)).toBe(true);
    tap(A);
    expect(choices).toEqual(["resume"]);
    tap(DPAD_DOWN);
    tap(A);
    expect(choices).toEqual(["resume", "quit"]);
    pause.close();
  });

  it("stops listening to the pad once closed", () => {
    const choices: string[] = [];
    const pause = new PauseOverlay({
      host: document.body,
      locale: "en-US",
      pausedBy: "Ana",
      onChoice: (c) => choices.push(c),
    });
    tap(DPAD_DOWN);
    pause.close();
    tap(A);
    expect(choices).toEqual([]);
  });
});

describe("EndScreen gamepad navigation", () => {
  it("first control is reachable and A picks it", () => {
    const choices: EndScreenChoice[] = [];
    const screen = new EndScreen({
      host: document.body,
      locale: "en-US",
      data: {
        kind: "competitive",
        mode: "race",
        standings: raceStandings(matchState(), ["Ana", "Beto"]),
      },
      onChoice: (c) => choices.push(c),
    });
    tap(DPAD_DOWN);
    tap(DPAD_DOWN);
    tap(A);
    expect(choices).toEqual(["lobby"]);
    screen.close();
  });
});

describe("Lobby overlays gamepad navigation", () => {
  it("landing: d-pad down then A chooses Solo", () => {
    const choices: string[] = [];
    const landing = new LandingScreen({
      host: document.body,
      locale: "en-US",
      onChoice: (c) => choices.push(c),
    });
    tap(DPAD_DOWN);
    tap(A);
    expect(choices).toEqual(["solo"]);
    landing.close();
  });

  it("room-code screen: focus lands on a control with the indicator", () => {
    const screen = new RoomCodeScreen({
      host: document.body,
      locale: "en-US",
      mode: "create",
      code: "ABC23",
      pageHost: "example.com",
      onCreate: () => {},
      onJoin: () => {},
      onBack: () => {},
    });
    tap(DPAD_DOWN);
    expect(screen.root.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.classList.contains(FOCUS_CLASS)).toBe(true);
    screen.close();
  });

  it("join screen (#159): B while scanning stops the camera and returns to the boxes; B again goes back", async () => {
    const stop = vi.fn();
    let backs = 0;
    const screen = new RoomCodeScreen({
      host: document.body,
      locale: "en-US",
      mode: "join",
      pageHost: "example.com",
      onCreate: () => {},
      onJoin: () => {},
      onBack: () => { backs++; },
      qrScan: {
        scanner: { start: () => Promise.resolve(), stop },
        hasCamera: () => Promise.resolve(true),
      },
    });
    await Promise.resolve();
    [...screen.root.querySelectorAll("button")].find((b) => b.textContent === "Scan QR")?.click();
    const video = screen.root.querySelector("video");
    expect(video?.parentElement?.style.display).toBe("");

    tap(B);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(backs).toBe(0);
    expect(video?.parentElement?.style.display).toBe("none");

    tap(B);
    expect(backs).toBe(1);
    screen.close();
  });

  it("lobby: A activates the focused control, also after close() + reopen()", () => {
    const screen = new LobbyScreen({
      host: document.body,
      locale: "en-US",
      onEvent: () => {},
      onStart: () => {},
      onQuit: () => {},
    });
    screen.sync(createLobbyState(true));
    const clicks: Element[] = [];
    screen.root.addEventListener("click", (e) => {
      if (e.target instanceof Element) clicks.push(e.target);
    });
    focusButtonViaPad();
    tap(A);
    expect(clicks).toHaveLength(1);

    screen.close();
    screen.reopen();
    // Fresh focus: the lobby re-attached with its pad support intact.
    (document.activeElement as HTMLElement | null)?.blur();
    focusButtonViaPad();
    tap(A);
    expect(clicks).toHaveLength(2);
    screen.close();
  });
});
