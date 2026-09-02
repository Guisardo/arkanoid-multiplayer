# Research: low-end Android performance targets

Type: research
Status: resolved

## Question

What performance targets does the spec mandate for low-end Android?

Establish: a reference minimum-spec Android device class for 2026 (chipset/RAM tier, e.g. Moto G-class); what PixiJS v8 WebGL rendering achieves on that class (community benchmarks, known mobile pitfalls: context loss, fill-rate, texture memory); a defensible fps floor (60 target / 30 floor?) and per-frame CPU+GPU budget for 1-2 play fields; whether the Canvas fallback (v8.16+) is viable as a floor or unsupported-class only.

Deliver: recommended performance targets (reference device, fps floor, frame budget, fallback policy) for the spec. Informs Split-screen rendering & layout and the final spec.

## Answer

- **Reference device:** entry Android — Cortex-A75+A55 class (UNISOC T606/T612/T616, Helio G85, Snapdragon 680), Mali-G57/Adreno 610 GPU, 3–4 GB RAM, 720×1600 HD+ 60 Hz panel (Moto G Play tier; UNISOC alone is 13% of AP shipments).
- **fps:** 60 target / 30 floor for the *render* loop; the fixed 60 Hz sim never drops (decoupled by the sim/render seam). 30 fps is an explicit degraded/thermal mode (skip alternate rAF frames), never a design target.
- **Frame budget:** ≤ 10 ms app work per 60 fps frame (web.dev standard) — sim tick ≤ 2 ms, snapshot→scene sync ≤ 3 ms, Pixi render ≤ 5 ms; design headroom to ~8 ms for thermal throttle. Gates: < 20 draw calls/frame (≤ 10 expected), ≤ 64 MB textures.
- **devicePixelRatio:** cap at `min(dpr, 2)`, step to 1.5/1.0 only when the floor is breached; ship `@0.5x` atlas; no advanced blend modes (broken at non-Po2 dpr, PixiJS #11311); `antialias: false`, `useContextAlpha: false`; BitmapText for per-frame text (context-restore bug #11685, HTMLText resolution bug #11790).
- **Canvas fallback (v8.16+):** unsupported-class-only — automatic when WebGL context creation fails, not a perf floor, not user-selectable; keep the scene in the renderer's "core use cases" (sprites, graphics, bitmap text, rect masks) and smoke-test `preference: 'canvas'` each release.
- **Context loss:** one WebGL context per device; treat `webglcontextrestored` as resync-from-snapshot (PixiJS auto-recovers the scene; BitmapText sidesteps the open text-restore bug).

Full findings and evidence: [../research/13-low-end-android-performance-targets.md](../research/13-low-end-android-performance-targets.md)
