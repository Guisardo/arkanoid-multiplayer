// Ticket 103: the storage-backend seam (ADR 0008 sync readiness).
//
// `StorageBackend` was already injectable, but only `localStorage` was ever
// wired. These tests pin the two seams the ticket asks for:
//
//   1. `IndexedDbStorageBackend` reads and writes the composite key through a
//      real IndexedDB-shaped database, with one atomic put per write.
//   2. `createDefaultStorageBackend` picks IndexedDB when it works and degrades
//      to localStorage when it does not (private mode, blocked, old browser).
//
// IndexedDB is a system boundary, so it is injected as one: a small fake
// factory passed through `StorageEnvironment`. The production code only ever
// talks to the browser API.
//
// IMPORTANT — why these cases use `fetchItem` rather than `getItem`:
// `getItem`/`setItem` are synchronous by contract and read/write an in-process
// mirror, because IndexedDB itself is async. A test that only round-trips the
// mirror would pass even if the database were never consulted at all, so the
// round-trip cases below read back through `fetchItem` — the one method that
// actually issues an IndexedDB `get` — and share one fake origin across two
// backend instances to prove the value reached the database rather than a
// per-instance cache.
import { describe, expect, it, vi } from "vitest";
import {
  browserStorageEnvironment,
  createDefaultStorageBackend,
  IndexedDbStorageBackend,
  localStorageBackend,
  type StorageEnvironment,
} from "persistence/storageBackend";
import { Storage } from "persistence/storage";
import { COMPOSITE_KEY } from "persistence/saveDocument";

/** A promise request, as `IDBRequest` behaves for the calls used here. */
class FakeRequest {
  /** The success value. Untyped because only the tests read it back. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: any = undefined;
  error: unknown = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;

  settle(): void {
    if (this.error !== null) this.onerror?.();
    else this.onsuccess?.();
  }
}

/** An object store: the one put/get/delete surface the backend needs. */
class FakeStore {
  readonly data = new Map<string, { key: string; value: string }>();

  createIndex(): void {
    // The backend creates an index on open; this seam never reads it.
  }

  put(record: { key: string; value: string }): FakeRequest {
    const req = new FakeRequest();
    this.data.set(record.key, record);
    queueMicrotask(() => {
      req.result = record.key;
      req.settle();
    });
    return req;
  }

  get(key: string): FakeRequest {
    const req = new FakeRequest();
    queueMicrotask(() => {
      req.result = this.data.get(key);
      req.settle();
    });
    return req;
  }

  delete(key: string): FakeRequest {
    const req = new FakeRequest();
    this.data.delete(key);
    queueMicrotask(() => {
      req.result = undefined;
      req.settle();
    });
    return req;
  }
}

class FakeTransaction {
  readonly store = new FakeStore();
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;

  /** The store is addressed by name; one name is all this fake has. */
  objectStore(): FakeStore {
    return this.store;
  }

  abort(): void {
    this.onabort?.();
  }
}

/**
 * An IndexedDB-shaped database. The single object store is created during the
 * upgrade transaction and shared by every later transaction, so a value written
 * by one backend instance reads back from the next — the property the real
 * database gives us and the point of the seam.
 */
class FakeDatabase {
  private store: FakeStore | null = null;
  readonly transactions: FakeTransaction[] = [];

  /** The names the backend asked about when creating its store. */
  readonly createdStores: string[] = [];

  /** Names the backend asks about when checking for an existing store. */
  get objectStoreNames(): { contains(name: string): boolean } {
    return { contains: (name: string) => this.createdStores.includes(name) };
  }

  private ensureStore(): FakeStore {
    this.store ??= new FakeStore();
    return this.store;
  }

  createObjectStore(name: string): FakeStore {
    const store = this.ensureStore();
    this.createdStores.push(name);
    store.createIndex();
    return store;
  }

