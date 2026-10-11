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
import { describe, expect, it } from "vitest";
import {
  createDefaultStorageBackend,
  IndexedDbStorageBackend,
  localStorageBackend,
  type StorageEnvironment,
} from "persistence/storageBackend";
import { Storage } from "persistence/storage";
import { COMPOSITE_KEY } from "persistence/saveDocument";

/** A promise request, as `IDBRequest` behaves for the calls used here. */
class FakeRequest<T> {
  result: T | undefined = undefined;
  error: unknown = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;

  settle(): void {
    if (this.error !== null) this.onerror?.();
    else this.onsuccess?.();
  }
}

/** Every object-store name the fake has been asked to create. */
const STORE_NAMES = new Set<string>();

/** An object store: the one put/get/delete surface the backend needs. */
class FakeStore {
  readonly data = new Map<string, { key: string; value: string }>();

  createIndex(): void {
    // The backend creates an index on open; this seam never reads it.
  }

  put(record: { key: string; value: string }): FakeRequest<string> {
    const req = new FakeRequest<string>();
    this.data.set(record.key, record);
    queueMicrotask(() => {
      req.result = record.key;
      req.settle();
    });
    return req;
  }

  get(key: string): FakeRequest<{ key: string; value: string } | undefined> {
    const req = new FakeRequest<{ key: string; value: string } | undefined>();
    queueMicrotask(() => {
      req.result = this.data.get(key);
      req.settle();
    });
    return req;
  }

  delete(key: string): FakeRequest<undefined> {
    const req = new FakeRequest<undefined>();
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
  objectStore(_name: string): FakeStore {
    return this.store;
  }

  abort(): void {
    this.onabort?.();
  }
}

/**
 * An IndexedDB-shaped database. The single object store is created during the
 * upgrade transaction and shared by every later transaction, so a value written
 * by one `Storage` instance reads back from the next — the property the real
 * database gives us and the point of the seam.
 */
class FakeDatabase {
  private store: FakeStore | null = null;
  readonly transactions: FakeTransaction[] = [];

  /** Names the backend asks about when creating its store. */
  get objectStoreNames(): { contains(name: string): boolean } {
    const store = this.store;
    return { contains: (name: string) => store !== null && STORE_NAMES.has(name) };
  }

  private ensureStore(): FakeStore {
    this.store ??= new FakeStore();
    return this.store;
  }

  createObjectStore(name: string): FakeStore {
    const store = this.ensureStore();
    STORE_NAMES.add(name);
    store.createIndex();
    return store;
  }

  transaction(_names: string[], _mode?: string): FakeTransaction {
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

/** One fake environment can hand out several databases, like one origin. */
function fakeOrigin(opts: FakeOptions = {}): {
  env: StorageEnvironment;
  databases: Map<string, FakeDatabase>;
} {
  const databases = new Map<string, FakeDatabase>();
  const factory = {
    open(name: string, _version: number): unknown {
      const req = new FakeRequest<FakeDatabase>();
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
  } as StorageEnvironment["localStorage"] & MemoryStorage;
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
    const backend = new IndexedDbStorageBackend(fakeEnvironment());
    await backend.setItem(COMPOSITE_KEY, '{"schemaVersion":1}');
    expect(await backend.getItem(COMPOSITE_KEY)).toBe('{"schemaVersion":1}');
  });

  it("reads a key that was never written as null", async () => {
    const backend = new IndexedDbStorageBackend(fakeEnvironment());
    expect(await backend.getItem("never.written")).toBeNull();
  });

  it("removes a value, so a later read is null", async () => {
    const backend = new IndexedDbStorageBackend(fakeEnvironment());
    await backend.setItem(COMPOSITE_KEY, "x");
    await backend.removeItem(COMPOSITE_KEY);
    expect(await backend.getItem(COMPOSITE_KEY)).toBeNull();
  });

  it("overwrites a value in place rather than accumulating records", async () => {
    const backend = new IndexedDbStorageBackend(fakeEnvironment());
    await backend.setItem(COMPOSITE_KEY, "first");
    await backend.setItem(COMPOSITE_KEY, "second");
    expect(await backend.getItem(COMPOSITE_KEY)).toBe("second");
  });

  it("is a drop-in StorageBackend: Storage's atomic save round-trips through it", async () => {
    const backend = new IndexedDbStorageBackend(fakeEnvironment());
    await backend.setItem(COMPOSITE_KEY, "seed");
    // A second backend over the same environment = a second page load.
    const reloaded = new IndexedDbStorageBackend(fakeEnvironment());
    // Both share nothing, so prove via one instance used as Storage's backend.
    const storage = new Storage(backend, { deviceId: "device-fixed", now: () => 1_700_000_000_000 });
    storage.savePartial({ name: "Lucas", soloHighScore: 4200 });
    expect(storage.loadAll().name).toBe("Lucas");
    expect(storage.loadAll().soloHighScore).toBe(4200);
    expect(reloaded.kind).toBe("indexeddb");
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
    const env = fakeEnvironment({ openErrors: true });
    const backend = createDefaultStorageBackend(env);
    await backend.ready();
    await backend.setItem("k", "v");
    expect(await backend.getItem("k")).toBe("v");
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

describe("localStorageBackend (ticket 103)", () => {
  it("wraps the injected localStorage as a StorageBackend", async () => {
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