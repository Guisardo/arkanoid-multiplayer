// ADR 0008: the save store. One composite key (`arkanoid.save.v1`) written in a
// single `setItem`, so a crash mid-write can never leave a half-updated save.
// Reads try the composite document first and fall back to a one-way migration
// from the legacy per-key layout. Nothing here throws: a corrupt or unreadable
// store degrades to per-field defaults (Injectable backend for tests).

import {
  COMPOSITE_KEY,
  CURRENT_SCHEMA_VERSION,
  DEFAULT_SETTINGS,
  DEFAULT_SOLO,
  defaultDocument,
  documentFromLegacy,
  migrateDocument,
  newDeviceId,
  normalizeSettings,
  stateFromDocument,
  type DocumentMeta,
  type FlatSaveState,
  type SaveDocument,
  type SaveSettings,
} from "./saveDocument";

/**
 * The pre-ADR-0008 per-key layout. Still read (once) so existing players keep
 * their settings, then deleted after a successful composite write.
 */
export const STORAGE_KEYS = {
  name: "settings.name",
  skin: "settings.skin",
  theme: "settings.theme",
  bindingsKeyboard: "settings.bindings.keyboard",
  bindingsGamepad: "settings.bindings.gamepad",
  audio: "settings.audio",
  display: "settings.display",
  language: "settings.language",
  soloHighScore: "solo.highScore",
  soloHighestRound: "solo.highestRound",
} as const;

export const LEGACY_KEYS: readonly string[] = Object.values(STORAGE_KEYS);

export interface StorageBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The flat caller-facing view (spec §16 key table). */
export type StoredState = FlatSaveState;

export const DEFAULTS: StoredState = {
  name: DEFAULT_SETTINGS.name,
  skin: DEFAULT_SETTINGS.skin,
  theme: DEFAULT_SETTINGS.theme,
  bindingsKeyboard: DEFAULT_SETTINGS.bindingsKeyboard,
  bindingsGamepad: DEFAULT_SETTINGS.bindingsGamepad,
  audio: { ...DEFAULT_SETTINGS.audio },
  display: { ...DEFAULT_SETTINGS.display },
  language: DEFAULT_SETTINGS.language,
  soloHighScore: DEFAULT_SOLO.highScore,
  soloHighestRound: DEFAULT_SOLO.highestRound,
};

export interface StorageOptions {
  /** Stable install id (cross-device sync readiness). Generated when absent. */
  deviceId?: string | undefined;
  /** Epoch-ms clock, injected so writes are deterministic in tests. */
  now?: (() => number) | undefined;
}

/**
 * Shared per page load so the several `new Storage()` sites agree. The id is
 * persisted in the document, so this only matters for a store that has never
 * been written — the case where agreeing beats minting a fresh id per call.
 */
let pageDeviceId: string | null = null;

function resolveDeviceId(explicit: string | undefined): string {
  if (explicit !== undefined && explicit.length > 0) return explicit;
  pageDeviceId ??= newDeviceId();
  return pageDeviceId;
}

export class Storage {
  private readonly backend: StorageBackend;
  private readonly deviceId: string;
  private readonly now: () => number;

  constructor(backend?: StorageBackend, opts: StorageOptions = {}) {
    this.backend = backend ?? localStorageBackend();
    this.deviceId = resolveDeviceId(opts.deviceId);
    this.now = opts.now ?? (() => Date.now());
  }

  /** The composite key the whole save lives under. */
  get key(): string {
    return COMPOSITE_KEY;
  }

  /** Schema version this build reads and writes. */
  get schemaVersion(): number {
    return CURRENT_SCHEMA_VERSION;
  }

  private meta(): DocumentMeta {
    return { now: this.now(), deviceId: this.deviceId };
  }

  /**
   * The current save, migrating on read. Composite key first; otherwise the
   * legacy per-key layout is converted and (best effort) rewritten so the
   * migration only ever happens once.
   */
  loadDocument(): SaveDocument {
    const meta = this.meta();
    const raw = this.getItem(COMPOSITE_KEY);
    if (raw !== null) {
      const parsed = tryParse(raw);
      if (parsed !== undefined) {
        const migrated = migrateDocument(parsed, meta);
        // Unmigratable (corrupt / newer schema): hand back defaults but leave
        // the stored bytes alone — a later write is what replaces them.
        if (migrated !== null) return migrated;
      }
      return defaultDocument(meta);
    }
    // No composite document yet: read the legacy per-key layout in memory.
    // Persisting the conversion is the first *write*'s job (see
    // `writeDocument`), so a read never mutates storage.
    if (!this.hasAnyLegacyKey()) return defaultDocument(meta);
    return documentFromLegacy(this.readLegacyState(), meta);
  }

  /** Load the flat state with defaults for anything missing/corrupt. */
  loadAll(): StoredState {
    return stateFromDocument(this.loadDocument());
  }

  /**
   * Atomic write: stamp the document, serialize it whole, `setItem` once, then
   * drop the legacy keys. A failed `setItem` leaves the previous save AND the
   * legacy keys untouched — no partial state is ever observable.
   */
  writeDocument(doc: SaveDocument): void {
    const stamped: SaveDocument = { ...doc, updatedAt: this.now() };
    let json: string;
    try {
      json = JSON.stringify(stamped);
    } catch {
      return; // circular/unserializable — degrade silently
    }
    try {
      this.backend.setItem(COMPOSITE_KEY, json);
    } catch {
      return; // storage full/blocked — keep the previous save intact
    }
    // Only now is it safe to drop the legacy keys: the composite document is
    // committed and is the sole source of truth from here on.
    this.clearLegacyKeys();
  }

