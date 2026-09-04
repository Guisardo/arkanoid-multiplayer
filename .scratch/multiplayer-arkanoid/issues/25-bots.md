# 25 — Bots

**What to build:** A Bot that plays the game: an AI input source that produces Input frames through the same host-local delay queue as a human player (D = 0, net module idle — one code path). One bot implementation, three parameter sets (Easy/Normal/Hard) as knobs, not separate logic: aim noise (±24/±8/±2 u), tracking engagement (lock onto descending ball at y > 0.65/0.40/0.25 × field height), launch timing (60–240 / ~97±30 / 40–120 ticks), meter-spend threshold (≥80 hoards / ≥30 / ≥20), fire chance per tick (0.2%/0.8%/1.5%), target quality (random/random/smart). Bots get auto-assigned distinct skins, never colliding with the human's choice. Demoable: a bot plays and clears a round on each difficulty.

**Blocked by:** 23 — Tracer bullet: Solo round playable.

**Status:** ready-for-agent

- [x] Bot plays a full round to clear or loss on each difficulty, visibly different in skill
- [x] Bot Input frames enter the same delay queue as human local players — no separate pipeline (verified: bot indistinguishable from a local player at the seam)
- [x] All six knobs from the spec table implemented as data-driven parameter sets
- [x] Hard bot targets smartly (Race leader; downed teammate first in assist) once those modes exist — random targeting acceptable until then
- [x] Bots auto-assigned distinct skins, never colliding with the human's choice
- [x] Bot behavior deterministic given the same game state sequence (unit-tested with fixed seeds/no RNG or seeded RNG)

