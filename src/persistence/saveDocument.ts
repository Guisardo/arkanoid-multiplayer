// ADR 0008: the save document. One composite key (`arkanoid.save.v1`) holds a
// schema-versioned `SaveDocument`, written atomically. Everything in this file
// is pure: no storage access, no throwing. Corrupt input degrades to per-field
// defaults so a power loss or a hand-edited key can never brick the game.

/** The one key the game owns. Bump the `.v1` segment with the schema version. */
export const COMPOSITE_KEY = "arkanoid.save.v1";

/** Current document schema. Bump + add a `MIGRATIONS` step on breaking changes. */
export const CURRENT_SCHEMA_VERSION = 1;

export interface StoredAudio {
  music: number;
  sfx: number;
  mute: boolean;
}

export type DprMode = "auto" | "2" | "1.5" | "1";

export interface StoredDisplay {
  dprMode: DprMode;
  reducedEffects: boolean;
}

/**
 * Flat, caller-facing view of the persisted data (spec §16 key table). The
 * document nests the solo records under `solo`; this view keeps them flat so
 * the settings UI and the sessions keep their existing shape.
 */
export interface FlatSaveState {
  name: string;
  skin: string | null;
  theme: string | null;
  bindingsKeyboard: string | null;
  bindingsGamepad: string | null;
  audio: StoredAudio;
  display: StoredDisplay;
  language: string | null;
  soloHighScore: number;
  soloHighestRound: number;
}

/** Persisted player settings (everything except solo progress). */
export interface SaveSettings {
  name: string;
  skin: string | null;
  theme: string | null;
  bindingsKeyboard: string | null;
  bindingsGamepad: string | null;
  audio: StoredAudio;
  display: StoredDisplay;
  language: string | null;
}

/** Solo career records — monotonic (never decreases). */
export interface SoloProgress {
  highScore: number;
  highestRound: number;
}

export type EpisodePhase = "playing" | "gameOver" | "episodeComplete";

/**
 * Optional mid-episode record behind the boot prompt's **Continue** (ADR 0008
 * §5, ticket 89). Written by the solo episode on round clear, game over, pause,
 * and a 30 s heartbeat; declared here so the schema owns it and migrations
 * preserve it.
 */
export interface EpisodeState {
  round: number;
  score: number;
  lives: number;
  phase: EpisodePhase;
  timestamp: number;
}

/**
 * A record is only Continuable while the run was still in progress. A finished
 * record (game over, episode complete) stays on disk so the state stays
 * truthful, but the boot prompt must not offer to Continue one.
 */
export function isContinuableEpisode(
  state: EpisodeState | null | undefined,
): state is EpisodeState {
  return state !== null && state !== undefined && state.phase === "playing";
}

/** The whole save, one atomic value. */
export interface SaveDocument {
  schemaVersion: number;
  /** Epoch ms of the last write — cross-device sync conflict resolution. */
  updatedAt: number;
  /** Stable per-install id — conflict detection for a future sync backend. */
  deviceId: string;
  settings: SaveSettings;
  solo: SoloProgress;
  soloEpisode?: EpisodeState | undefined;
}

/** Nondeterministic inputs injected so documents are test-deterministic. */
export interface DocumentMeta {
  now: number;
  deviceId: string;
}

export const DEFAULT_SETTINGS: SaveSettings = {
  name: "Player 1",
  skin: null,
  theme: null,
  bindingsKeyboard: null,
  bindingsGamepad: null,
  audio: { music: 0.8, sfx: 0.8, mute: false },
  display: { dprMode: "auto", reducedEffects: false },
  language: null,
};

export const DEFAULT_SOLO: SoloProgress = { highScore: 0, highestRound: 0 };

export function defaultDocument(meta: DocumentMeta): SaveDocument {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    updatedAt: meta.now,
    deviceId: meta.deviceId,
    settings: structuredCloneSafe(DEFAULT_SETTINGS),
    solo: { ...DEFAULT_SOLO },
  };
}

/**
 * Per-version migration ladder. Key = the version being upgraded FROM. Each
 * step takes the previous shape and returns the next one; an unversioned or
 * future document is not migratable and recovers to defaults.
 */
const MIGRATIONS: Record<number, (doc: unknown) => unknown> = {};

/**
 * Parse + migrate a raw stored document.
 * Returns `null` when the value cannot be trusted (bad JSON, missing/invalid
 * schemaVersion, or a version newer than this build knows) — the caller then
 * falls back to defaults rather than throwing.
 */
export function migrateDocument(raw: unknown, meta: DocumentMeta): SaveDocument | null {
  if (!isRecord(raw)) return null;
  const version = raw["schemaVersion"];
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) return null;
  // A document from a newer build: we cannot know what changed, so we refuse
  // it rather than silently handing back a half-understood save.
  if (version > CURRENT_SCHEMA_VERSION) return null;
  let doc: unknown = raw;
  for (let v = version; v < CURRENT_SCHEMA_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (step === undefined) return null;
    doc = step(doc);
  }
  return normalizeDocument(doc, meta);
}

