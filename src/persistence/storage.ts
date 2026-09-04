// Typed localStorage wrapper (spec §16). Corrupt/unparseable stored values
// fall back to defaults — never throw. Injectable backend for tests.

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

export interface StorageBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface StoredAudio {
  music: number;
  sfx: number;
  mute: boolean;
}

export interface StoredDisplay {
  dprMode: "auto" | "2" | "1.5" | "1";
  reducedEffects: boolean;
}

export interface StoredState {
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

export const DEFAULTS: StoredState = {
  name: "Player 1",
  skin: null,
  theme: null,
  bindingsKeyboard: null,
  bindingsGamepad: null,
  audio: { music: 0.8, sfx: 0.8, mute: false },
  display: { dprMode: "auto", reducedEffects: false },
  language: null,
  soloHighScore: 0,
  soloHighestRound: 0,
};

export class Storage {
  private readonly backend: StorageBackend;

  constructor(backend?: StorageBackend) {
    this.backend =
      backend ??
      {
        getItem: (k) => globalThis.localStorage.getItem(k),
        setItem: (k, v) => {
          globalThis.localStorage.setItem(k, v);
        },
      };
  }

  readString(key: string, fallback: string | null = null): string | null {
    try {
      return this.backend.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  }

  writeString(key: string, value: string): void {
    try {
      this.backend.setItem(key, value);
    } catch {
      // storage full/blocked — degrade silently
    }
  }

  readNumber(key: string, fallback = 0): number {
    const raw = this.readString(key, null);
    if (raw === null) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  }

  writeNumber(key: string, value: number): void {
    this.writeString(key, String(value));
  }

  readJSON<T>(key: string, fallback: T): T {
    const raw = this.readString(key, null);
    if (raw === null) return fallback;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed === null || typeof parsed !== typeof fallback) return fallback;
      return parsed as T;
    } catch {
      return fallback;
    }
  }

  writeJSON(key: string, value: unknown): void {
    try {
      this.writeString(key, JSON.stringify(value));
    } catch {
      // circular/unserializable — degrade silently
    }
  }

  /** Load the full typed state with defaults for anything missing/corrupt. */
  loadAll(): StoredState {
    const audio = this.readJSON<StoredAudio>(STORAGE_KEYS.audio, DEFAULTS.audio);
    const display = this.readJSON<StoredDisplay>(STORAGE_KEYS.display, DEFAULTS.display);
    return {
      name: this.readString(STORAGE_KEYS.name, DEFAULTS.name) ?? DEFAULTS.name,
      skin: this.readString(STORAGE_KEYS.skin, null),
      theme: this.readString(STORAGE_KEYS.theme, null),
      bindingsKeyboard: this.readString(STORAGE_KEYS.bindingsKeyboard, null),
      bindingsGamepad: this.readString(STORAGE_KEYS.bindingsGamepad, null),
      audio: {
        music: clamp01(audio.music),
        sfx: clamp01(audio.sfx),
        mute: audio.mute,
      },
      display: {
        dprMode: validDpr(display.dprMode) ? display.dprMode : "auto",
        reducedEffects: display.reducedEffects,
      },
      language: this.readString(STORAGE_KEYS.language, null),
      soloHighScore: this.readNumber(STORAGE_KEYS.soloHighScore, 0),
      soloHighestRound: this.readNumber(STORAGE_KEYS.soloHighestRound, 0),
    };
  }

  writeAll(state: StoredState): void {
    this.writeString(STORAGE_KEYS.name, state.name);
    if (state.skin !== null) this.writeString(STORAGE_KEYS.skin, state.skin);
    if (state.theme !== null) this.writeString(STORAGE_KEYS.theme, state.theme);
    if (state.bindingsKeyboard !== null) {
      this.writeString(STORAGE_KEYS.bindingsKeyboard, state.bindingsKeyboard);
    }
    if (state.bindingsGamepad !== null) {
      this.writeString(STORAGE_KEYS.bindingsGamepad, state.bindingsGamepad);
    }
    this.writeJSON(STORAGE_KEYS.audio, state.audio);
    this.writeJSON(STORAGE_KEYS.display, state.display);
    if (state.language !== null) this.writeString(STORAGE_KEYS.language, state.language);
    this.writeNumber(STORAGE_KEYS.soloHighScore, state.soloHighScore);
    this.writeNumber(STORAGE_KEYS.soloHighestRound, state.soloHighestRound);
  }

  /** Persist a partial update over the current state (deep-merges audio/display). */
  savePartial(partial: Partial<StoredState>): void {
    const cur = this.loadAll();
    // undefined fields mean "unchanged" — keep the current value.
    const merged: Record<string, unknown> = { ...cur };
    for (const [key, value] of Object.entries(partial) as [string, unknown][]) {
      if (value !== undefined) merged[key] = value;
    }
    this.writeAll({
      ...merged,
      audio: { ...cur.audio, ...(partial.audio ?? {}) },
      display: { ...cur.display, ...(partial.display ?? {}) },
    } as StoredState);
  }

  /** Solo records (spec §16). */
  recordSolo(score: number, round: number): void {
    const cur = this.loadAll();
    this.writeNumber(STORAGE_KEYS.soloHighScore, Math.max(cur.soloHighScore, score));
    this.writeNumber(STORAGE_KEYS.soloHighestRound, Math.max(cur.soloHighestRound, round));
  }
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.8;
}

function validDpr(m: unknown): m is StoredDisplay["dprMode"] {
  return m === "auto" || m === "2" || m === "1.5" || m === "1";
}
