# 54 — Perf: fallback ladder + budgets

**What to build:** Performance protection per spec §12: fallback ladder dpr 2 → 1.5 → 1.0 → 30 fps degraded (explicit degraded mode, never a design target); reduced-effects toggle; ≤10 ms app work/frame wiring (sim tick ≤2 ms, snapshot→scene sync ≤3 ms, Pixi render ≤5 ms; headroom to ~8 ms for thermal); <20 draw calls/frame (≤10 expected), ≤64 MB textures; sim fixed 60 Hz never drops; never collapse two-field rendering to one field. `webglcontextrestored` = resync-from-snapshot (contract from 22, now implemented). Entry-Android reference class: T606/G85/SD680, Mali-G57/Adreno 610, 3–4 GB RAM, 720×1600 60 Hz. On-device validation stays manual (human) — this ticket delivers the machinery + budget tests where automatable.

**Blocked by:** 29 — Skins/themes system + asset set; 42 — Touch overlay + mobile layouts; 45 — Remote play.

**Status:** ready-for-agent

- [ ] Fallback ladder steps down and recovers cleanly; 30 fps degraded mode explicit
- [ ] Reduced-effects toggle reduces per-frame work measurably
- [ ] Frame-budget instrumentation in place (sim/sync/render split visible in dev); budgets asserted in tests where automatable
- [ ] Draw calls <20 and textures ≤64 MB at full content (automatable check)
- [ ] Two-field rendering never collapses to one field under degradation
- [ ] `webglcontextrestored` resyncs from snapshot — context loss recovers without reload
- [ ] Manual on-device validation checklist documented for the human (reference device class)
