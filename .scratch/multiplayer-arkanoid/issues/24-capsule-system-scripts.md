# 24 — Capsule system + capsule scripts

**What to build:** The full Capsule roster working in play: B (Break — fly through the exit = round clear, standard clear points, counts as clear in every respect), C (Catch), D (Disrupt), E (Expand), L (Laser), M (Multiball), P (Player — extra life), S (Slow), R (Reduce, negative), ? (Random). Capsules spawn at the just-broken brick's position, fall at 45 u/s, caught by box overlap with the paddle. Each level carries a deterministic capsule script — fixed count 6–10, fixed release order, each bound to a specific brick-break count, zero RNG; `?` resolves to the next undropped scripted capsule for that level, E fallback when the script is exhausted; scripts are player-opaque. Effect behaviors and durations are classic-accurate; effects clear on ball loss per classic rules. Multiball: only the last ball re-attaches to the paddle; other dropped balls are simply lost.

**Blocked by:** 23 — Tracer bullet: Solo round playable.

**Status:** resolved

- [x] All 10 capsules functional with classic-accurate behaviors and durations (values authored against the locked shape, marked data-only)
- [x] Capsule script determinism unit-tested: same play → same drops, zero RNG anywhere in the drop path
- [x] `?` resolves to next undropped scripted capsule; E fallback when script exhausted
- [x] B counts as clear in every respect: win condition, points, round progression
- [x] Multiball last-ball rule: only last ball re-attaches on drop; others lost with no life penalty beyond normal ball-loss rules
- [x] Capsules spawn at the just-broken brick's position; catch = box overlap with paddle
- [x] Effects clear on ball loss per classic rules (unit-tested)
- [x] R (Reduce) behaves as negative capsule — catchable, shrinks own paddle