/** Coerce a document of the current version into a fully-populated save. */
export function normalizeDocument(raw: unknown, meta: DocumentMeta): SaveDocument {
  const doc = isRecord(raw) ? raw : {};
  const episode = normalizeEpisode(doc["soloEpisode"]);
  const normalized: SaveDocument = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    updatedAt: nonNegative(doc["updatedAt"], meta.now),
    deviceId: nonEmptyString(doc["deviceId"]) ?? meta.deviceId,
    settings: normalizeSettings(doc["settings"]),
    solo: normalizeSolo(doc["solo"]),
  };
  if (episode !== undefined) normalized.soloEpisode = episode;
  return normalized;
}

export function normalizeSettings(raw: unknown): SaveSettings {
  const src = isRecord(raw) ? raw : {};
  const audio = isRecord(src["audio"]) ? src["audio"] : {};
  const display = isRecord(src["display"]) ? src["display"] : {};
  return {
    name: typeof src["name"] === "string" ? src["name"] : DEFAULT_SETTINGS.name,
    skin: nullableString(src["skin"]),
    theme: nullableString(src["theme"]),
    bindingsKeyboard: nullableString(src["bindingsKeyboard"]),
    bindingsGamepad: nullableString(src["bindingsGamepad"]),
    audio: {
      music: clamp01(audio["music"]),
      sfx: clamp01(audio["sfx"]),
      mute: audio["mute"] === true,
    },
    display: {
      dprMode: validDpr(display["dprMode"]) ? display["dprMode"] : DEFAULT_SETTINGS.display.dprMode,
      reducedEffects: display["reducedEffects"] === true,
    },
    // "" is the load-bearing "auto" sentinel (see ui/settings.ts saveSettings).
    language: nullableString(src["language"]),
  };
}

export function normalizeSolo(raw: unknown): SoloProgress {
  const src = isRecord(raw) ? raw : {};
  return {
    highScore: nonNegative(src["highScore"], 0),
    highestRound: nonNegative(src["highestRound"], 0),
  };
}

export function normalizeEpisode(raw: unknown): EpisodeState | undefined {
  if (!isRecord(raw)) return undefined;
  const phase = raw["phase"];
  if (phase !== "playing" && phase !== "gameOver" && phase !== "episodeComplete") return undefined;
  return {
    round: nonNegative(raw["round"], 1),
    score: nonNegative(raw["score"], 0),
    lives: nonNegative(raw["lives"], 0),
    phase,
    timestamp: nonNegative(raw["timestamp"], 0),
  };
}

/** Composite document → the flat view every caller already consumes. */
export function stateFromDocument(doc: SaveDocument): FlatSaveState {
  return {
    name: doc.settings.name,
    skin: doc.settings.skin,
    theme: doc.settings.theme,
    bindingsKeyboard: doc.settings.bindingsKeyboard,
    bindingsGamepad: doc.settings.bindingsGamepad,
    audio: { ...doc.settings.audio },
    display: { ...doc.settings.display },
    language: doc.settings.language,
    soloHighScore: doc.solo.highScore,
    soloHighestRound: doc.solo.highestRound,
  };
}

/**
 * Legacy per-key layout (pre-ADR-0008) → composite document. This is the
 * one-way migration for players who saved before the composite key existed.
 */
export function documentFromLegacy(state: FlatSaveState, meta: DocumentMeta): SaveDocument {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    updatedAt: meta.now,
    deviceId: meta.deviceId,
    settings: {
      name: state.name,
      skin: state.skin,
      theme: state.theme,
      bindingsKeyboard: state.bindingsKeyboard,
      bindingsGamepad: state.bindingsGamepad,
      audio: { ...state.audio },
      display: { ...state.display },
      language: state.language,
    },
    solo: {
      highScore: nonNegative(state.soloHighScore, 0),
      highestRound: nonNegative(state.soloHighestRound, 0),
    },
  };
}

/**
 * Stable per-install device id (cross-device sync readiness). Generated once
 * per page so the several `new Storage()` call sites agree; persisted in the
 * document so it survives reloads.
 */
export function newDeviceId(): string {
  const cryptoRef = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof cryptoRef?.randomUUID === "function") return cryptoRef.randomUUID();
  // Fallback for environments without WebCrypto (older jsdom, plain http).
  const bytes = new Uint8Array(16);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nonNegative(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** Volumes are 0..1; anything else falls back to the default level. */
function clamp01(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_SETTINGS.audio.music;
  return Math.max(0, Math.min(1, value));
}

function validDpr(value: unknown): value is DprMode {
  return value === "auto" || value === "2" || value === "1.5" || value === "1";
}

function structuredCloneSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
