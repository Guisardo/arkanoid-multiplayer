# Save Systems Audit — Arkanoid Multiplayer

*Ticket #80: "Save Systems: Episode Progress, Settings, Atomic Writes, Migration"*

---

## 1. Episode Progress (Solo)

### What is persisted

| Field | Storage Key | Type | When Written |
|-------|-------------|------|--------------|
| High score | `solo.highScore` | number | On round clear, game over, episode complete |
| Highest round reached | `solo.highestRound` | number | On round clear, game over, episode complete |

**Source:** `src/persistence/storage.ts:13-14, 177-182` — `STORAGE_KEYS.soloHighScore`, `STORAGE_KEYS.soloHighestRound`, `recordSolo()`.

### Episode state model (in-memory, NOT persisted mid-run)

`SoloEpisode` (src/app/soloEpisode.ts:18-35) holds:
- `round` — current round (1–33)
- `score` — accumulated score
- `phase` — `"playing" | "gameOver" | "episodeComplete"`
- `paused` — boolean
- `tick` — frame counter
- `sim` — `RoundSim` (lives, bricks, capsules, balls, paddles)

**Source:** `src/app/soloEpisode.ts:44-60` — local variables `round`, `score`, `phase`, `paused`, `tick`, `sim`.

### Round transition & persistence

- On **round clear** (`snap.phase === "roundClear"`): `record()` called → `storage.recordSolo(score, round)` (lines 75-77, 81-83)
- On **game over** (`snap.phase === "gameOver"`): score synced from sim, then `record()` (lines 84-89)
- On **Continue**: `score = floor(score * 0.4)`, fresh lives, same round (lines 104-109)
- On **Restart**: `round = 1`, `score = 0` (lines 110-114)

**Source:** `src/app/soloEpisode.ts:62-64, 75-90, 104-114`.

### What is NOT persisted mid-episode

- Capsule inventory (active power-ups)
- Ball position/velocity
- Brick layout state
- Paddle position
- Lives remaining (reset to 3 on Continue, 3 on Restart)

**Evidence:** `SoloEpisode.snapshot()` delegates to `sim.snapshot()` (line 92-93), but no storage write occurs except via `recordSolo()` on round boundaries. The `RoundSim` snapshot includes all runtime state (players, balls, capsules, bricks), but only high score / highest round are extracted for storage.

### Test verification

`tests/app/soloEpisode.test.ts:122-131` — `recordSolo` persists `soloHighestRound` and `soloHighScore` after clearing rounds.

---

## 2. Settings Persistence

### Schema (StoredState)

`src/persistence/storage.ts:33-44` defines `StoredState`:

```typescript
interface StoredState {
  name: string;                    // settings.name
  skin: string | null;             // settings.skin
  theme: string | null;            // settings.theme
  bindingsKeyboard: string | null; // settings.bindings.keyboard
  bindingsGamepad: string | null;  // settings.bindings.gamepad
  audio: StoredAudio;              // settings.audio
  display: StoredDisplay;          // settings.display
  language: string | null;         // settings.language
  soloHighScore: number;           // solo.highScore
  soloHighestRound: number;        // solo.highestRound
}
```

**Keys:** `STORAGE_KEYS` (lines 4-15) — one localStorage key per field.

### Settings categories (loadSettings / saveSettings)

`src/ui/settings.ts:17-50` defines the typed settings surface:

```typescript
interface AudioSettings { music: number; sfx: number; mute: boolean; }
interface DisplaySettings { dprMode: "auto"|"2"|"1.5"|"1"; reducedEffects: boolean; }
interface AppearanceSettings { skinId: string; themeId: string; }
interface ControlsSettings { keyboard: KeyboardBindingsMap; gamepad: GamepadBindingsMap; }
type LanguageSetting = "auto" | Locale;
```

### Load path (loadSettings)

