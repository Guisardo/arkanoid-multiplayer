# 54 — Perf: fallback ladder + budgets

**What to build:** Performance protection per spec §12: fallback ladder dpr 2 → 1.5 → 1.0 → 30 fps degraded (explicit degraded mode, never a design target); reduced-effects toggle; ≤10 ms app work/frame wiring (sim tick ≤2 ms, snapshot→scene sync ≤3 ms, Pixi render ≤5 ms; headroom to ~8 ms for thermal); <20 draw calls/frame (≤10 expected), ≤64 MB textures; sim fixed 60 Hz never drops; never collapse two-field rendering to one field. `webglcontextrestored` = resync-from-snapshot (contract from 22, now implemented). Entry-Android reference class: T606/G85/SD680, Mali-G57/Adreno 610, 3–4 GB RAM, 720×1600 60 Hz. On-device validation stays manual (human) — this ticket delivers the machinery + budget tests where automatable.

**Blocked by:** 29 — Skins/themes system + asset set; 42 — Touch overlay + mobile layouts; 45 — Remote play.

**Status:** resolved

- [x] Fallback ladder steps down and recovers cleanly; 30 fps degraded mode explicit
- [x] Reduced-effects toggle reduces per-frame work measurably
- [x] Frame-budget instrumentation in place (sim/sync/render split visible in dev); budgets asserted in tests where automatable
- [x] Draw calls <20 and textures ≤64 MB at full content (automatable check)
- [x] Two-field rendering never collapses to one field under degradation
- [x] `webglcontextrestored` resyncs from snapshot — context loss recovers without reload
- [x] Manual on-device validation checklist documented for the human (reference device class)

## Answer

Implemented on `chunk/perf-ladder`:

- **Ladder** (`src/app/perfLadder.ts`, pure): rungs dpr 2 → 1.5 → 1.0 → 30 fps degraded (`renderEvery: 2`). Step-down after 45 consecutive slow frames (≥20 ms app work), lazy recovery after 240 fast frames (≤15.4 ms) — hysteresis both directions, no oscillation. Degraded rung is explicit (banner), never a design target. Settings dpr mode pins the start rung (`rungForDprMode`); ladder may step down from it and recovers toward it, never above.
- **Instrumentation** (`src/app/frameStats.ts`, pure): rolling window averages/worst/fps + budget verdicts (sim ≤2, sync ≤3, render ≤5, total ≤10, headroom 8); texture-bytes estimator (shipped set ~0.1 MB ≪ 64 MB, asserted); draw-call counter wrapping drawArrays/drawElements(+instanced) for dev wiring. Loop (`src/app/loop.ts`) measures sim/render per frame (`onFrameStats`), sessions measure the sync split.
- **30 fps degraded mode**: `loop.setRenderEvery(2)` skips alternate renders; sim stays fixed 60 Hz (accumulator runs 2 ticks per frame — regression-tested). Composes with 47's timeScale slow-motion.
- **Reduced effects** (Settings Display, live): skips owner-glow rings, silver crack overlays, background tile — measurably fewer painter calls (mock-counted tests); ball body keeps owner tint (readability gate preserved, spec §13).
- **Context loss/restore** (`src/render/appShell.ts`): native canvas listeners; Pixi re-uploads GPU state itself; app invalidates field caches (`FieldView.invalidate()` clears brick/HUD caches → full redraw from latest snapshot), guests additionally `resyncFromSnapshot`. Banners both ways (localized).
- **Runtime resolution** (Pixi v8 source-verified): `renderer.resolution = n` — live dpr step-down, no re-init; asset textures untouched.
- **Wiring**: soloSession + mpFlow (host + guest loops) feed stats → ladder → `applyLadderRung` (setResolution + setRenderEvery + degraded banner); dev perf overlay behind `?perf=1` (fps/sim/sync/render/total/dpr/draw/tex); Display settings apply live on overlay close.
- **Manual checklist**: `docs/perf-validation.md` — reference device class (T606/G85/SD680, Mali-G57/Adreno 610), budgets, ladder, thermal soak, context-loss procedure.
- Tests: 49 new (872 total green) — ladder (11), frameStats (14), loop renderEvery/stats (6), fieldView reduced/invalidate (3), splitScreen perf (3), perfOverlay (5), mpFlowPerf (4), soloSession perf (3). Lint, typecheck, 4 e2e, build green.


