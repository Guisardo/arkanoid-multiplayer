// Input ack tracker (ticket #155): newest delivered Match tick per sim player,
// stamped onto snapshots parallel to `players`.
import { describe, expect, it } from "vitest";
import { createInputAckTracker } from "net/inputAcks";
import { EMPTY_ACTIONS, NO_INPUT_ACK, type InputFrame, type Snapshot } from "shared/protocol";

function frame(player: number, tick: number): InputFrame {
  return { player, tick, axisX: 0, axisY: 0, launch: false, primaryHeld: false, actions: EMPTY_ACTIONS };
}

function snapOf(players: number[], tick: number): Snapshot {
  return {
    tick,
    phase: "play",
    round: 1,
    epoch: 0,
    players: players.map((player) => ({
      player,
      name: `P${String(player + 1)}`,
      skinIndex: 0,
      paddle: { x: 104, y: 242, w: 32, h: 6, edge: "bottom" as const },
      lives: 3,
      score: 0,
      meter: 0,
      target: -1,
      chain: 0,
      state: "playing" as const,
      effects: {},
    })),
    balls: [],
    capsules: [],
    bricks: [],
    events: [],
    inputAcks: players.map(() => tick),
  };
}

describe("input ack tracker (ticket #155)", () => {
  it("a player with no delivered frame acks NO_INPUT_ACK", () => {
    expect(createInputAckTracker().ackOf(2)).toBe(NO_INPUT_ACK);
  });

  it("keeps the newest Match tick per player, even if delivered out of order", () => {
    const acks = createInputAckTracker();
    acks.delivered([frame(0, 7), frame(1, 3)]);
    acks.delivered([frame(0, 5)]);
    expect(acks.ackOf(0)).toBe(7);
    expect(acks.ackOf(1)).toBe(3);
  });

  it("stamps acks parallel to players, replacing the sim's placeholder", () => {
    const acks = createInputAckTracker();
    acks.delivered([frame(2, 40), frame(0, 41)]);
    const stamped = acks.stamp(snapOf([2, 0, 1], 5), (slot) => slot.player);
    expect(stamped.inputAcks).toEqual([40, 41, NO_INPUT_ACK]);
  });

  it("maps every slot of a renumbered field back to its sim player", () => {
    const acks = createInputAckTracker();
    acks.delivered([frame(3, 99)]);
    // Parallel modes renumber a field's player to 0; the field index is the
    // sim player.
    const stamped = acks.stamp(snapOf([0], 12), () => 3);
    expect(stamped.inputAcks).toEqual([99]);
  });
});
