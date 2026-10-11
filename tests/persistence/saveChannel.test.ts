// Ticket 103: cross-tab sync of the composite save key over BroadcastChannel.
//
// The seam under test is the *channel*, not the DOM: a `SaveChannel` announces
// writes and reports the ones other tabs made. BroadcastChannel is injected
// (same reason IndexedDB was: it is a system boundary), so the test drives a
// small in-process bus that reproduces the two rules that actually matter:
//
//   1. A channel does NOT receive its own posts — so a write must not loop
//      back and re-trigger the merge UI in the tab that made it.
//   2. Posts are delivered to every OTHER channel on the same name.
//
// BroadcastChannel is the only part of this ticket that must degrade silently:
// browsers without it (or a locked-down context) simply get no cross-tab sync,
// which is the pre-existing behaviour, so the factory returns null rather than
// throwing.
import { describe, expect, it } from "vitest";
import {
  createSaveChannel,
  parseSaveMessage,
  SAVE_CHANNEL_NAME,
  type BroadcastLike,
  type SaveChannel,
  type SaveMessage,
} from "persistence/saveChannel";
import { COMPOSITE_KEY } from "persistence/saveDocument";

/**
 * An in-process BroadcastChannel bus. Posts go to every other channel with the
 * same name — never back to the sender, matching the real API.
 */
class FakeBus {
  private readonly channels = new Set<FakeChannel>();

  constructor(name: string) {
    this.name = name;
  }

  readonly name: string;

  create(): BroadcastLike {
    const ch = new FakeChannel(this);
    this.channels.add(ch);
    return ch;
  }

  post(from: FakeChannel, data: unknown): void {
    for (const ch of this.channels) {
      if (ch === from) continue;
      ch.deliver(data);
    }
  }
}

class FakeChannel {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  closed = false;

  constructor(private readonly bus: FakeBus) {}

  postMessage(data: unknown): void {
    this.bus.post(this, data);
  }

  deliver(data: unknown): void {
    this.onmessage?.({ data });
  }

  close(): void {
    this.closed = true;
  }
}

/** A save document as it travels over the wire. */
function message(updatedAt: number, deviceId: string): SaveMessage {
  return {
    type: "save-write",
    key: COMPOSITE_KEY,
    value: JSON.stringify({ schemaVersion: 1, updatedAt, deviceId }),
    origin: deviceId,
  };
}