`src/ui/settings.ts:45-67` — `loadSettings(storage)`:
1. Calls `storage.loadAll()` → reads every key with defaults/validation
2. Audio: clamped to `[0,1]` via `clamp01` (storage.ts:131-133, 185-187)
3. Display: `dprMode` validated via `validDpr` (storage.ts:136, 189-191)
4. Appearance: `skinId`/`themeId` resolved against registry; unknown → defaults (lines 58-59)
5. Controls: `parseKeyboardBindings` / `parseGamepadBindings` — corrupt JSON → defaults (lines 62-63, bindings.ts:87-102, 131-141)
6. Language: `isLocale` guard; invalid → `"auto"` (line 65)

### Save path (saveSettings)

`src/ui/settings.ts:69-95` — `saveSettings(storage, partial)`:
1. Loads current settings
2. Deep-merges audio/display
3. Serializes controls via `serializeKeyboardBindings` / `serializeGamepadBindings` (lines 88-93, bindings.ts:104-106, 143-145)
4. Language: `"auto"` persisted as empty string (line 86)
5. Calls `storage.savePartial(patch)`

### Partial merge (savePartial)

`src/persistence/storage.ts:162-175` — `savePartial(partial)`:
- Loads full current state
- Shallow merge for top-level fields (undefined = unchanged)
- Deep merge for `audio` and `display` objects (lines 172-173)
- Writes full merged state via `writeAll`

### Defaults

`src/persistence/storage.ts:46-57` — `DEFAULTS`:
```typescript
{
  name: "Player 1",
  skin: null, theme: null,
  bindingsKeyboard: null, bindingsGamepad: null,
  audio: { music: 0.8, sfx: 0.8, mute: false },
  display: { dprMode: "auto", reducedEffects: false },
  language: null,
  soloHighScore: 0, soloHighestRound: 0
}
```

### Corruption resilience

- `readJSON` (storage.ts:100-110): `try/catch` → fallback
- `readNumber` (storage.ts:89-94): `Number()` + `isFinite` → fallback
- `parseKeyboardBindings` / `parseGamepadBindings` (bindings.ts:87-102, 131-141): corrupt JSON → defaults; corrupt entries → per-entry fallback
- `validDpr` / `clamp01` (storage.ts:185-191): invalid enum/number → default
- **Never throws** — spec §16 requirement

**Tests:** `tests/persistence/storage.test.ts:61-73` (corrupt audio/display/number), `175-183` (corrupt bindings).

---

## 3. Atomic Writes & Corruption Recovery

### Current implementation: NOT atomic

**Storage writes are independent localStorage `setItem` calls per key.**

`writeAll` (storage.ts:145-160) → calls `writeString` / `writeJSON` / `writeNumber` per key.
`savePartial` (storage.ts:162-175) → calls `writeAll` on merged state.

Each `writeString` (lines 81-87):
```typescript
writeString(key, value) {
  try { this.backend.setItem(key, value); } catch { /* degrade silently */ }
}
```

### Failure modes NOT handled

| Scenario | Current Behavior |
|----------|------------------|
| Power loss mid-write | Partial key updates — some keys new, some old |
| Browser crash mid-write | Same as above |
| Quota exceeded (`QuotaExceededError`) | Caught silently in `writeString` (line 84-86); no retry, no user notification |
| Cross-tab race | No locking; last write wins per key |

### No transaction / rollback / versioning

- No write-ahead log
- No shadow copy / double-buffer
- No schema version field in storage
- No migration logic

**Evidence:** `storage.ts` has no version field in `StoredState` (lines 33-44), no migration code, no atomic primitive.

### Recovery strategy (implicit)

- **Load-time validation**: every read validates + falls back to defaults (lines 73-79, 89-94, 100-110, 121-143)
- **Corrupt values never crash** — they become defaults
- **Partial corruption**: each key independent; one bad key doesn't poison others

**Test:** `tests/persistence/storage.test.ts:61-73` — corrupt audio/display/number all fall back independently.

---

## 4. Migration Strategy

### Current state: NONE

