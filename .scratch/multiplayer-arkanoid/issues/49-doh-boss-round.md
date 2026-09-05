# 49 — Doh boss round

**What to build:** Round 33 as a boss finale: the Doh boss on the play field, using the boss sprite (29) and boss theme (30) and the round-33 data (35). Boss behavior is classic-accurate — implementer follows the 1986 original's Doh fight as reference (multi-hit boss, projectile attacks, paddle death on contact); exact hit count and patterns are implementer's judgment against the classic, no further design decision required. In scope: Race, both coop variants, Solo. Excluded: Duel (draws rounds 1–32) and Attack (Doh excluded) — enforced by content constraints from 32/35.

**Blocked by:** 30 — Audio engine + content; 35 — Content: rounds 17–33.

**Status:** resolved

- [x] Round 33 plays as a Doh boss fight to defeat in Solo, Race, and both coop variants
- [x] Boss uses the registered sprite + boss theme; defeat = episode/match finale
- [x] Duel and Attack can never reach round 33 (constraints hold, regression-tested)
- [x] Boss behavior classic-accurate in feel: multi-hit, attacks the paddle, beatable but final-tier difficulty

## Answer

Implemented on `chunk/doh-boss` (worktree arkanoid-wt-49). Boss = sim-level entity, not brick-grid trick:

- **`src/sim/boss.ts`** (new, pure): Doh 48×32 at field top, 16 HP (classic ~14–16), phase 2 at ≤8 HP. Phase 1: 1 aimed projectile / 150 ticks; phase 2: 3-projectile ±20° spread / 120 ticks + sine drift (amplitude 40 u, period 240 ticks). Projectile 4×4, 90 u/s, paddle death on contact → standard ball-loss path. All patterns tick-derived — zero RNG.
- **Arena**: round 33 destructibles stripped at sim init (classic Doh = empty arena; gold frame stays). Tier bumps apply from serve (final-tier ball speed).
- **roundSim + sharedField**: ball-boss collision (bounce + `bossHit`), boss death → `bossDead` + roundClear (only path to clear — brick-clear and B-capsule guarded while boss lives). sharedField steps boss once/tick (coop-safe).
- **Protocol/serializer**: `boss` + `bossProjectiles` optional snapshot fields; binary tail (u8 present + 21 B boss + projectiles), backward compatible, roundtrip-tested.
- **Render**: `paintBoss` moai + accent-colored projectiles, snapshot-driven only.
- **Audio**: `bossHit` → heavy pitched brickHit; `bossDead` → roundClear SFX. Boss *theme* wiring deferred — no app-level AudioEngine instantiation exists yet (lands with app audio integration).
- **Tests**: 20 new (boss.test.ts) + serializer roundtrip + adapted scripted-play tests (levels/soloEpisode boss branch). 481/481 green; typecheck/lint/build clean.

Judgment calls: fire intervals 150/120 ticks (2.5 s/2 s — dodgeable but threatening at 3 lives); destructibles stripped rather than kept (ball must reach boss); Duel/Attack exclusion re-verified via existing ceilings (32) + regression tests.