  writeAll(state: StoredState): void {
    const doc = this.loadDocument();
    doc.settings = {
      name: state.name,
      skin: state.skin,
      theme: state.theme,
      bindingsKeyboard: state.bindingsKeyboard,
      bindingsGamepad: state.bindingsGamepad,
      audio: { ...state.audio },
      display: { ...state.display },
      language: state.language,
    };
    doc.solo = {
      highScore: nonNegativeOr(state.soloHighScore, doc.solo.highScore),
      highestRound: nonNegativeOr(state.soloHighestRound, doc.solo.highestRound),
    };
    this.writeDocument(doc);
  }

  /**
   * Persist a partial update over the current state (deep-merges audio/display).
   *
   * The flat patch straddles both halves of the document, so it is split here:
   * settings fields land in `doc.settings`, the solo records in `doc.solo`.
   * Merging at the document level (rather than round-tripping through the flat
   * view) keeps the untouched halves byte-identical on disk.
   */
  savePartial(partial: Partial<StoredState>): void {
    const doc = this.loadDocument();
    doc.settings = mergeSettings(doc.settings, partial);
    if (partial.soloHighScore !== undefined) {
      doc.solo.highScore = nonNegativeOr(partial.soloHighScore, doc.solo.highScore);
    }
    if (partial.soloHighestRound !== undefined) {
      doc.solo.highestRound = nonNegativeOr(partial.soloHighestRound, doc.solo.highestRound);
    }
    this.writeDocument(doc);
  }

  /** Solo records (spec §16). Monotonic — a worse run never erases a record. */
  recordSolo(score: number, round: number): void {
    const doc = this.loadDocument();
    doc.solo = {
      highScore: Math.max(doc.solo.highScore, Number.isFinite(score) ? score : 0),
      highestRound: Math.max(doc.solo.highestRound, Number.isFinite(round) ? round : 0),
    };
    this.writeDocument(doc);
  }

  // ---- backend plumbing ----------------------------------------------------

  private getItem(key: string): string | null {
    try {
      return this.backend.getItem(key);
    } catch {
      return null;
    }
  }

  private clearLegacyKeys(): void {
    for (const key of LEGACY_KEYS) {
      try {
        this.backend.removeItem(key);
      } catch {
        // removal is best effort — a leftover legacy key is harmless because
        // the composite document always wins on read
      }
    }
  }

  private hasAnyLegacyKey(): boolean {
    return LEGACY_KEYS.some((key) => this.getItem(key) !== null);
  }

  /**
   * Read the pre-ADR-0008 per-key layout. The two JSON blobs are handed to the
   * shared `normalizeSettings` rather than re-implementing coercion here, so a
   * legacy save gets exactly the same corruption recovery as a composite one.
   */
  private readLegacyState(): FlatSaveState {
    const audio = this.readJSON(STORAGE_KEYS.audio);
    const display = this.readJSON(STORAGE_KEYS.display);
    const settings = normalizeSettings({
      name: this.readString(STORAGE_KEYS.name),
      skin: this.readString(STORAGE_KEYS.skin),
      theme: this.readString(STORAGE_KEYS.theme),
      bindingsKeyboard: this.readString(STORAGE_KEYS.bindingsKeyboard),
      bindingsGamepad: this.readString(STORAGE_KEYS.bindingsGamepad),
      audio,
      display,
      language: this.readString(STORAGE_KEYS.language),
    });
    return {
      name: settings.name,
      skin: settings.skin,
      theme: settings.theme,
      bindingsKeyboard: settings.bindingsKeyboard,
      bindingsGamepad: settings.bindingsGamepad,
      audio: settings.audio,
      display: settings.display,
      language: settings.language,
      soloHighScore: this.readNumber(STORAGE_KEYS.soloHighScore),
      soloHighestRound: this.readNumber(STORAGE_KEYS.soloHighestRound),
    };
  }

  private readString(key: string): string | null {
    return this.getItem(key);
  }

  private readNumber(key: string): number {
    const raw = this.getItem(key);
    if (raw === null) return 0;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }

  private readJSON(key: string): Record<string, unknown> {
    const parsed = tryParse(this.getItem(key) ?? "");
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  }
}

function localStorageBackend(): StorageBackend {
  return {
    getItem: (k) => globalThis.localStorage.getItem(k),
    setItem: (k, v) => {
      globalThis.localStorage.setItem(k, v);
    },
    removeItem: (k) => {
      globalThis.localStorage.removeItem(k);
    },
  };
}

function tryParse(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function nonNegativeOr(value: number, fallback: number): number {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * Merge a flat partial into the document's settings. Only the settings half of
 * `StoredState` is read — `soloHighScore` / `soloHighestRound` are handled by
 * the caller, which keeps them in `doc.solo`.
 */
function mergeSettings(cur: SaveSettings, partial: Partial<StoredState>): SaveSettings {
  const merged: SaveSettings = {
    name: partial.name !== undefined ? partial.name : cur.name,
    skin: partial.skin !== undefined ? partial.skin : cur.skin,
    theme: partial.theme !== undefined ? partial.theme : cur.theme,
    bindingsKeyboard:
      partial.bindingsKeyboard !== undefined ? partial.bindingsKeyboard : cur.bindingsKeyboard,
    bindingsGamepad: partial.bindingsGamepad !== undefined ? partial.bindingsGamepad : cur.bindingsGamepad,
    language: partial.language !== undefined ? partial.language : cur.language,
    audio: { ...cur.audio, ...(partial.audio ?? {}) },
    display: { ...cur.display, ...(partial.display ?? {}) },
  };
  return merged;
}
