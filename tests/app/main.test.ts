// main.ts boot tests (ticket 45 coverage): the landing → Solo / Versus
// bots / Multiplayer entry flow. Heavy seams (solo session, sprite loading,
// WebRTC, bots screen, MpFlow) are mocked; the landing DOM + routing runs
// real. The module boots on import, so each test re-imports it fresh.
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const soloStart = vi
  .fn(() => Promise.resolve({ app: {}, loop: {}, dispose: (): void => undefined }))
  .mockName("startSoloSession");
const botsScreenOpts: { onStart: (c: unknown) => void }[] = [];

function applyMocks(): void {
  vi.doMock("app/soloSession", () => ({
    startSoloSession: () => soloStart(),
  }));
  vi.doMock("render/spriteSheet", () => ({
    loadSkinSprites: () => Promise.resolve(undefined),
  }));
  vi.doMock("ui/versusBotsScreen", () => ({
    VersusBotsConfigScreen: class {
      readonly root = { remove: vi.fn() };
      constructor(opts: { onStart: (c: unknown) => void }) {
        botsScreenOpts.push(opts);
      }
    },
  }));
  vi.doMock("signaling/rtc", () => ({
    openHostRoom: vi.fn(),
    connectViaSignalingGuest: vi.fn(),
  }));
  vi.doMock("app/mpFlow", () => ({
    MpFlow: class {
      start = vi.fn().mockResolvedValue(undefined);
      hostLocalEvent = vi.fn();
      hostStartMatch = vi.fn();
      guestHello = vi.fn();
      guestIntent = vi.fn();
      guestChannelClosed = vi.fn();
      hostGoneFromOutside = vi.fn();
      dispose = vi.fn();
    },
  }));
}

beforeEach(() => {
  // The boot module expects a #app host element.
  const app = document.createElement("div");
  app.id = "app";
  document.body.appendChild(app);
});

afterEach(() => {
  document.body.replaceChildren();
  botsScreenOpts.length = 0;
  soloStart.mockClear();
  vi.resetModules();
  vi.doUnmock("app/soloSession");
  vi.doUnmock("render/spriteSheet");
  vi.doUnmock("ui/versusBotsScreen");
  vi.doUnmock("signaling/rtc");
  vi.doUnmock("app/mpFlow");
});

async function importMain(): Promise<void> {
  vi.resetModules();
  applyMocks();
  await import("app/main");
}

function clickButton(label: string): void {
  const btn = [...document.querySelectorAll("button")].find(
    (b) => b.textContent === label,
  );
  expect(btn, `landing button "${label}"`).toBeDefined();
  btn?.click();
}

describe("main boot (ticket 45)", () => {
  it("renders the landing with three entries", async () => {
    await importMain();
    const text = document.body.textContent ?? "";
    expect(text).toContain("Solo");
    expect(text).toContain("Versus bots");
    expect(text).toContain("Multiplayer");
  });

  it("Solo entry boots the solo session", async () => {
    await importMain();
    clickButton("Solo");
    await Promise.resolve();
    await Promise.resolve();
    expect(soloStart).toHaveBeenCalledTimes(1);
  });

  it("Versus bots opens the config screen", async () => {
    await importMain();
    clickButton("Versus bots");
    expect(botsScreenOpts).toHaveLength(1);
  });

  it("Multiplayer opens the create room-code screen (no join hint)", async () => {
    await importMain();
    clickButton("Multiplayer");
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("Enter the room code");
  });
});
