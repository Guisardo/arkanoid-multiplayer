# 39 — Attack mode

**What to build:** Race with interference: all Race win conditions and structure (from 34), plus the attack economy. Triggers (each lobby-toggleable, all-on default): chains (N consecutive bricks without paddle touch — bigger = stronger), capsule capture (small attack), level clear (continuous structure only), charged manual (shared attack meter, filled by brick breaks — 2 per brick + 10 per capsule catch — each button fires a different attack type at a manually picked target). Effects: brick rain (scaled by trigger: 3/6/12 by chain tier), paddle shrink (40%, 10 s), ball speed up (+30%, 8 s), control mangle (6 s, sim-side input corruption — invert/jitter the consumed axis per tick, hits every input method equally). Stacking: same-type refreshes duration, different types independent. Mid-level-reset targets immune; manual attacks auto-retarget. Meter costs (of 100): rain 30, shrink 25, speed 20, mangle 40. Chain tiers: ≥4 / ≥7 / ≥10 bricks = small / medium / large. Targeting: cycle target + fire-type buttons (4 attack buttons), target display in HUD strip (name + color chip, cycle flash).

**Blocked by:** 34 — Race mode, local split-screen.

**Status:** resolved

- [x] All four triggers fire correctly; each lobby-toggleable; all-on default
- [x] All four effects work with spec magnitudes/durations; economy defaults live-tunable
- [x] Chain tiers ≥4/≥7/≥10 → small/medium/large rain (unit-tested)
- [x] Meter fill 2/brick + 10/capsule; costs 30/25/20/40 enforced
- [x] Stacking rules: same-type refresh, different-type independent (unit-tested)
- [x] Control mangle corrupts the consumed axis sim-side — keyboard/mouse/gamepad/touch hit equally
- [x] Mid-level-reset targets immune; manual attacks auto-retarget
- [x] Target cycle + 4 fire buttons work on all input methods; HUD target display + cycle flash

