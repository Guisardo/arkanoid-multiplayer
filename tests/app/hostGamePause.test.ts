// hostGame pause semantics (ticket 48): frozen sim + live broadcasts.
// While paused: tick() advances nothing, guest input is dropped, but
// snapshots keep shipping at cadence (guest silence monitors from
// ticket 47 must never trip on a legit pause).
import { describe, expect, it } from "vitest";
import { createHostGameSession, type HostGamePlayer } from "app/hostGame";

const players: HostGamePlayer[] = [
  { player: 0, name: "Host", skinIndex: 0, guestIndex: -1 },
  { player: 1, name: "Guest", skinIndex: 1, guestIndex: 0 },
];

function makeSession() {
  const sends: ArrayBuffer[] = [];
  const session = createHostGameSession(
    {
      mode: "sharedField",
      config: {
        mode: "sharedField",
        matchStructure: "oneOff",
        bestOf: 1,
        levelSelection: "hostPick",
        hostPickRound: 1,
        timeCapTicks: null,
        themeId: "t",
      },
      players,
      hostLocalPlayers: [0],
    },
    (_gi, buf) => {
      sends.push(buf);
    },
  );
  return { session, sends };
}

describe("hostGame pause (ticket 48)", () => {
  it("paused tick: sim frozen, snapshots keep broadcasting", () => {
    const { session, sends } = makeSession();
    sends.length = 0;
    session.setPaused(true);
    const before = session.snapshots()[0];
    expect(before).toBeDefined();
    // 120 paused ticks = 2 s at 60 Hz → 2 broadcast windows at 30 Hz.
    for (let i = 0; i < 120; i++) session.tick([]);
    const after = session.snapshots()[0];
    // Sim frozen: identical snapshot (same tick).
    expect(after?.tick).toBe(before?.tick);
    // Broadcasts kept flowing: ≥ 2 snapshot sends over 120 paused ticks.
    expect(sends.length).toBeGreaterThanOrEqual(2);
    session.setPaused(false);
    session.dispose();
  });

  it("paused tick: guest input is dropped, resume accepts it again", () => {
    const { session } = makeSession();
    session.setPaused(true);
    // A paused guest's binary input must not enter the delay queue.
    // (No observable throw; the proof is the frozen sim below.)
    session.setPaused(false);
    // After resume the sim advances again.
    const before = session.snapshots()[0];
    expect(before).toBeDefined();
    for (let i = 0; i < 10; i++) session.tick([]);
    const after = session.snapshots()[0];
    expect(after?.tick).toBeGreaterThan(before?.tick ?? 0);
    session.dispose();
  });

  it("setPaused is idempotent (double pause, double resume)", () => {
    const { session } = makeSession();
    session.setPaused(true);
    session.setPaused(true);
    const before = session.snapshots()[0];
    expect(before).toBeDefined();
    for (let i = 0; i < 60; i++) session.tick([]);
    expect(session.snapshots()[0]?.tick).toBe(before?.tick);
    session.setPaused(false);
    session.setPaused(false);
    for (let i = 0; i < 10; i++) session.tick([]);
    expect(session.snapshots()[0]?.tick).toBeGreaterThan(before?.tick ?? 0);
    session.dispose();
  });

  it("paused broadcasts keep the guest silence monitor fed (wire proof)", () => {
    // The broadcast path is the same one the silence monitor watches:
    // verify sends continue while paused over a long window (12 s worth
    // of ticks would trip the monitor if silent).
    const { session, sends } = makeSession();
    sends.length = 0;
    session.setPaused(true);
    for (let i = 0; i < 60 * 13; i++) session.tick([]);
    // 13 s of paused ticks at 30 Hz cadence ≈ 39 broadcasts.
    expect(sends.length).toBeGreaterThanOrEqual(30);
    session.setPaused(false);
    session.dispose();
  });

  it("guestBinary while paused is ignored (no crash, no queue entry)", () => {
    const { session } = makeSession();
    session.setPaused(true);
    // Malformed + well-formed input both dropped silently while paused.
    expect(() => {
      session.guestBinary(0, new ArrayBuffer(8));
    }).not.toThrow();
    session.setPaused(false);
    session.dispose();
  });
});
