# 31 — Content pipeline + rounds 1–16

**What to build:** The level authoring pipeline plus the first half of the classic content. Level JSON format: char grid 13 cols × 18 rows (exact dims verified during authoring) + metadata (capsule script, base ball speed, silver-hit override, scoring overrides); legend `.` empty, letters = brick colors, `S` silver, `G` gold; hand-editable. Content validation tests: grid dims, capsule script bounds (6–10 capsules, triggers ≤ brick count), scoring table completeness. Silver bricks multi-hit with `min(1 + floor(round / 8), 4)` hits; gold indestructible layout walls. Difficulty knobs: per-round base ball speed, in-level speed tier bumps at ≤15 and ≤8 bricks remaining. Classic-accurate scoring table authored (colored tiers ~50–120, silver pays per hit, gold 0, capsule catch bonus, level clear bonus). Rounds 1–16 authored and playable.

**Blocked by:** 23 — Tracer bullet: Solo round playable; 24 — Capsule system + capsule scripts.

**Status:** resolved

- [x] Level JSON schema validated in Vitest: dims, legend, metadata shape; invalid levels rejected with clear errors
- [x] Capsule script bounds enforced: 6–10 capsules, each trigger ≤ brick count
- [x] Silver hit formula `min(1 + floor(round / 8), 4)` unit-tested; gold indestructible
- [x] Speed tier bumps engage at ≤15 and ≤8 bricks remaining (unit-tested)
- [x] Scoring table complete and classic-accurate; Duel drop bonus 500 present
- [x] Rounds 1–16 authored, each playable start-to-clear with its capsule script
- [x] Grids hand-editable — a developer can tweak a level JSON and see it in-game without code changes

