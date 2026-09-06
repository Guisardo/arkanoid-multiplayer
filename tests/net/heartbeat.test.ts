// Ticket 47: disconnect detection (heartbeat + close, whichever first),
// guest blind-state monitor, ping cadence.
import { describe, expect, it } from "vitest";
import {
  createHostWatchdog,
  createGuestSilenceMonitor,
  pingDue,
  PING_INTERVAL_MS,
  HOST_DROP_SILENCE_MS,
  GUEST_BLIND_BANNER_MS,
  GUEST_SESSION_OVER_MS,
} from "net/heartbeat";

describe("host watchdog (spec §9: drop at ~10–15 s silence)", () => {
  it("stays live while the guest pings", () => {
    const wd = createHostWatchdog(0);
    for (let t = 0; t <= 60_000; t += 5000) {
      wd.heard(t);
      expect(wd.tick(t + 1000)).toBe(false);
    }
    expect(wd.dropped).toBe(false);
  });

  it("drops after 12 s of silence", () => {
    const wd = createHostWatchdog(0);
    wd.heard(0);
    expect(wd.tick(11_999)).toBe(false);
    expect(wd.tick(12_000)).toBe(true);
    expect(wd.dropped).toBe(true);
  });

  it("any traffic counts as heard (input, not just ping)", () => {
    const wd = createHostWatchdog(0);
    wd.heard(0);
    wd.heard(11_000); // late input batch
    expect(wd.tick(12_500)).toBe(false);
  });

  it("channel close drops immediately (whichever-first)", () => {
    const wd = createHostWatchdog(0);
    wd.heard(0);
    expect(wd.close()).toBe(true);
    expect(wd.dropped).toBe(true);
  });

  it("a dropped watchdog stays dropped", () => {
    const wd = createHostWatchdog(0);
    wd.close();
    wd.heard(1000); // late traffic on a closed channel
    expect(wd.tick(2000)).toBe(true);
  });
});

describe("guest silence monitor (banner ~1 s, over ~12 s)", () => {
  it("live while snapshots flow", () => {
    const m = createGuestSilenceMonitor(0);
    for (let t = 0; t <= 10_000; t += 33) {
      m.fed(t);
      expect(m.tick(t)).toBe("live");
    }
  });

  it("blind banner after 1 s of snapshot silence", () => {
    const m = createGuestSilenceMonitor(0);
    m.fed(0);
    expect(m.tick(999)).toBe("live");
    expect(m.tick(1000)).toBe("blind");
  });

  it("session over after 12 s of silence", () => {
    const m = createGuestSilenceMonitor(0);
    m.fed(0);
    expect(m.tick(11_999)).toBe("blind");
    expect(m.tick(12_000)).toBe("over");
  });

  it("a snapshot during blind restores live", () => {
    const m = createGuestSilenceMonitor(0);
    m.fed(0);
    expect(m.tick(2000)).toBe("blind");
    m.fed(2100);
    expect(m.tick(2101)).toBe("live");
  });

  it("control channel close = over immediately", () => {
    const m = createGuestSilenceMonitor(0);
    m.fed(0);
    expect(m.controlClosed()).toBe("over");
    expect(m.state).toBe("over");
  });

  it("over is terminal", () => {
    const m = createGuestSilenceMonitor(0);
    m.fed(0);
    m.tick(20_000);
    m.fed(20_100); // too late
    expect(m.state).toBe("over");
  });
});

describe("ping cadence", () => {
  it("fires every 5 s", () => {
    expect(pingDue(0, 4999)).toBe(false);
    expect(pingDue(0, 5000)).toBe(true);
    expect(pingDue(5000, 9999)).toBe(false);
    expect(pingDue(5000, 10_000)).toBe(true);
  });

  it("constants match spec", () => {
    expect(PING_INTERVAL_MS).toBe(5000);
    expect(HOST_DROP_SILENCE_MS).toBe(12_000);
    expect(GUEST_BLIND_BANNER_MS).toBe(1000);
    expect(GUEST_SESSION_OVER_MS).toBe(12_000);
  });
});
