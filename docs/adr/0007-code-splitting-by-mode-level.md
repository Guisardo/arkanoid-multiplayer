# ADR 0007: Code Splitting by Mode and Level

**Status**: Accepted  
**Date**: 2026-09-30  
**Related**: #78, #104, #105

## Context

Current Vite config (`vite.config.ts`):
- **No code splitting configured** — no `manualChunks`, no dynamic import patterns
- Only 3 dynamic imports in codebase (all for `appShell`: `soloSession.ts:66`, `mpFlow.ts:675`, `main.ts:66`)
- All 33 level JSON files statically imported in `src/content/levels.ts`
- All game mode sims statically imported (`duel.ts`, `sharedField.ts`, `attackSession.ts`, `assistSession.ts`, `versusBots.ts`, `multiField.ts`)
- Estimated bundle: ~200-300 KB gzipped (PixiJS dominant)

Mobile/low-end devices download all modes + levels even if only playing Solo.

## Decision

Implement **route-level code splitting** by game mode and **lazy level loading**.

### Implementation

**1. Vite config — manual chunks for modes:**
```typescript
// vite.config.ts
build: {
  rollupOptions: {
    output: {
      manualChunks: {
        'mode-duel': ['src/sim/duel.ts'],
        'mode-sharedfield': ['src/sim/sharedField.ts'],
        'mode-attack': ['src/sim/attackSession.ts', 'src/sim/attack.ts'],
        'mode-assist': ['src/sim/assistSession.ts'],
        'mode-race': ['src/sim/multiField.ts'],
        'mode-bots': ['src/sim/versusBots.ts'],
        'mode-solo': ['src/sim/roundSim.ts', 'src/app/soloSession.ts'],
      }
    }
  }
}
```

**2. Lazy level loading in `src/content/levels.ts`:**
```typescript
// Replace static imports with dynamic:
const levelCache = new Map<number, LevelData>();

export async function getLevel(round: number): Promise<LevelData> {
  if (levelCache.has(round)) return levelCache.get(round)!;
  const mod = await import(`/content/levels/round-${String(round).padStart(3, '0')}.json`);
  const level = mod.default as LevelData;
  levelCache.set(round, level);
  return level;
}

// Keep sync `getLevelSync` for SSR/tests (throws if not cached)
export function getLevelSync(round: number): LevelData { ... }
```

**3. Lazy mode loading in session creators:**
```typescript
// src/app/mpFlow.ts - load mode sim only when needed
async function createDuelSession(...) {
  const { createDuelSession: create } = await import('sim/duel');
  return create(...);
}
```

**4. Update `availableRounds()`** — stays sync (returns 1..33 from static list)

## Consequences

**Positive:**
- Solo players don't download Duel/Attack/Assist code (~40 KB savings)
- Levels loaded on demand (only rounds played are fetched)
- Smaller initial bundle → faster startup
- Natural boundary for future DLC/expansion packs

**Negative:**
- `getLevel` becomes async — call sites must `await` (already async in session creators)
- Slight complexity in `levels.ts` (cache + async)
- Vite chunk manifest adds build output complexity

## Alternatives Considered

- **No code splitting** — rejected: all modes bundled, mobile penalty
- **Split by feature (physics, render, net)** — rejected: modes are natural boundaries, features are shared
- **Dynamic import all sims** — rejected: over-splitting, more chunks = more requests

## Validation

Perf audit (#78): "No code splitting configured in Vite. All 33 levels + modes + themes bundled together." This ADR addresses it directly.