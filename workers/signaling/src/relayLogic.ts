export type RelayRole = "host" | "guest";

export interface RelayMember {
  role: RelayRole;
  guestIndex: number;
}

export interface RelayState {
  host: RelayMember | null;
  guests: RelayMember[];
  /** Latest host offer per guest index (multi-guest: one PC per guest). */
  hostOffers: Map<number, string>;
}

export const MAX_GUESTS = 3;

export type RelayMessageType =
  | "join"
  | "joined-ack"
  | "host-offer"
  | "guest-answer"
  | "ice"
  | "guest-joined"
  | "guest-left"
  | "room-full"
  | "error";

export interface RelayMessage {
  type: RelayMessageType;
  from?: RelayRole | undefined;
  guestIndex?: number | undefined;
  sdp?: string | undefined;
  candidate?: string | undefined;
  reason?: string | undefined;
}

export interface RelayAction {
  to: RelayMember | null;
  message: RelayMessage;
}

export function createRelayState(): RelayState {
  return { host: null, guests: [], hostOffers: new Map() };
}

const RELAY_MESSAGE_TYPES: readonly RelayMessageType[] = [
  "join", "joined-ack", "host-offer", "guest-answer", "ice",
  "guest-joined", "guest-left", "room-full", "error",
];

export function parseRelayMessage(raw: string): RelayMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const type = (parsed as { type?: unknown }).type;
  if (typeof type !== "string") return null;
  if (!RELAY_MESSAGE_TYPES.includes(type as RelayMessageType)) return null;
  return parsed as RelayMessage;
}

function nextGuestIndex(state: RelayState): number {
  for (let i = 0; i < MAX_GUESTS; i++) {
    if (!state.guests.some((g) => g.guestIndex === i)) return i;
  }
  return -1;
}

export function attachHost(state: RelayState): RelayAction[] {
  if (state.host !== null) {
    return [{ to: null, message: { type: "error", reason: "host already present" } }];
  }
  state.host = { role: "host", guestIndex: -1 };
  return [];
}

export function joinGuest(state: RelayState): { member: RelayMember | null; actions: RelayAction[] } {
  if (state.host === null) {
    return { member: null, actions: [{ to: null, message: { type: "error", reason: "room not found" } }] };
  }
  const idx = nextGuestIndex(state);
  if (idx < 0) {
    return { member: null, actions: [{ to: null, message: { type: "room-full", reason: "room full" } }] };
  }
  const member: RelayMember = { role: "guest", guestIndex: idx };
  state.guests.push(member);
  const actions: RelayAction[] = [
    { to: state.host, message: { type: "guest-joined", guestIndex: idx } },
    // Ack the guest with its index so it can await the targeted offer.
    { to: member, message: { type: "joined-ack", guestIndex: idx } },
  ];
  const offer = state.hostOffers.get(idx);
  if (offer !== undefined) {
    actions.push({ to: member, message: { type: "host-offer", guestIndex: idx, sdp: offer } });
  }
  return { member, actions };
}

export function handleRoomMessage(state: RelayState, from: RelayMember, msg: RelayMessage): RelayAction[] {
  switch (msg.type) {
    case "join": {
      return [{ to: from, message: { type: "error", reason: "join is handled at connection level" } }];
    }
    case "joined-ack": {
      return [{ to: from, message: { type: "error", reason: "joined-ack is server-sent only" } }];
    }
    case "host-offer": {
      if (from.role !== "host") {
        return [{ to: from, message: { type: "error", reason: "only host may send offer" } }];
      }
      if (msg.guestIndex === undefined) {
        return [{ to: from, message: { type: "error", reason: "offer needs guestIndex" } }];
      }
      state.hostOffers.set(msg.guestIndex, msg.sdp ?? "");
      const target = state.guests.find((g) => g.guestIndex === msg.guestIndex) ?? null;
      if (target === null) return [];
      return [{
        to: target,
        message: { type: "host-offer", guestIndex: msg.guestIndex, ...(msg.sdp !== undefined ? { sdp: msg.sdp } : {}) },
      }];
    }
    case "guest-answer": {
      if (from.role !== "guest") {
        return [{ to: from, message: { type: "error", reason: "only guest may send answer" } }];
      }
      if (state.host === null) {
        return [{ to: from, message: { type: "error", reason: "host not present" } }];
      }
      return [{
        to: state.host,
        message: { type: "guest-answer", guestIndex: from.guestIndex, ...(msg.sdp !== undefined ? { sdp: msg.sdp } : {}) },
      }];
    }
    case "ice": {
      if (from.role === "host") {
        const target = msg.guestIndex === undefined
          ? null
          : state.guests.find((g) => g.guestIndex === msg.guestIndex) ?? null;
        if (target === null) {
          return [{ to: from, message: { type: "error", reason: "unknown guest" } }];
        }
        return [{
          to: target,
          message: { type: "ice", from: "host", guestIndex: msg.guestIndex, ...(msg.candidate !== undefined ? { candidate: msg.candidate } : {}) },
        }];
      }
      if (state.host === null) {
        return [{ to: from, message: { type: "error", reason: "host not present" } }];
      }
      return [{
        to: state.host,
        message: {
          type: "ice",
          from: "guest",
          guestIndex: from.guestIndex,
          ...(msg.candidate !== undefined ? { candidate: msg.candidate } : {}) },
      }];
    }
    case "guest-joined": {
      return [{ to: from, message: { type: "error", reason: "guest-joined is server-sent only" } }];
    }
    case "guest-left":
    case "room-full":
    case "error": {
      return [{ to: from, message: { type: "error", reason: "server-sent only" } }];
    }
  }
}

export function leaveMember(state: RelayState, member: RelayMember): RelayAction[] {
  if (member.role === "host") {
    state.host = null;
    return state.guests.map((g) => ({
      to: g,
      message: { type: "error" as const, reason: "host left" },
    }));
  }
  const before = state.guests.length;
  state.guests = state.guests.filter((g) => g.guestIndex !== member.guestIndex);
  if (state.guests.length === before) return [];
  if (state.host === null) return [];
  return [{ to: state.host, message: { type: "guest-left", guestIndex: member.guestIndex } }];
}