  // The store name and mode are part of the real API but the fake has one store.
  transaction(): FakeTransaction {
    const shared = this.ensureStore();
    const tx = new FakeTransaction();
    tx.objectStore = () => shared;
    this.transactions.push(tx);
    queueMicrotask(() => {
      tx.oncomplete?.();
    });
    return tx;
  }
}

interface FakeOptions {
  /** The `open()` request errors — Safari private mode, blocked storage. */
  openErrors?: boolean;
}

/** One fake origin: many databases by name, shared across backend instances. */
function fakeOrigin(opts: FakeOptions = {}): {
  env: StorageEnvironment;
  databases: Map<string, FakeDatabase>;
} {
  const databases = new Map<string, FakeDatabase>();
  const factory = {
    open(name: string): unknown {
      const req = new FakeRequest();
      queueMicrotask(() => {
        if (opts.openErrors === true) {
          req.error = new Error("SecurityError");
          req.settle();
          return;
        }
        let db = databases.get(name);
        if (db === undefined) {
          db = new FakeDatabase();
          databases.set(name, db);
          const upgrade = new FakeTransaction();
          upgrade.oncomplete = () => undefined;
          req.result = db;
          (req as unknown as { transaction: FakeTransaction }).transaction = upgrade;
          req.onupgradeneeded?.();
        } else {
          req.result = db;
        }
        req.settle();
      });
      return req;
    },
  } as unknown as IDBFactory;
  return {
    databases,
    env: { indexedDB: factory, localStorage: memoryStorage() },
  };
}

function fakeEnvironment(opts: FakeOptions = {}): StorageEnvironment {
  return fakeOrigin(opts).env;
}

/** An in-memory `localStorage`, plus a record of every write for assertions. */
interface MemoryStorage {
  readonly store: Map<string, string>;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function memoryStorage(): StorageEnvironment["localStorage"] & MemoryStorage {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
  };
}

/** Environment whose IndexedDB open fails AND whose localStorage throws. */
function hostileEnvironment(): StorageEnvironment {
  return {
    indexedDB: undefined,
    localStorage: {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    },
  };
}

describe("IndexedDbStorageBackend — read/write (ticket 103)", () => {
  it("stores a value under the composite key and reads it back", async () => {
    const { env } = fakeOrigin();
    const backend = new IndexedDbStorageBackend(env);
    await backend.ready();
    backend.setItem(COMPOSITE_KEY, '{"schemaVersion":1}');
    // Read through the DATABASE, not the mirror: this is what proves the
    // write actually reached IndexedDB.
    expect(await backend.fetchItem(COMPOSITE_KEY)).toBe('{"schemaVersion":1}');
  });

  it("reads a key that was never written as null", async () => {
    const backend = new IndexedDbStorageBackend(fakeEnvironment());
    await backend.ready();
    expect(await backend.fetchItem("never.written")).toBeNull();
  });

  it("removes a value, so a later read is null", async () => {
    const backend = new IndexedDbStorageBackend(fakeEnvironment());
    await backend.ready();
    backend.setItem(COMPOSITE_KEY, "x");
    expect(await backend.fetchItem(COMPOSITE_KEY)).toBe("x");
    backend.removeItem(COMPOSITE_KEY);
    expect(await backend.fetchItem(COMPOSITE_KEY)).toBeNull();
  });

  it("overwrites a value in place rather than accumulating records", async () => {
    const { env } = fakeOrigin();
    const backend = new IndexedDbStorageBackend(env);
    await backend.ready();
    backend.setItem(COMPOSITE_KEY, "first");
    backend.setItem(COMPOSITE_KEY, "second");
    expect(await backend.fetchItem(COMPOSITE_KEY)).toBe("second");
  });

  it("persists across backend instances over the same origin", async () => {
    // The property the mirror alone cannot prove: one page load writes, a
    // second reads the value back out of the database.
    const { env } = fakeOrigin();
    const first = new IndexedDbStorageBackend(env);
    await first.ready();
    first.setItem(COMPOSITE_KEY, "persisted");
    await first.fetchItem(COMPOSITE_KEY); // drain the in-flight put

    const second = new IndexedDbStorageBackend(env);
    await second.ready();
    expect(await second.fetchItem(COMPOSITE_KEY)).toBe("persisted");
  });

  it("is a drop-in StorageBackend: Storage's atomic save round-trips through it", async () => {
    const backend = new IndexedDbStorageBackend(fakeEnvironment());
    await backend.ready();
    const storage = new Storage(backend, { deviceId: "device-fixed", now: () => 1_700_000_000_000 });
    storage.savePartial({ name: "Lucas", soloHighScore: 4200 });
    expect(storage.loadAll().name).toBe("Lucas");
    expect(storage.loadAll().soloHighScore).toBe(4200);
    expect(backend.kind).toBe("indexeddb");
  });
});

describe("createDefaultStorageBackend — fallback (ticket 103)", () => {
  it("uses IndexedDB when it opens successfully", async () => {
    const backend = createDefaultStorageBackend(fakeEnvironment());
    await backend.ready();
    expect(backend.kind).toBe("indexeddb");
  });

  it("falls back to localStorage when IndexedDB is absent", async () => {
    const backend = createDefaultStorageBackend({
      indexedDB: undefined,
      localStorage: memoryStorage(),
    });
    await backend.ready();
    expect(backend.kind).toBe("localstorage");
  });

  it("falls back to localStorage when open() throws (storage blocked by policy)", async () => {
    const backend = createDefaultStorageBackend({
      indexedDB: {
        open() {
          throw new Error("blocked by policy");
        },
      } as unknown as IDBFactory,
      localStorage: memoryStorage(),
    });
    await backend.ready();
    expect(backend.kind).toBe("localstorage");
  });

  it("falls back to localStorage when the open request errors (private mode)", async () => {
    const backend = createDefaultStorageBackend(fakeEnvironment({ openErrors: true }));
    await backend.ready();
    expect(backend.kind).toBe("localstorage");
  });

  it("the localStorage fallback still reads and writes", async () => {
    const env = fakeOrigin({ openErrors: true });
    const backend = createDefaultStorageBackend(env.env);
    await backend.ready();
    backend.setItem("k", "v");
    expect(backend.getItem("k")).toBe("v");
  });

  it("degrades to an in-memory backend when nothing at all works (still boots)", async () => {
    const backend = createDefaultStorageBackend(hostileEnvironment());
    await backend.ready();
    expect(backend.kind).toBe("memory");
    // Storage's "never throws" contract still holds on top of it.
    const storage = new Storage(backend, { deviceId: "d", now: () => 1 });
    storage.savePartial({ name: "Ghost" });
    expect(storage.loadAll().name).toBe("Ghost");
  });
});

describe("hydrate — the cold-read hazard (ticket 103)", () => {
  // These are the cases that justify hydration existing at all. Without it a
  // second page load reads an empty mirror, `Storage` concludes there is no
  // save, and the game boots on defaults — then writes those defaults over the
  // real save on the first setting change.

  it("a cold sync read is null until hydrate pulls the stored value in", async () => {
    const { env } = fakeOrigin();
    const first = new IndexedDbStorageBackend(env);
    await first.ready();
    first.setItem(COMPOSITE_KEY, '{"schemaVersion":1,"saved":true}');
    await first.fetchItem(COMPOSITE_KEY); // drain the put

    const second = new IndexedDbStorageBackend(env);
    await second.ready();
    // The hazard: sync `getItem` can only see this instance's mirror.
    expect(second.getItem(COMPOSITE_KEY)).toBeNull();
    await second.hydrate([COMPOSITE_KEY]);
    expect(second.getItem(COMPOSITE_KEY)).toBe('{"schemaVersion":1,"saved":true}');
  });

  it("Storage reads the real save after hydration, not defaults", async () => {
    const { env } = fakeOrigin();
    const first = new IndexedDbStorageBackend(env);
    await first.ready();
    new Storage(first, { deviceId: "d", now: () => 1_700_000_000_000 }).savePartial({
      name: "RealPlayer",
      soloHighScore: 9000,
    });
    await first.fetchItem(COMPOSITE_KEY);

    // A second page load: unhydrated, it would see "no save".
    const backend = createDefaultStorageBackend(env);
    await backend.ready();
    await backend.hydrate([COMPOSITE_KEY]);
    const reopened = new Storage(backend, { deviceId: "d", now: () => 1_800_000_000_000 });
    expect(reopened.loadAll().name).toBe("RealPlayer");
    expect(reopened.loadAll().soloHighScore).toBe(9000);
  });

  it("hydrate carries the legacy keys too, so a pre-ADR-0008 save is found", async () => {
    const { env } = fakeOrigin();
    const first = new IndexedDbStorageBackend(env);
    await first.ready();
    first.setItem("settings.name", "Legacy");
    await first.fetchItem("settings.name");

    const second = new IndexedDbStorageBackend(env);
    await second.ready();
    await second.hydrate(["settings.name"]);
    expect(second.getItem("settings.name")).toBe("Legacy");
  });

  it("hydrate on the composed backend waits for the open, so it cannot race it", async () => {
    const { env } = fakeOrigin();
    const first = new IndexedDbStorageBackend(env);
    await first.ready();
    first.setItem("k", "v");
    await first.fetchItem("k");

    const backend = createDefaultStorageBackend(env);
    // No `await ready()` first — hydrate must still land.
    await backend.hydrate(["k"]);
    expect(backend.getItem("k")).toBe("v");
  });

  it("a missing key stays missing — hydration invents nothing", async () => {
    const backend = new IndexedDbStorageBackend(fakeEnvironment());
    await backend.ready();
    await backend.hydrate([COMPOSITE_KEY, "never.written"]);
    expect(backend.getItem(COMPOSITE_KEY)).toBeNull();
    expect(backend.getItem("never.written")).toBeNull();
  });

  it("the sync fallbacks hydrate as a no-op (their reads are already live)", async () => {
    const local = memoryStorage();
    local.setItem("k", "v");
    const backend = createDefaultStorageBackend({ indexedDB: undefined, localStorage: local });
    // Reads hit localStorage directly, so nothing to pull in — but the call
    // must still be safe to make unconditionally.
    await backend.hydrate(["k"]);
    expect(backend.getItem("k")).toBe("v");
    expect(backend.kind).toBe("localstorage");
  });
});

describe("browserStorageEnvironment (ticket 103)", () => {
  // The production environment probe. `createSaveBackend` calls this with no
  // arguments, so whatever it reports decides which backend the page gets.
  // Node has neither global, which is itself a case worth pinning: the boot
  // path must degrade to memory rather than throw on a missing global.

  it("reports neither backend in a host with no storage globals", () => {
    const env = browserStorageEnvironment();
    expect(env.indexedDB).toBeUndefined();
    expect(env.localStorage).toBeUndefined();
  });

  it("still produces a working (memory) backend on that empty environment", async () => {
    // The end-to-end consequence: no globals is not a crash, it is a game that
    // plays but forgets. That is the documented degrade-not-block contract.
    const backend = createDefaultStorageBackend(browserStorageEnvironment());
    await backend.ready();
    expect(backend.kind).toBe("memory");
  });

  it("passes the host's real globals through when they exist", () => {
    const fake = {
      indexedDB: {} as unknown as IDBFactory,
      localStorage: memoryStorage(),
    };
    vi.stubGlobal("indexedDB", fake.indexedDB);
    vi.stubGlobal("localStorage", fake.localStorage);
    try {
      const env = browserStorageEnvironment();
      expect(env.indexedDB).toBe(fake.indexedDB);
      expect(env.localStorage).toBe(fake.localStorage);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("localStorageBackend (ticket 103)", () => {
  it("wraps the injected localStorage as a StorageBackend", () => {
    const local = memoryStorage();
    const backend = localStorageBackend({ localStorage: local });
    expect(backend.kind).toBe("localstorage");
    backend.setItem("a", "1");
    expect(backend.getItem("a")).toBe("1");
    backend.removeItem("a");
    expect(backend.getItem("a")).toBeNull();
    expect(local.store.size).toBe(0);
  });
});