- No `schemaVersion` in `StoredState`
- No migration code in `Storage` class
- No versioned keys (e.g., `settings.v2.audio`)
- No backward-compatibility layer beyond per-field fallbacks

### Implicit backward compatibility

- New fields default via `DEFAULTS` (null/zero)
- Unknown enum values → default via validators (`validDpr`, `isLocale`)
- Unknown skin/theme IDs → registry default (settings.ts:58-59)
- Corrupt bindings → defaults (bindings.ts:87-102, 131-141)

### What would be needed for migration

1. Add `schemaVersion: number` to `StoredState` and `STORAGE_KEYS`
2. On `loadAll()`: detect version, run migrations sequentially
3. Provide migration functions per version bump
4. Consider dual-write during transition (old + new keys)

---

## 5. Cross-Device Sync (Future Considerations)

### Current architecture: Local-only

- `StorageBackend` interface (storage.ts:17-20) abstracts `getItem`/`setItem`
- Default backend = `globalThis.localStorage` (lines 63-70)
- Test backend = in-memory `Map` (tests/persistence/storage.test.ts:15-24)
- **No sync engine, no cloud backend, no conflict resolution**

### Integration points for future sync

| Layer | Current | Sync-ready? |
|-------|---------|-------------|
| Storage backend | Injectable `StorageBackend` | ✅ — swap for IndexedDB + sync adapter |
| Settings API | `loadSettings`/`saveSettings` pure functions | ✅ — stateless, testable |
| Episode progress | `recordSolo` called from `SoloEpisode` | ⚠️ — tied to `Storage` instance |
| Multiplayer | No local persistence (session-only) | N/A |

### Conflict resolution considerations

- Settings: last-write-wins per key (current `savePartial` semantics)
- Episode progress: `max(highScore)`, `max(highestRound)` — naturally mergeable
- Bindings: per-player maps; conflicts detectable via `findKeyboardConflicts` (bindings.ts:152-178)

### Recommended sync strategy (when needed)

1. **Backend**: Replace `localStorage` backend with IndexedDB + `BroadcastChannel` for cross-tab sync
2. **Schema**: Add `schemaVersion`, `lastModified` timestamps per key
3. **Merge**: CRDT-style for settings (per-field LWW); `max()` for scores
4. **Conflict UI**: Settings screen shows "synced from another device" banner

---

## Summary Matrix

| Aspect | Status | Location |
|--------|--------|----------|
| Episode progress (high score, highest round) | ✅ Persisted | storage.ts:13-14, 177-182 |
| Episode mid-run state (lives, capsules, bricks) | ❌ Not persisted | soloEpisode.ts:44-60 |
| Settings (audio, display, appearance, controls, language) | ✅ Persisted | settings.ts:17-50, storage.ts:33-44 |
| Atomic writes | ❌ Not implemented | storage.ts:81-87, 145-175 |
| Quota exceeded handling | ⚠️ Silent degrade | storage.ts:84-86 |
| Corruption recovery (load-time) | ✅ Per-field fallback | storage.ts:73-143 |
| Schema versioning | ❌ None | storage.ts:33-44 |
| Migration logic | ❌ None | — |
| Cross-device sync | ❌ Local-only | storage.ts:17-20, 63-70 |

---

## Recommendations (for ticket #80 implementation)

1. **Add schema version** — `schemaVersion: 1` in `StoredState`, migrate on load
2. **Atomic write** — write to temporary key(s), then single `rename` (localStorage limitation: no rename; use batch JSON blob under one key, or IndexedDB transaction)
3. **Quota handling** — catch `QuotaExceededError`, evict LRU (old snapshots?), notify user
4. **Episode checkpoint** — optional: persist full `SoloEpisode` state (round, score, lives, sim snapshot) on pause/background for resume-after-crash
5. **Sync-ready backend** — define `StorageBackend` with `getAll`/`setAll` atomic ops; implement IndexedDB + BroadcastChannel version