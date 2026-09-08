// Deploy env resolution tests (ticket 55): Vite env parsing, signaling URL
// override vs same-origin fallback, TURN endpoint gating.
import { describe, expect, it } from "vitest";
import { deployEnvFromVite, signalingUrlFor, turnConfigured } from "app/deployEnv";

const LOCATION = { protocol: "https:", host: "guisardo.github.io" } as const;

describe("deployEnvFromVite", () => {
  it("empty env → no overrides (dev behavior)", () => {
    expect(deployEnvFromVite({})).toEqual({});
  });

  it("reads VITE_SIGNALING_BASE + VITE_TURN_URL, strips trailing slash", () => {
    expect(deployEnvFromVite({
      VITE_SIGNALING_BASE: "https://arkanoid-signaling.workers.dev/",
      VITE_TURN_URL: "https://arkanoid-turn.workers.dev/turn/credentials",
    })).toEqual({
      signalingBase: "https://arkanoid-signaling.workers.dev",
      turnUrl: "https://arkanoid-turn.workers.dev/turn/credentials",
    });
  });

  it("ignores non-string and empty values", () => {
    expect(deployEnvFromVite({ VITE_SIGNALING_BASE: "", VITE_TURN_URL: 42 })).toEqual({});
  });
});

describe("signalingUrlFor", () => {
  it("explicit base wins: worker URL with room path + role", () => {
    const env = deployEnvFromVite({ VITE_SIGNALING_BASE: "https://s.workers.dev" });
    expect(signalingUrlFor(env, "ABC23", "host", LOCATION))
      .toBe("https://s.workers.dev/room/ABC23/ws?role=host");
    expect(signalingUrlFor(env, "ABC23", "guest", LOCATION))
      .toBe("https://s.workers.dev/room/ABC23/ws?role=guest");
  });

  it("absent base → same-origin (dev server, wrangler dev proxy)", () => {
    expect(signalingUrlFor({}, "ABC23", "host", { protocol: "http:", host: "localhost:5173" }))
      .toBe("ws://localhost:5173/room/ABC23/ws?role=host");
    expect(signalingUrlFor({}, "ABC23", "guest", LOCATION))
      .toBe("wss://guisardo.github.io/room/ABC23/ws?role=guest");
  });
});

describe("turnConfigured", () => {
  it("true only when turnUrl present", () => {
    expect(turnConfigured({})).toBe(false);
    expect(turnConfigured({ turnUrl: "https://t.workers.dev/turn/credentials" })).toBe(true);
  });
});
