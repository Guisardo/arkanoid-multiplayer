import { describe, expect, it } from "vitest";
import {
  assembleIceConfig,
  assembleWithMeteredServers,
  fetchIceConfig,
  parseIceServerEntries,
  stunOnlyConfig,
  stunOnlyServers,
  turnServers,
  type ResponseLike,
} from "signaling/iceConfig";

function jsonResponse(body: unknown, status = 200): ResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  };
}

describe("ICE server assembly (spec §10)", () => {
  it("STUN-only config: Google primary, Open Relay secondary", () => {
    const servers = stunOnlyServers();
    expect(servers).toEqual([
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:openrelay.metered.ca:80" },
    ]);
  });

  it("TURN fallback covers ports 80/443 over UDP/TCP/TLS", () => {
    const servers = turnServers("user-1", "pass-1");
    expect(servers.map((s) => s.urls)).toEqual([
      "turn:openrelay.metered.ca:80",
      "turn:openrelay.metered.ca:80?transport=tcp",
      "turn:openrelay.metered.ca:443",
      "turns:openrelay.metered.ca:443?transport=tcp",
    ]);
    for (const server of servers) {
      expect(server.username).toBe("user-1");
      expect(server.credential).toBe("pass-1");
    }
  });

  it("full config: STUN first, TURN fallback after, turnEnabled", () => {
    const config = assembleIceConfig("user-1", "pass-1");
    expect(config.turnEnabled).toBe(true);
    expect(config.iceServers).toHaveLength(6);
    expect(config.iceServers[0]).toEqual({ urls: "stun:stun.l.google.com:19302" });
    expect(config.iceServers[1]).toEqual({ urls: "stun:openrelay.metered.ca:80" });
    expect(config.iceServers[2]).toEqual({ urls: "turn:openrelay.metered.ca:80", username: "user-1", credential: "pass-1" });
    expect(config.iceServers[5]).toEqual({ urls: "turns:openrelay.metered.ca:443?transport=tcp", username: "user-1", credential: "pass-1" });
  });

  it("STUN-only config has no TURN entries and turnEnabled false", () => {
    const config = stunOnlyConfig();
    expect(config.turnEnabled).toBe(false);
    expect(config.iceServers).toHaveLength(2);
    expect(config.iceServers.every((s) => s.urls.startsWith("stun:"))).toBe(true);
  });

  it("metered-issued servers follow the spec STUN pair", () => {
    const metered = [{ urls: "turn:standard.relay.metered.ca:80", username: "u", credential: "p" }];
    const config = assembleWithMeteredServers(metered);
    expect(config.turnEnabled).toBe(true);
    expect(config.iceServers).toEqual([
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:openrelay.metered.ca:80" },
      ...metered,
    ]);
  });
});

describe("ice server entry parsing", () => {
  it("accepts metered-style entries with optional auth", () => {
    expect(parseIceServerEntries([{ urls: "turn:x:80", username: "u", credential: "p" }])).toEqual([
      { urls: "turn:x:80", username: "u", credential: "p" },
    ]);
    expect(parseIceServerEntries([{ urls: "turn:x:80" }])).toEqual([{ urls: "turn:x:80" }]);
  });

  it("rejects malformed entries", () => {
    expect(parseIceServerEntries(null)).toBeNull();
    expect(parseIceServerEntries({})).toBeNull();
    expect(parseIceServerEntries([])).toBeNull();
    expect(parseIceServerEntries([{ username: "u" }])).toBeNull();
    expect(parseIceServerEntries([{ urls: "" }])).toBeNull();
    expect(parseIceServerEntries([{ urls: 3 }])).toBeNull();
    expect(parseIceServerEntries([{ urls: "ok" }, "bad"])).toBeNull();
  });
});

describe("credential fetch degradation (Worker down → STUN-direct)", () => {
  const ENDPOINT = "https://turn.example/turn/credentials";

  it("prefers metered-issued ice servers on success", async () => {
    const metered = [
      { urls: "turn:standard.relay.metered.ca:80", username: "u1", credential: "p1" },
      { urls: "turn:standard.relay.metered.ca:443?transport=tcp", username: "u1", credential: "p1" },
    ];
    const config = await fetchIceConfig(ENDPOINT, () =>
      Promise.resolve(jsonResponse({ username: "u1", password: "p1", iceServers: metered, ttlSeconds: 3600 })),
    );
    expect(config.turnEnabled).toBe(true);
    expect(config.iceServers).toEqual([
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:openrelay.metered.ca:80" },
      ...metered,
    ]);
  });

  it("falls back to spec-locked Open Relay assembly when iceServers absent", async () => {
    const config = await fetchIceConfig(ENDPOINT, () =>
      Promise.resolve(jsonResponse({ username: "u1", password: "p1", ttlSeconds: 3600 })),
    );
    expect(config.turnEnabled).toBe(true);
    expect(config.iceServers).toHaveLength(6);
    expect(config.iceServers[2]).toEqual({ urls: "turn:openrelay.metered.ca:80", username: "u1", credential: "p1" });
  });

  it("degrades to STUN-only when the Worker is down (non-200)", async () => {
    const config = await fetchIceConfig(ENDPOINT, () => Promise.resolve(jsonResponse({ error: "down" }, 502)));
    expect(config.turnEnabled).toBe(false);
    expect(config.iceServers).toEqual(stunOnlyServers());
  });

  it("degrades to STUN-only when the fetch rejects (network failure)", async () => {
    const config = await fetchIceConfig(ENDPOINT, () => Promise.reject(new Error("connection refused")));
    expect(config.turnEnabled).toBe(false);
    expect(config.iceServers).toEqual(stunOnlyServers());
  });

  it("degrades to STUN-only on malformed payload", async () => {
    const config = await fetchIceConfig(ENDPOINT, () => Promise.resolve(jsonResponse({ nope: true })));
    expect(config.turnEnabled).toBe(false);
  });

  it("degrades to STUN-only on empty credential strings", async () => {
    const config = await fetchIceConfig(ENDPOINT, () => Promise.resolve(jsonResponse({ username: "", password: "" })));
    expect(config.turnEnabled).toBe(false);
  });

  it("falls back to Open Relay assembly when metered iceServers malformed", async () => {
    const config = await fetchIceConfig(ENDPOINT, () =>
      Promise.resolve(jsonResponse({ username: "u1", password: "p1", iceServers: "not-an-array" })),
    );
    // username/password still valid → spec-locked Open Relay assembly used
    expect(config.turnEnabled).toBe(true);
    expect(config.iceServers).toHaveLength(6);
  });

  it("never throws — degradation is the only failure mode", async () => {
    const config = await fetchIceConfig(ENDPOINT, () => Promise.reject(new TypeError("fetch failed")));
    expect(config.iceServers.length).toBeGreaterThan(0);
  });
});
