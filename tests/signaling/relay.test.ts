import { describe, expect, it } from "vitest";
import {
  attachHost,
  createRelayState,
  handleRoomMessage,
  joinGuest,
  leaveMember,
  parseRelayMessage,
  type RelayMember,
} from "signaling/relayLogic";

const HOST: RelayMember = { role: "host", guestIndex: -1 };

function guestOf(idx: number): RelayMember {
  return { role: "guest", guestIndex: idx };
}

describe("room relay logic", () => {
  it("stores targeted host offer and relays it to that guest", () => {
    const state = createRelayState();
    attachHost(state);
    joinGuest(state); // guest 0 present
    const actions = handleRoomMessage(state, HOST, { type: "host-offer", guestIndex: 0, sdp: "offer-sdp" });
    expect(actions).toEqual([
      { to: guestOf(0), message: { type: "host-offer", guestIndex: 0, sdp: "offer-sdp" } },
    ]);
    expect(state.hostOffers.get(0)).toBe("offer-sdp");
  });

  it("host offer without guestIndex is rejected", () => {
    const state = createRelayState();
    attachHost(state);
    joinGuest(state);
    const actions = handleRoomMessage(state, HOST, { type: "host-offer", sdp: "offer-sdp" });
    expect(actions[0]!.message.type).toBe("error");
    expect(state.hostOffers.size).toBe(0);
  });

  it("guest join notifies host, acks the guest, delivers stored offer", () => {
    const state = createRelayState();
    attachHost(state);
    handleRoomMessage(state, HOST, { type: "host-offer", guestIndex: 0, sdp: "offer-sdp" });
    const result = joinGuest(state);
    expect(result.member).toEqual({ role: "guest", guestIndex: 0 });
    expect(result.actions).toEqual([
      { to: HOST, message: { type: "guest-joined", guestIndex: 0 } },
      { to: guestOf(0), message: { type: "joined-ack", guestIndex: 0 } },
      { to: guestOf(0), message: { type: "host-offer", guestIndex: 0, sdp: "offer-sdp" } },
    ]);
  });

  it("second guest gets a distinct offer slot", () => {
    const state = createRelayState();
    attachHost(state);
    joinGuest(state);
    joinGuest(state);
    handleRoomMessage(state, HOST, { type: "host-offer", guestIndex: 1, sdp: "offer-1" });
    expect(state.hostOffers.get(1)).toBe("offer-1");
    expect(state.hostOffers.get(0)).toBeUndefined();
  });

  it("guest join without stored offer notifies host + acks only", () => {
    const state = createRelayState();
    attachHost(state);
    const result = joinGuest(state);
    expect(result.actions).toEqual([
      { to: HOST, message: { type: "guest-joined", guestIndex: 0 } },
      { to: guestOf(0), message: { type: "joined-ack", guestIndex: 0 } },
    ]);
  });

  it("join without host reports room not found", () => {
    const state = createRelayState();
    const result = joinGuest(state);
    expect(result.member).toBeNull();
    expect(result.actions[0]!.message.type).toBe("error");
    expect(result.actions[0]!.message.reason).toBe("room not found");
  });

  it("relays guest answer to host with guest index", () => {
    const state = createRelayState();
    attachHost(state);
    joinGuest(state);
    const actions = handleRoomMessage(state, guestOf(0), { type: "guest-answer", sdp: "answer-sdp" });
    expect(actions).toEqual([
      { to: HOST, message: { type: "guest-answer", guestIndex: 0, sdp: "answer-sdp" } },
    ]);
  });

  it("rejects 4th guest with room-full", () => {
    const state = createRelayState();
    attachHost(state);
    expect(joinGuest(state).member).not.toBeNull();
    expect(joinGuest(state).member).not.toBeNull();
    expect(joinGuest(state).member).not.toBeNull();
    const fourth = joinGuest(state);
    expect(fourth.member).toBeNull();
    expect(fourth.actions[0]!.message.type).toBe("room-full");
  });

  it("sequential joins reuse freed guest slots", () => {
    const state = createRelayState();
    attachHost(state);
    joinGuest(state);
    joinGuest(state);
    leaveMember(state, guestOf(0));
    const rejoin = joinGuest(state);
    expect(rejoin.member!.guestIndex).toBe(0);
  });

  it("relays ICE from host to targeted guest", () => {
    const state = createRelayState();
    attachHost(state);
    joinGuest(state);
    const actions = handleRoomMessage(state, HOST, { type: "ice", guestIndex: 0, candidate: "cand" });
    expect(actions).toEqual([
      { to: guestOf(0), message: { type: "ice", from: "host", guestIndex: 0, candidate: "cand" } },
    ]);
  });

  it("relays ICE from guest to host", () => {
    const state = createRelayState();
    attachHost(state);
    joinGuest(state);
    const actions = handleRoomMessage(state, guestOf(0), { type: "ice", candidate: "cand" });
    expect(actions).toEqual([
      { to: HOST, message: { type: "ice", from: "guest", guestIndex: 0, candidate: "cand" } },
    ]);
  });

  it("guest cannot send host-offer", () => {
    const state = createRelayState();
    attachHost(state);
    joinGuest(state);
    const actions = handleRoomMessage(state, guestOf(0), { type: "host-offer", guestIndex: 0, sdp: "fake" });
    expect(actions[0]!.message.type).toBe("error");
    expect(state.hostOffers.size).toBe(0);
  });

  it("host cannot send guest-answer", () => {
    const state = createRelayState();
    attachHost(state);
    const actions = handleRoomMessage(state, HOST, { type: "guest-answer", sdp: "fake" });
    expect(actions[0]!.message.type).toBe("error");
  });

  it("malformed JSON parses to null, not crash", () => {
    expect(parseRelayMessage("not json")).toBeNull();
    expect(parseRelayMessage('{"type":"unknown-type"}')).toBeNull();
    expect(parseRelayMessage('{"noType":true}')).toBeNull();
    expect(parseRelayMessage("42")).toBeNull();
    expect(parseRelayMessage("null")).toBeNull();
  });

  it("valid message parses", () => {
    const msg = parseRelayMessage('{"type":"host-offer","guestIndex":0,"sdp":"x"}');
    expect(msg).toEqual({ type: "host-offer", guestIndex: 0, sdp: "x" });
  });

  it("joined-ack is server-sent only", () => {
    const state = createRelayState();
    attachHost(state);
    const actions = handleRoomMessage(state, HOST, { type: "joined-ack", guestIndex: 0 });
    expect(actions[0]!.message.type).toBe("error");
  });

  it("join message from attached member is rejected as server-only", () => {
    const state = createRelayState();
    attachHost(state);
    const actions = handleRoomMessage(state, HOST, { type: "join" });
    expect(actions[0]!.message.type).toBe("error");
  });

  it("guest leave notifies host", () => {
    const state = createRelayState();
    attachHost(state);
    joinGuest(state);
    const actions = leaveMember(state, guestOf(0));
    expect(actions).toEqual([
      { to: HOST, message: { type: "guest-left", guestIndex: 0 } },
    ]);
    expect(state.guests).toHaveLength(0);
  });

  it("host leave errors all remaining guests", () => {
    const state = createRelayState();
    attachHost(state);
    joinGuest(state);
    joinGuest(state);
    const actions = leaveMember(state, HOST);
    expect(actions).toHaveLength(2);
    expect(actions.every((a) => a.message.type === "error" && a.message.reason === "host left")).toBe(true);
    expect(state.host).toBeNull();
  });

  it("second host attach rejected", () => {
    const state = createRelayState();
    attachHost(state);
    const actions = attachHost(state);
    expect(actions[0]!.message.type).toBe("error");
    expect(actions[0]!.message.reason).toBe("host already present");
  });
});
