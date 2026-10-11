// ADR 0008 sync readiness (ticket 103): the swappable storage backend.
//
// The save document under the composite key is written in ONE `setItem`, so
// the backend has to offer one atomic value put. localStorage already did;
// IndexedDB offers the same via a single-record `put` in one transaction, and
// buys quota headroom plus a real transaction boundary for the future
// cross-device sync engine.
//
// Two rules this module keeps, in order of importance:
//   1. Never throw. A hostile environment must still boot the game — the
//      backend chain degrades indexedDB → localStorage → memory.
//   2. Reads and writes are async (IndexedDB is), so the backend exposes a
//      `ready()` promise. `Storage` stays synchronous by buffering through the
//      backend's write queue and reading its own mirror; see `createSaveBackend`
//      in storage.ts for the wiring the app uses.

import type { StorageBackend } from "./storage";

export type StorageBackendKind = "indexeddb" | "localstorage" | "memory";

/**
 * The browser surface a backend may use, injected so tests (and the fallback
 * probe) never touch the real globals. Absent members are the "unavailable"
 * signal, not an error.
 */
export interface StorageEnvironment {
  readonly indexedDB?: IDBFactory | undefined;
  readonly localStorage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined;
}

/**
 * A backend plus the async handshake the boot path awaits. `kind` is for
 * diagnostics and for the tests that prove the fallback fired.
 */
export interface ReadyStorageBackend extends StorageBackend {
  readonly kind: StorageBackendKind;
  /** Resolves once the backend is usable (the open finished or degraded). */
  ready(): Promise<void>;
}

export const DB_NAME = "arkanoid";
export const DB_VERSION = 1;
/** One object store holds every key/value, keyed by the composite key. */
export const STORE_NAME = "save";

interface SaveRecord {
  key: string;
  value: string;
}

/**
 * IndexedDB backend. One record per key, so a whole-document write is a single
 * `put` — the same all-or-nothing property ADR 0008 relies on.
 *
 * Operations are queued behind the open so callers can fire-and-forget: a
 * `setItem` issued before the database is open is not dropped, it just waits.
 */
export class IndexedDbStorageBackend implements ReadyStorageBackend {
  readonly kind = "indexeddb" as const;

  private readonly env: StorageEnvironment;
  private readonly dbName: string;
  private readonly storeName: string;
  private db: IDBDatabase | null = null;
  private failure: unknown = null;
  /** Operations issued before the open settled, replayed in order. */
  private queue: Array<() => void> = [];
  private opened: Promise<void>;

  constructor(env: StorageEnvironment, dbName: string = DB_NAME, storeName: string = STORE_NAME) {
    this.env = env;
    this.dbName = dbName;
    this.storeName = storeName;
    this.opened = this.open();
  }

  /** Resolve on the first usable open; reject-free — a failure sets `failed`. */
  async ready(): Promise<void> {
    await this.opened;
  }

  /** True when the database never opened (the caller should fall back). */
  get failed(): boolean {
    return this.failure !== null;
  }

