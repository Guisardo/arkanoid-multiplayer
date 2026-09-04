# 23 — Tracer bullet: Solo round playable

**What to build:** The first complete vertical cut: one authored round, playable end-to-end with the keyboard. A headless fixed-timestep (60 Hz) sim runs the round — box-overlap collision (edge contact counts), classic offset-deflect off the paddle, edge-contact clamp to ~60° up-and-away, single Vmax = 150 u/s paddle model, attach-and-launch serve, ball loss, round clear — a keyboard device adapter emits Input frames (binary ±1/0 axis, launch edge event), a PixiJS renderer consumes Snapshots (never sim internals), the rAF/accumulator loop drives it, a HUD strip shows name + lives + score + round, and every user-facing string comes from per-locale string tables (en-US + es-419) with a minimal BitmapText atlas covering Basic Latin + Latin-1 Supplement. Play field 208 × 256 logical units, letterboxed.

**Blocked by:** 22 — Repo scaffold + seam enforcement.

**Status:** resolved

- [x] A human can play one round to clear or ball loss using keyboard defaults (P1: ←/→ move, Space launch; solo: both keysets drive P1)
- [x] Sim is headless and deterministic: identical Input frame sequences produce identical outcomes (unit-tested)
- [x] Collision suite green in Vitest: box overlap incl. edge contact, offset-deflect, edge clamp
- [x] Renderer reads Snapshots only — no sim internals imported (lint rule from 22 holds)
- [x] Fixed 60 Hz sim + rAF accumulator loop; sim never drops ticks at normal frame rates
- [x] HUD strip renders above the field inside its region: name + color chip, lives icons, score, round indicator
- [x] Zero hardcoded user-facing strings; both locales complete for all shipped strings; BitmapText renders á é í ó ú ñ ü ¿ ¡
- [x] Field letterboxed at fixed logical 208 × 256, fractional scale, dpr capped at min(dpr, 2)

