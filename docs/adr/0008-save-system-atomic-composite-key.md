# ADR 0008: Save System — Atomic Composite Key with Schema Versioning

**Status**: Accepted  
**Date**: 2026-09-30  
**Related**: #80, #111, #112

## Context

Current save system (`src/persistence/storage.ts`):
- **11 independent `localStorage.setItem` calls** in `writeAll()` — no atomicity
- Crash/power loss mid-write → inconsistent state (some keys updated, others stale)
- QuotaExceeded/SecurityError silently ignored — key not written
- **No schema version field** — cannot detect/migrate schema changes
- Read-side coercion only (missing/invalid → defaults) — "accidental backward compatibility"
- Breaking changes (renamed keys, structural binding changes) lose user data
- No cross-device sync primitives (timestamps, device ID, conflict resolution)

Settings schema (`StoredState`) is complete and stable, but persistence layer is fragile.

## Decision

Migrate to **single atomic composite key** with **explicit schema versioning** and **migration pipeline**.

### Implementation

**1. Composite key structure:**
```typescript
// Key: 'arkanoid.save.v1'
interface SaveDocument {
  schemaVersion: 1;           // increment on breaking changes
  updatedAt: number;          // epoch ms, for sync conflict resolution
  deviceId: string;           // generated once, stored
  settings: StoredSettings;   // audio, display, appearance, controls, language, name
  solo: SoloProgress;         // highScore, highestRound
  soloEpisode?: EpisodeState; // optional: mid-episode resume (round, score, lives, phase, timestamp)
}
```

**2. Atomic write:**
```typescript
function writeAll(state: SaveDocument): void {
  const json = JSON.stringify(state);
  try {
    backend.setItem(COMPOSITE_KEY, json);
    // On success, clean up legacy per-key entries
    LEGACY_KEYS.forEach(k => backend.removeItem(k));
  } catch (e) {
    // Log error, do NOT partially write legacy keys
    throw e; // or queue for retry
  }
}
```

**3. Read with migration:**
```typescript
function loadAll(): SaveDocument {
  // Try composite key first
  const composite = backend.getItem(COMPOSITE_KEY);
  if (composite) {
    const doc = JSON.parse(composite);
    return migrate(doc.schemaVersion, doc);
  }
  // Fallback: migrate from legacy per-key layout
  return migrateFromLegacy();
}
```

**4. Migration pipeline:**
```typescript
function migrate(version: number, doc: unknown): SaveDocument {
  switch (version) {
    case 1: return doc as SaveDocument; // current
    // case 2: return migrateV1toV2(doc);
    default: throw new Error(`Unknown save schema version: ${version}`);
  }
}

function migrateFromLegacy(): SaveDocument {
  // Read all legacy keys, coerce, write composite, return
}
```

**5. Episode resume (optional, #113):**
```typescript
interface EpisodeState {
  round: number;
  score: number;
  lives: number;
  phase: 'playing' | 'gameOver' | 'episodeComplete';
  timestamp: number; // for expiry (e.g., 24h)
}
```
Save on: round clear, game over, pause, periodic (30s). Load on `createSoloEpisode` if timestamp recent.

**6. Sync readiness (#114):**
- `updatedAt` per document (or per category) for last-write-wins
- `deviceId` for conflict detection
- `StorageBackend` abstraction already supports swap (localStorage → IndexedDB + sync engine)

## Consequences

**Positive:**
- **Atomic**: single `setItem` = all-or-nothing
- **Versioned**: explicit migration path for future schema changes
- **Sync-ready**: timestamps + device ID + composite document
- **Clean**: legacy keys removed after successful migration
- **Episode resume**: mid-episode state recoverable (optional)

**Negative:**
- Larger single write (but < 10 KB, well under quota)
- Migration logic must be maintained
- `loadAll` now async if migration needed (currently sync — wrap in Promise)

## Alternatives Considered

- **Keep per-key + add version field per key** — rejected: still non-atomic, version drift possible
- **IndexedDB transactions** — rejected: overkill for < 10 KB, localStorage simpler
- **No episode resume** — rejected: low effort, high UX value (continue after reload)

## Validation

Save audit (#80): "Atomic writes absent (11 independent calls). No migration system. Cross-device sync not designed." This ADR addresses all three.