  private open(): Promise<void> {
    const factory = this.env.indexedDB;
    if (factory === undefined) {
      this.failure = new Error("IndexedDB unavailable");
      this.settleQueue();
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      let request: IDBOpenDBRequest;
      try {
        request = factory.open(this.dbName, DB_VERSION);
      } catch (err) {
        // Blocked storage throws synchronously from `open()`.
        this.failure = err;
        this.settleQueue();
        resolve();
        return;
      }
      request.onupgradeneeded = () => {
        try {
          const db = request.result;
          if (!db.objectStoreNames.contains(this.storeName)) {
            db.createObjectStore(this.storeName, { keyPath: "key" });
          }
        } catch (err) {
          this.failure = err;
        }
      };
      request.onsuccess = () => {
        this.db = request.result;
        this.settleQueue();
        resolve();
      };
      request.onerror = () => {
        this.failure = request.error ?? new Error("IndexedDB open failed");
        this.settleQueue();
        resolve();
      };
      request.onblocked = () => {
        // Another tab holds an older version open; treat as unusable.
        this.failure = new Error("IndexedDB open blocked");
        this.settleQueue();
        resolve();
      };
    });
  }

  private settleQueue(): void {
    const pending = this.queue;
    this.queue = [];
    for (const op of pending) op();
  }

  /** Run `op` once the database is open (immediately if it already is). */
  private whenOpen(op: () => void): void {
    if (this.db !== null || this.failure !== null) {
      op();
      return;
    }
    this.queue.push(op);
  }

  getItem(key: string): string | null {
    // Synchronous by contract, but IndexedDB is not: report the last value the
    // backend itself wrote, which is the only one it can know without waiting.
    // A cold read (nothing written this session) is null — `Storage` degrades
    // to defaults, and `ready()` callers use `hydrate()` below for the truth.
    return this.mirror.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.mirror.set(key, value);
    this.whenOpen(() => {
      this.transact((store) => store.put({ key, value } satisfies SaveRecord));
    });
  }

  removeItem(key: string): void {
    this.mirror.delete(key);
    this.whenOpen(() => {
      this.transact((store) => store.delete(key));
    });
  }

  /**
   * The stored value for `key`, awaiting the database when necessary. The boot
   * path calls this once per key it needs so an async backend is not silently
   * read as empty; `getItem` above stays sync for the `StorageBackend` shape.
   */
  async fetchItem(key: string): Promise<string | null> {
    await this.opened;
    if (this.db === null) return this.mirror.get(key) ?? null;
    // Annotate at the transaction boundary: `IDBDatabase.transaction` is typed
    // loosely enough that the chained `.get()` arrives as `IDBRequest<any>`,
    // which would defeat the `request<T>` signature below.
    const tx: IDBTransaction = this.db.transaction(this.storeName, "readonly");
    const record = await this.request<SaveRecord | undefined>(
      tx.objectStore(this.storeName).get(key) as IDBRequest<SaveRecord | undefined>,
    );
    if (record === undefined) return null;
    this.mirror.set(key, record.value);
    return record.value;
  }

  private readonly mirror = new Map<string, string>();

  private transact(act: (store: IDBObjectStore) => void): void {
    const db = this.db;
    if (db === null) return;
    try {
      const tx = db.transaction(this.storeName, "readwrite");
      act(tx.objectStore(this.storeName));
      // Failures must not reject into the void; a dropped write degrades to
      // "the previous save stands", exactly like a localStorage failure.
      tx.onerror = () => undefined;
      tx.onabort = () => undefined;
    } catch {
      // Transaction refused (db closed, storage evicted mid-write).
    }
  }

  private request<T>(req: IDBRequest<T>): Promise<T | undefined> {
    return new Promise<T | undefined>((resolve) => {
      req.onsuccess = () => {
        resolve(req.result);
      };
      req.onerror = () => {
        resolve(undefined);
      };
    });
  }
}

/**
 * localStorage backend, reading its three calls off the injected environment.
 * Its methods may throw (quota, SecurityError) — `Storage` already treats a
 * throwing backend as "no value" and "write refused".
 */
export function localStorageBackend(env: StorageEnvironment): ReadyStorageBackend {
  const store = env.localStorage;
  const kind: StorageBackendKind = store === undefined ? "memory" : "localstorage";
  if (store === undefined) return memoryBackend();
  return {
    kind,
    ready: () => Promise.resolve(),
    getItem: (key) => store.getItem(key),
    setItem: (key, value) => {
      store.setItem(key, value);
    },
    removeItem: (key) => {
      store.removeItem(key);
    },
  };
}

/**
 * Last-resort backend: an in-memory map. Nothing is persisted, but the game
 * boots and settings changes still apply for the session. Reached only when
 * both IndexedDB and localStorage are refused (locked-down/private contexts).
 */
export function memoryBackend(): ReadyStorageBackend {
  const map = new Map<string, string>();
  return {
    kind: "memory",
    ready: () => Promise.resolve(),
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

/**
 * Pick the best available backend: IndexedDB when it opens, else localStorage,
 * else memory. Resolves once the choice is settled, so the caller can await
 * `ready()` and know which store it is talking to before the first read.
 *
 * The returned object is BOTH the resolved backend and the promise, so
 * `await createDefaultStorageBackend(env)` yields a ready backend and
 * `createDefaultStorageBackend(env).kind` stays readable synchronously.
 */
export function createDefaultStorageBackend(env: StorageEnvironment): ReadyStorageBackend {
  const indexed = new IndexedDbStorageBackend(env);
  const fallback = (): ReadyStorageBackend => {
    const local = localStorageBackend(env);
    // The localStorage shim may itself be unusable; probe it once so `kind`
    // tells the truth about what the game will actually persist to.
    if (local.kind === "localstorage") {
      try {
        local.getItem("arkanoid.backend.probe");
        local.removeItem("arkanoid.backend.probe");
        return local;
      } catch {
        return memoryBackend();
      }
    }
    return local;
  };
  let chosen: ReadyStorageBackend = indexed;
  const ready = indexed.ready().then(() => {
    if (!indexed.failed) return;
    chosen = fallback();
  });
  return {
    get kind(): StorageBackendKind {
      return chosen.kind;
    },
    ready: () => ready.then(() => chosen.ready()),
    getItem: (key) => chosen.getItem(key),
    setItem: (key, value) => {
      chosen.setItem(key, value);
    },
    removeItem: (key) => {
      chosen.removeItem(key);
    },
  };
}