# Perf validation — manual on-device checklist (ticket 54)

Reference device class (spec §12): entry Android 2026 tier —
**T606 / G85 / SD680 chipsets, Mali-G57 / Adreno 610 GPU, 3–4 GB RAM,
720×1600 @ 60 Hz**. Validate on a real device of this class (or the
slowest you can access) before each release.

The machinery (fallback ladder, budgets, instrumentation) is covered by
unit tests; the numbers below can only be measured on real hardware.

## Setup

1. Build + deploy (or `npm run preview` over the device's network).
2. Open the game with **`?perf=1`** — the dev overlay shows per frame:
   `fps`, `sim` (≤2 ms), `sync` (≤3 ms), `render` (≤5 ms), `total`
   (≤10 ms), `dpr`, `draw` (<20), `tex` (≤64 MB), `heap` (JS heap MB).
3. Test solo first, then a 2-field match (versus bots, Race, 2 fields =
   the worst local case), then a remote session (host device = worst
   case: sim + 3-guest serialization + render).

## Checklist

### Budgets (60 fps target)

- [ ] `fps` holds ≥55 in solo round 1 with a multiball active (M capsule).
- [ ] `fps` holds ≥55 in a 2-field versus-bots match, both fields busy.
- [ ] Host device in a 3-guest remote match holds ≥55 (sim + wire + render).
- [ ] `sim` ≤2 ms sustained (host with 3 guests is the stress case).
- [ ] `sync` ≤3 ms sustained.
- [ ] `render` ≤5 ms sustained.
- [ ] `total` ≤10 ms sustained; ≤8 ms preferred (thermal headroom).
- [ ] `draw` <20 per frame at full content (≤10 expected — one atlas,
      uniform blend; a number near 20 means batching broke).
- [ ] `tex` ≤64 MB (the shipped set is ~0.1 MB plus the cached field walls
      — anything larger means a texture leak or unbounded atlas growth).
- [ ] `heap` climbs monotonically across a long session without ever
      spiking (Chromium only; `?` where `performance.memory` is absent —
      Firefox/Safari). A sawtooth that never returns to baseline is a leak.
- [ ] A 20-minute continuous Attack match holds steady `heap`: the
      destroyed-brick history is capped at 500 entries, so it cannot grow
      without bound (ticket 102).

### Fallback ladder

- [ ] At dpr 2 the game holds 60 fps on the reference class in solo.
      If not, confirm the ladder steps down after ~0.75 s of slow frames
      (watch `dpr` in the overlay: 2 → 1.5 → 1).
- [ ] Stepping down never changes gameplay speed — the sim stays fixed
      60 Hz (ball physics identical; only sharpness changes).
- [ ] Sustained overload reaches the 30 fps rung: the explicit
      "Reduced performance mode" banner appears (never silent).
- [ ] The 30 fps rung also downscales the cached brick-wall texture to
      half resolution (a quarter of its bytes) — `tex` visibly drops when
      the rung engages, and rises back on recovery (ticket 102).
- [ ] 30 fps rung: every other rendered frame skipped, sim still 60 Hz
      (fast ball moves 2 sim ticks per frame — expected, playable floor).
- [ ] Recovery: when load drops, the ladder climbs back (lazy, ~4 s per
      rung) and the degraded banner clears.
- [ ] Two-field rendering NEVER collapses to one field at any rung —
      both fields stay visible through every step-down.

### Reduced effects (Settings → Display)

- [ ] Toggle on: owner-glow rings, silver crack overlays, and the
      background tile disappear; `render` ms drops measurably.
- [ ] Readability gate intact: owned balls still show the owner tint on
      the ball body (glow ring is the skipped layer, never the sole
      signal — spec §13).
- [ ] Toggle applies live (no reload) in solo and mid-match.

### Context loss (spec §3 contract)

- [ ] Chrome: `chrome://gpu` → "Kill" the GPU process mid-match (or
      device sleep/wake on Android). The game shows "Graphics context
      lost — recovering…", then "Graphics recovered" and the scene
      redraws from the latest snapshot — **no reload, no lost match**.
- [ ] After restore, bricks/HUD/score are correct (full redraw, not
      partial GPU state).

### Thermal soak (the ~8 ms headroom target)

- [ ] 20-minute continuous 2-field match on the reference device:
      fps stays ≥50 (30 fps rung acceptable if the banner shows);
      no crash, no context loss, no runaway `tex`.

## What is NOT manual

- Ladder step-down/recovery/hysteresis logic — unit-tested
  (`tests/app/perfLadder.test.ts`).
- Ladder texture resolution per rung (ticket 102) — unit-tested
  (`tests/app/perfLadder.test.ts`, `tests/render/brickLayerTextureResolution.test.ts`).
- Memory telemetry + the 64 MB ceiling (ticket 102) — unit-tested
  (`tests/app/memoryStats.test.ts`, `tests/app/perfOverlay.test.ts`).
- Destroyed-brick history cap (ticket 102) — unit-tested
  (`tests/sim/destroyedHistory.test.ts`).
- 30 fps rung keeps sim at fixed 60 Hz — unit-tested
  (`tests/app/loop.test.ts`).
- Budget constants + texture estimator + draw-call counter — unit-tested
  (`tests/app/frameStats.test.ts`).
- Reduced-effects reduces per-frame Graphics ops — unit-tested
  (`tests/render/fieldViewPerf.test.ts`).
- Two-field never collapses — unit-tested (`tests/render/splitScreen.test.ts`).
- Context-restore resync wiring — unit-tested
  (`tests/app/soloSession.test.ts`, `tests/app/mpFlowPerf.test.ts`).

## Automated gates (ticket 106)

What CI can prove without a reference device. Frame *times* stay on the manual
checklist above — SwiftShader and a dev machine say nothing about a Mali-G57.

| Budget | Gate | Measured (headless Chromium, SwiftShader) |
|---|---|---|
| Draw calls < 20 per rendered frame (<= 10 expected) | `e2e/perfBudget.spec.ts` counts every WebGL `draw*` call inside each `renderer.render()` | solo: 1-2 per frame; 4 split-screen fields: 4 per frame |
| Sim <= 2 ms per tick | `tests/perf/simBudget.test.ts` gates the **median** tick of 4 Attack fields and of a solo round | far below budget on a dev machine; this is a regression floor, not a device claim |
| Perf ladder: dpr 2 -> 1.5 -> 1 -> 30 fps, hysteresis 0.75 s down / 4 s up | `tests/app/perfLadder.test.ts` (transitions + hysteresis), `e2e/perfLadder.spec.ts` (resolution, banner, sim keeps ticking) | pass |
| Sim rate fixed 60 Hz at every rung | `e2e/perfLadder.spec.ts` ticks advance on the degraded rung; `tests/app/loop.test.ts` | pass |
| Texture memory <= 64 MB | `textureWithinBudget` is enforced at solo session start only (`soloSession`); the estimator lives in `app/frameStats` and feeds the `?perf=1` overlay in every session | estimate only — `?perf=1` shows it |

Not automated, on purpose: sim/sync/render **timings** and the 8 ms sustained
headroom (device-bound), and true GPU texture memory (WebGL exposes no
allocation counter; the overlay figure is an estimate).
