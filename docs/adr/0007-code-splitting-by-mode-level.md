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
  // NOTE: the specifier MUST stay a template literal *inside* getLevel.
  // Passing a computed path (roundFile(round)) to import() is invisible to
  // the bundler — it emits no round file at all and every level 404s in
  // production, with tests passing throughout.
  const mod = await import(`./levels/round-${String(round).padStart(3, '0')}.json`);
  const level = mod.default as LevelData;
  levelCache.set(round, level);
  return level;
}

// Keep sync `getLevelSync` for SSR/tests (throws if not cached)
export function getLevelSync(round: number): LevelData { ... }
```

**3. Lazy mode loading in session creators:**
```typescript
// src/app/hostGame.ts — the mode sim and its round range are fetched only
// when a match actually starts
async function buildModeSim(opts: HostGameOptions): Promise<ModeSim> {
  switch (opts.mode) {
    case "duel": {
      const { createRoundDuel } = await import("sim/duel");
      ...
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
- `manualChunks` must use the id-keyed **function** form, not the object form.
  See the measured outcome below: the object form emits empty facade chunks and
  pulls the session code into a preloaded colossus.

## As-built notes (ticket 95, 2026-10-09)

`manualChunks` as a plain `{ name: [paths] }` map does *not* cooperate with the
dynamic imports this ADR introduces. It compiles, but:

- every mode gets **two** chunks — an empty facade (35 B for mode-assist) plus a
  second chunk holding the real code, and
- `src/app/soloSession.ts` lands in `mode-solo`, which drags PixiJS into a
  690 kB chunk that `index.html` `<link rel="modulepreload">`s at boot — so the
  initial download *grew* (131 + 690 kB) even though the entry chunk shrank.

Switching to the id-keyed function form keeps the chunk boundaries the dynamic
imports already define. Measured on the production build:

| | before | after |
|---|---|---|
| entry chunk | 624.11 kB raw / 190.75 kB gzip | 557.82 kB raw / 168.55 kB gzip |
| mode chunks | none | 7 real `mode-*` chunks, 2.6–16.2 kB each |
| level data | 33 grids inside the entry | 33 lazily-fetched chunks, ~0.8 kB each |
| preloaded at boot | — | only `mode-bots` (16.2 kB) |

`mode-bots` is preloaded because `ui/versusBotsScreen` imports `sim/versusBots`
statically for `botCountFor` / `validateBotsSetup`; making that lazy too is a
follow-up, not part of this ADR.

## Alternatives Considered

- **No code splitting** — rejected: all modes bundled, mobile penalty
- **Split by feature (physics, render, net)** — rejected: modes are natural boundaries, features are shared
- **Dynamic import all sims** — rejected: over-splitting, more chunks = more requests
- **`manualChunks` object form** — rejected at implementation: empty facade chunks
  plus a preloaded 690 kB `mode-solo`, i.e. a bigger initial download.

## Validation

Perf audit (#78): "No code splitting configured in Vite. All 33 levels + modes + themes bundled together." This ADR addresses it directly.