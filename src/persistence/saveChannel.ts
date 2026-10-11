// Ticket 103: cross-tab save sync over BroadcastChannel.
//
// Two tabs of the same origin share one save. Before this, a settings change in
// one tab was invisible in the other until a reload — and worse, the second
// tab's next write silently clobbered the first. This announces writes so the
// other tabs can adopt or merge them (see `persistence/conflict`).
//
// Design notes worth stating, because they are what make this safe:
//
//   - The message carries the VALUE, not just a "something changed" ping.
//     A ping would make every receiving tab re-read the store, which on an
//     async backend is a race: two tabs could read, interleave and write back
//     in the wrong order. Shipping the bytes makes the update atomic from the
//     receiver's point of view.
//   - BroadcastChannel never delivers a post to its own channel, so there is
//     no self-echo and no write loop. Nothing here filters for it.
//   - Every failure path degrades to "no cross-tab sync". A tab that cannot
//     sync still plays and still persists; it is exactly the pre-ticket
//     behaviour, which is a safe thing to fall back to.

/** The minimal BroadcastChannel surface used here. */
export interface BroadcastLike {
  postMessage(data: unknown): void;
  close?(): void;
  onmessage?: ((event: { data: unknown }) => void) | null;
}

/** Channel name shared by every tab of this origin. */
export const SAVE_CHANNEL_NAME = "arkanoid.save.v1";

/** The wire format. Only one message type so far; the field is future-proofing. */
export interface SaveMessage {
  type: "save-write";
  key: string;
  value: string;
  /** The writing install's id, so a receiver can recognise its own echo. */
  origin?: string;
}

export interface SaveChannelEnvironment {
  /**
   * Constructs a channel, or undefined when the browser has none. Injected so
   * the absence path is testable and so the game never touches the global
   * directly.
   */
  readonly createChannel: ((name: string) => BroadcastLike) | undefined;
}

export interface SaveChannel {
  /** Announce a write to the other tabs. Never throws. */
  publish(key: string, value: string, origin?: string): void;
  /**
   * Register a listener for writes made by OTHER tabs. Passing a new listener
   * replaces the previous one — the channel has a single consumer (the storage
   * sync), and a list would make teardown the caller's problem.
   */
  onExternalWrite(listener: ((message: SaveMessage) => void) | null): void;
  /** Release the channel. Idempotent. */
  close(): void;
}

/**
 * Validate an inbound payload. Any tab on the origin can post anything on this
 * channel, so nothing is trusted — a malformed message is dropped, never
 * thrown, so one bad post cannot break the receiving tab's save.
 */
export function parseSaveMessage(raw: unknown): SaveMessage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const msg = raw as Record<string, unknown>;
  if (msg["type"] !== "save-write") return null;
  const key = msg["key"];
  const value = msg["value"];
  if (typeof key !== "string" || key.length === 0) return null;
  if (typeof value !== "string") return null;
  const origin = msg["origin"];
  return {
    type: "save-write",
    key,
    value,
    ...(typeof origin === "string" ? { origin } : {}),
  };
}

/**
 * Open a save channel, or return null when cross-tab sync is unavailable.
 *
 * Returning null (rather than a no-op object) is deliberate: callers spell the
 * "no sync" branch explicitly, so it is obvious in review where the feature
 * silently does nothing.
 */
export function createSaveChannel(env: SaveChannelEnvironment): SaveChannel | null {
  if (typeof env.createChannel !== "function") return null;

  let channel: BroadcastLike;
  try {
    channel = env.createChannel(SAVE_CHANNEL_NAME);
  } catch {
    // Locked-down / private contexts throw on construction.
    return null;
  }
  if (typeof channel?.postMessage !== "function") return null;

  let listener: ((message: SaveMessage) => void) | null = null;
  let closed = false;

  channel.onmessage = (event: { data: unknown }) => {
    if (closed) return;
    const message = parseSaveMessage(event.data);
    if (message === null) return;
    try {
      listener?.(message);
    } catch {
      // A throwing consumer must not break the channel or starve the other
      // listeners; the save is still intact either way.
    }
  };

  return {
    publish(key: string, value: string, origin?: string): void {
      if (closed) return;
      const message: SaveMessage = {
        type: "save-write",
        key,
        value,
        ...(origin !== undefined ? { origin } : {}),
      };
      try {
        channel.postMessage(message);
      } catch {
        // Structured-clone failure or a closed channel: the write itself
        // already landed in storage, only the announcement is lost.
      }
    },
    onExternalWrite(next: ((message: SaveMessage) => void) | null): void {
      listener = next;
    },
    close(): void {
      if (closed) return;
      closed = true;
      listener = null;
      try {
        channel.close?.();
      } catch {
        // Nothing useful to do; the channel is already unusable.
      }
    },
  };
}

/** The production environment: the browser's own BroadcastChannel, if any. */
export function browserSaveChannelEnvironment(): SaveChannelEnvironment {
  const ctor = (globalThis as { BroadcastChannel?: new (name: string) => BroadcastLike })
    .BroadcastChannel;
  return {
    createChannel:
      typeof ctor === "function" ? (name: string) => new ctor(name) : undefined,
  };
}