/** Pump pending microtasks so postMessage deliveries land. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("SaveChannel — cross-tab delivery (ticket 103)", () => {
  it("reports a write made by another tab", async () => {
    const bus = new FakeBus(SAVE_CHANNEL_NAME);
    const a = createSaveChannel({ createChannel: () => bus.create() });
    const b = createSaveChannel({ createChannel: () => bus.create() });
    const seen: SaveMessage[] = [];
    b.onExternalWrite((m) => seen.push(m));

    a.publish(COMPOSITE_KEY, message(1_000, "tab-a").value);
    await settle();

    expect(seen).toHaveLength(1);
    expect(seen[0]?.value).toBe(message(1_000, "tab-a").value);
  });

  it("does NOT deliver a tab's own write back to itself", async () => {
    const bus = new FakeBus(SAVE_CHANNEL_NAME);
    const a = createSaveChannel({ createChannel: () => bus.create() });
    const seen: SaveMessage[] = [];
    a.onExternalWrite((m) => seen.push(m));

    a.publish(COMPOSITE_KEY, message(1_000, "tab-a").value);
    await settle();

    // The whole point: no self-echo, so no write loop and no self-conflict.
    expect(seen).toEqual([]);
  });

  it("fans a write out to every other tab on the channel", async () => {
    const bus = new FakeBus(SAVE_CHANNEL_NAME);
    const a = createSaveChannel({ createChannel: () => bus.create() });
    const b = createSaveChannel({ createChannel: () => bus.create() });
    const c = createSaveChannel({ createChannel: () => bus.create() });
    const seenB: SaveMessage[] = [];
    const seenC: SaveMessage[] = [];
    b.onExternalWrite((m) => seenB.push(m));
    c.onExternalWrite((m) => seenC.push(m));

    a.publish(COMPOSITE_KEY, message(1_000, "tab-a").value);
    await settle();

    expect(seenB).toHaveLength(1);
    expect(seenC).toHaveLength(1);
  });

  it("isolates tabs on a different channel name", async () => {
    const ours = new FakeBus(SAVE_CHANNEL_NAME);
    const theirs = new FakeBus("some.other.app");
    const a = createSaveChannel({ createChannel: () => ours.create() });
    const other = createSaveChannel({ createChannel: () => theirs.create() });
    const seen: SaveMessage[] = [];
    a.onExternalWrite((m) => seen.push(m));

    other.publish(COMPOSITE_KEY, message(1_000, "tab-x"));
    await settle();

    expect(seen).toEqual([]);
  });

  it("stops reporting after close()", async () => {
    const bus = new FakeBus(SAVE_CHANNEL_NAME);
    const a = createSaveChannel({ createChannel: () => bus.create() });
    const b = createSaveChannel({ createChannel: () => bus.create() });
    const seen: SaveMessage[] = [];
    a.onExternalWrite((m) => seen.push(m));

    b.publish(COMPOSITE_KEY, message(1_000, "tab-b").value);
    await settle();
    expect(seen).toHaveLength(1);

    a.close();
    b.publish(COMPOSITE_KEY, message(2_000, "tab-b").value);
    await settle();
    expect(seen).toHaveLength(1);
  });

  it("publishing after close() is a no-op, not a throw", () => {
    const bus = new FakeBus(SAVE_CHANNEL_NAME);
    const a = createSaveChannel({ createChannel: () => bus.create() });
    a.close();
    expect(() => a.publish(COMPOSITE_KEY, "value")).not.toThrow();
  });
});

describe("parseSaveMessage — garbage from another tab (ticket 103)", () => {
  it("accepts a well-formed save-write message", () => {
    const parsed = parseSaveMessage({ type: "save-write", key: "k", value: "v" });
    expect(parsed).not.toBeNull();
    expect(parsed?.key).toBe("k");
  });

  it("rejects a non-object payload", () => {
    expect(parseSaveMessage(null)).toBeNull();
    expect(parseSaveMessage("nope")).toBeNull();
    expect(parseSaveMessage(undefined)).toBeNull();
  });

  it("rejects a message of an unknown type", () => {
    expect(parseSaveMessage({ type: "something-else", key: "k", value: "v" })).toBeNull();
  });

  it("rejects a save-write missing its key or value", () => {
    expect(parseSaveMessage({ type: "save-write", value: "v" })).toBeNull();
    expect(parseSaveMessage({ type: "save-write", key: "k" })).toBeNull();
    expect(parseSaveMessage({ type: "save-write", key: 5, value: "v" })).toBeNull();
    expect(parseSaveMessage({ type: "save-write", key: "k", value: 5 })).toBeNull();
  });

  it("forwards a save whose VALUE is garbage, leaving the JSON decision to the conflict layer", async () => {
    const bus = new FakeBus(SAVE_CHANNEL_NAME);
    const a = createSaveChannel({ createChannel: () => bus.create() });
    const b = createSaveChannel({ createChannel: () => bus.create() });
    const seen: SaveMessage[] = [];
    a.onExternalWrite((m) => seen.push(m));

    // Post a well-formed message whose VALUE is garbage — the shape a corrupted
    // or hand-edited save actually arrives in. The channel must forward it and
    // let the conflict layer reject the JSON, rather than dropping it here.
    b.publish(COMPOSITE_KEY, "{not json");
    await settle();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.value).toBe("{not json");
  });

  it("drops a malformed ENVELOPE posted directly on the bus, not via publish", async () => {
    const bus = new FakeBus(SAVE_CHANNEL_NAME);
    const a = createSaveChannel({ createChannel: () => bus.create() });
    const seen: SaveMessage[] = [];
    a.onExternalWrite((m) => seen.push(m));

    // Anything on the origin can post on this channel — bypass `publish` the
    // way a buggy or hostile sibling would.
    bus.post({} as never, { type: "save-write" });
    bus.post({} as never, { nope: true });
    bus.post({} as never, null);
    await settle();

    expect(seen).toEqual([]);
  });
});

describe("createSaveChannel — absence is not an error (ticket 103)", () => {
  it("returns null when BroadcastChannel is missing", () => {
    const ch: SaveChannel | null = createSaveChannel({ createChannel: undefined });
    expect(ch).toBeNull();
  });

  it("returns null when constructing the channel throws (locked-down context)", () => {
    const ch = createSaveChannel({
      createChannel: () => {
        throw new Error("SecurityError");
      },
    });
    expect(ch).toBeNull();
  });

  it("returns null when the constructor throws synchronously inside the factory", () => {
    const ch = createSaveChannel({
      createChannel: () => {
        return undefined as unknown as BroadcastLike;
      },
    });
    // A channel object that cannot post is unusable; callers get null so the
    // game simply runs without cross-tab sync.
    expect(ch).toBeNull();
  });

  it("a null channel is safe to publish on and close", () => {
    const ch = createSaveChannel({ createChannel: undefined });
    expect(() => ch?.publish("k", "v")).not.toThrow();
    expect(() => ch?.close()).not.toThrow();
    expect(() => ch?.onExternalWrite(() => undefined)).not.toThrow();
  });

  it("survives a listener that throws, and keeps notifying the rest", async () => {
    const bus = new FakeBus(SAVE_CHANNEL_NAME);
    const a = createSaveChannel({ createChannel: () => bus.create() });
    const b = createSaveChannel({ createChannel: () => bus.create() });
    const seen: SaveMessage[] = [];
    a.onExternalWrite(() => {
      throw new Error("listener exploded");
    });
    a.onExternalWrite((m) => seen.push(m));

    b.publish(COMPOSITE_KEY, message(1_000, "tab-b").value);
    await settle();

    expect(seen).toHaveLength(1);
  });
});
