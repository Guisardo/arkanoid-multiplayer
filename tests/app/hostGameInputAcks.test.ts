// hostGame input acks (ticket #155): each wire snapshot's `inputAcks` is
// parallel to its `players` and carries the newest Match tick whose REAL input
// frame the delay queue fed that player. The guest predictor reconciles at
// that tick, so it must not follow the sim's own tick (which restarts every
// Sim epoch), and stall-decay frames (synthetic) must never advance it.
import { describe, expect, it } from "vitest";
import { createHostGameSession, unpackMulti, type HostGamePlayer } from "app/hostGame";
import { DEFAULT_CONFIG, type LobbyMode } from "app/lobbyState";
import { encodeInputBatch } from "net/inputCodec";
import { deserializeSnapshot } from "net/serializer";
import { EMPTY_ACTIONS, NO_INPUT_ACK, type InputFrame, type Snapshot } from "shared/protocol";

const players: HostGamePlayer[] = [
  { player: 0, name: "Host", skinIndex: 0, guestIndex: -1 },
  { player: 1, name: "Guest", skinIndex: 1, guestIndex: 0 },
];

function frame(player: number, tick: number, axisX: number): InputFrame {
  return { player, tick, axisX, axisY: 0, launch: false, primaryHeld: false, actions: EMPTY_ACTIONS };
}

async function makeSession(mode: LobbyMode) {
  const sends: ArrayBuffer[] = [];
  const session = await createHostGameSession(
    { mode, config: { ...DEFAULT_CONFIG, mode }, players, hostLocalPlayers: [0] },
    (_guestIndex, buf) => {
      sends.push(buf);
    },
  );
  return { session, sends };
}

/** The guest's field from the newest multi-snapshot (kind 2) packet. */
function lastFieldSnapshot(sends: readonly ArrayBuffer[]): Snapshot {
  for (let i = sends.length - 1; i >= 0; i--) {
    const buf = sends[i];
    if (buf === undefined || new DataView(buf).getUint8(0) !== 2) continue;
    const [part] = unpackMulti(buf);
    if (part !== undefined) return deserializeSnapshot(part);
  }
  throw new Error("lastFieldSnapshot: no multi-snapshot sent");
}

describe("hostGame input acks (ticket #155)", () => {
  it("race: acks the newest delivered guest frame, NO_INPUT_ACK before any", async () => {
    const { session, sends } = await makeSession("race");
    expect(session.delayTicks).toBe(4);
    // Two ticks in, nothing is due yet (frame t is due at Match tick t + D).
    for (let t = 0; t < 2; t++) {
      session.guestBinary(0, encodeInputBatch([frame(0, t, 1)]));
      session.tick([frame(0, t, 0)]);
    }
    expect(lastFieldSnapshot(sends).inputAcks).toEqual([NO_INPUT_ACK]);
    for (let t = 2; t < 20; t++) {
      session.guestBinary(0, encodeInputBatch([frame(0, t, 1)]));
      session.tick([frame(0, t, 0)]);
    }
    // Last broadcast followed Match tick 19, which fed frame 19 − D.
    expect(lastFieldSnapshot(sends).inputAcks).toEqual([15]);
    session.dispose();
  });

  it("race: stall-decay frames never advance the ack", async () => {
    const { session, sends } = await makeSession("race");
    for (let t = 0; t < 20; t++) {
      session.guestBinary(0, encodeInputBatch([frame(0, t, 1)]));
      session.tick([frame(0, t, 0)]);
    }
    // The guest falls silent with its axis held: the host injects stall frames.
    for (let t = 20; t < 60; t++) session.tick([frame(0, t, 0)]);
    expect(lastFieldSnapshot(sends).inputAcks).toEqual([19]);
    session.dispose();
  });

  it("sharedField: one ack per players[] slot, each that player's own", async () => {
    const { session, sends } = await makeSession("sharedField");
    expect(session.delayTicks).toBe(0);
    // 14 ticks: Match tick 14 broadcasts a snapshot but no progress rows, so
    // the newest packet is the snapshot.
    for (let t = 0; t < 14; t++) {
      if (t <= 5) session.guestBinary(0, encodeInputBatch([frame(0, t, 0)]));
      session.tick([frame(0, t, 0)]);
    }
    const last = sends[sends.length - 1];
    if (last === undefined) throw new Error("no snapshot sent");
    const snap = deserializeSnapshot(last);
    expect(snap.inputAcks).toHaveLength(snap.players.length);
    const ackOf = (player: number): number | undefined =>
      snap.inputAcks[snap.players.findIndex((p) => p.player === player)];
    expect(ackOf(0)).toBe(13);
    expect(ackOf(1)).toBe(5);
    session.dispose();
  });
});
