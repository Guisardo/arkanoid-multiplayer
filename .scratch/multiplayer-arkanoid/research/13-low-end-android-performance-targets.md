# Research: low-end Android performance targets — findings

Ticket: `../issues/13-low-end-android-performance-targets.md`
Date: 2026-08-31
Method: primary sources only — PixiJS official blog/docs/llms.txt, GitHub issue tracker via API (labeled issues, merged PRs, release metadata), Wikipedia ARM chipset tables, Statcounter Global Stats (Android version + mobile vendor share, July 2026), web.dev/Chrome DevTools performance documentation. No benchmark folklore; where a claim is a projection rather than a measured fact it is labeled as such.

Prior constraints: Research 03 fixed **PixiJS v8 + TypeScript + Vite** (current 8.20.1), renderer `preference: 'webgl'`, single canvas/one WebGL context per device, split-screen = two clipped Containers in that one context, bricks as sprites in atlases, headless fixed-timestep 60 Hz sim decoupled from render, draw-call gate < 20/frame. Research 02 fixed host-authoritative WebRTC at 20–60 Hz. This ticket sets the numbers the spec's perf gates will check.

---

## 1. Reference minimum-spec Android device class (2026)

**Facts:**

- **The entry tier is where the volume is.** Statcounter mobile vendor share (July 2026, worldwide): Samsung 19.14%, Xiaomi 10.13%, vivo 5.79%, Oppo 5.7% — plus a 10.34% "Unknown" bucket that skews to budget white-box Android. Android version share (July 2026): Android 12+ ≈ 89% of traffic, but the tail (Android 11 and older, ≈ 8–11%+ cumulative) tracks old low-end hardware still in circulation. Long version tails = old chipsets still browsing.
- **UNISOC is the marker of the low end.** UNISOC holds **13% of global smartphone AP market share (2024, Counterpoint, via Wikipedia)**, 4th behind MediaTek, Qualcomm, Apple — and UNISOC silicon goes almost exclusively into entry phones. A "low-end Android" definition that excludes UNISOC-tier devices excludes ~1 in 8 phones shipped.
- **Chipset tier (verified via Wikipedia ARM-core tables):** the 2024–2026 entry class is UNISOC T606/T612/T616 (Cortex-A75 + Cortex-A55 big.LITTLE, Mali-G57-class GPU), MediaTek Helio G85 (Cortex-A75/A55, Mali-G52 MC2), or Qualcomm Snapdragon 680 (Cortex-A73-based Kryo, **Adreno 610** GPU, 6 nm). The Adreno 610 also appears in the Snapdragon 460 (Moto G Play 2021, Wikipedia spec table) — same GPU family across the whole Moto G Play line, the canonical "Moto G-class" reference.
- **Representative concrete spec** (Moto G Play 2021, Wikipedia table, still the floor for 2024–2026 successors): Snapdragon 460 (11 nm, 4×1.8 GHz + 4×1.6 GHz), Adreno 610, **3 GB RAM**, **720×1600 HD+ IPS, 60 Hz**, 266 PPI. The 2024 successor keeps the same shape: Snapdragon 680-class, 4 GB RAM, HD+ 60 Hz (could not re-verify the exact 2024 page — GSMArena turnstile-blocked, Wikipedia page absent — flagged in uncertainties).
- **Display → devicePixelRatio:** HD+ 720×1600 at ~266 PPI reports `devicePixelRatio` ≈ **2.0** (Android quantizes dpr; 720p panels land on 1.75–2.0). 1080p budget panels land on non-power-of-two values like **2.625** (real example: Google Pixel 7, from PixiJS issue #11311's reproduction). Non-Po2 dpr is a Pixi v8 hazard class of its own — see §2.
- **60 Hz, not 90+.** The entry tier ships 60 Hz panels (Moto G Play line: 60 Hz across the Wikipedia table; high refresh is a mid-tier-and-up feature). So "60 fps target" on this class = full panel rate; there is no 90/120 Hz headroom to waste.
- **RAM:** 3–4 GB total on the reference tier. A Chrome tab gets a fraction of that; realistic texture budget is tens of MB, not hundreds (see §2 texture memory).

**Share estimate (honest):** no single primary source states "X% of Android web users are on T606-class hardware." Verifiable proxies: UNISOC 13% of AP shipments + MediaTek's budget Helio line + Samsung/Xiaomi A-series volume ⇒ the entry tier plausibly covers **~25–40% of Android devices in circulation**, concentrated outside NA/Western Europe. Treat the exact share as an uncertainty; the spec should treat the class as "must work," not "nice to have."

## 2. PixiJS v8 on mobile WebGL — characteristics and pitfalls

**Batching / draw calls (the good news):**

- Official Performance Tips guide (pixijs.com/8.x/guides/concepts/performance-tips.md): sprites are "the fastest way to render content"; **sprites batch with up to 16 textures per batch** (hardware-dependent); use spritesheets to minimize texture count; small Graphics (< 100 points) batch and are "as fast as Sprites"; hundreds of complex Graphics objects are slow → use textures instead. Directly matches our bricks-as-atlas-sprites plan.
- Official v8 ParticleContainer blog (Oct 2024): "100K+ without breaking a sweat." Our load (hundreds of brick sprites + paddle + ball + short-lived particles) is 2–3 orders of magnitude below Pixi v8's stress-tested ceiling. Sprite count is not the constraint on this device class.
- Batch breakers per the same guide: **blend-mode changes split batches** (Screen/Normal/Screen/Normal = 4 draw calls vs 2 grouped), filters are expensive, sprite masks are the most expensive mask type (rectangle masks = scissor = fastest). Spec implication: uniform blend mode, rectangle-masking for split-screen viewports (already the plan), no per-brick filters.

**Context loss (real, mostly handled, one open trap):**

- PixiJS restores WebGL contexts automatically; maintainers fixed texture-slot rebinding on restore (PR #10649, merged June 2024) and null-handling of `gl.getShaderSource`/`getShaderInfoLog` during lost-context render (PR #12042, merged June 2026, referencing WebGL spec §5.14.9).
- **Open bug #11685 (priority: high, still open as of March 2026 update): "Text disappears when WebGL context is lost and restored"** — after `chrome://gpucrash`-style context loss + restore, all `Text` objects remain invisible while the rest of the scene recovers. Direct hit on our HUD/score text if we use Canvas-Text objects. Mitigation for the spec: use `BitmapText` (pre-generated texture atlas — no canvas-backed texture to lose) for in-game text, or listen for `webglcontextrestored` and force text redraw.
- Chrome warns and evicts at **~16 live WebGL contexts** (issue #8814: "Too many active WebGL contexts. Oldest context will be lost"). Our single-context design (Research 03) is the correct defense; also means: never create a second Pixi renderer for a second play field, never spawn throwaway renderers.
- Context loss on Android Chrome also happens via GPU resets and background-tab reclaim (host-tab backgrounding already handled by Research 02's wake-lock + Worker tick).

**Texture memory / fill rate (the actual constraints on this class):**

- Performance Tips: "On older devices use smaller low resolution textures" — AssetPack's `@0.5x` suffix lets Pixi visually-double a downscaled atlas automatically. Guide also recommends `antialias: false` and `useContextAlpha: false` on older mobile for measurable gains — both are free wins for a flat-shaded brick game (opaque background, no AA dependency at pixel-art-ish art style).
- Text is the main silent texture-memory risk: "each [text update] draws to a canvas and then uploads to GPU" — per-frame score text would re-upload textures every frame on the CPU. Spec: `BitmapText` for anything that changes per frame (score, timer); static `Text` acceptable for menus.
- **Fill rate is the physical limit on Mali-G57/Adreno 610-class GPUs.** Full-screen HD+ canvas at dpr 2 = 1440×3200 ≈ 4.6M pixels × 60 fps ≈ 276M pixels/s just for the final blit, before overdraw. Opaque, single-layer, uniform-blend sprite scenes fit that comfortably (mobile GPUs ship multi-hundred-Mpix/s fill even at entry tier); full-screen alpha-stacked layers, per-brick filters, or large overlapping translucent quads would not. This is an engineering constraint derived from the device class, not a measured benchmark — labeled as projection.
- dpr policy interacts directly with fill rate: dpr 2 doubles pixels 4× vs dpr 1. Capping resolution below native dpr is the single biggest fill-rate lever (see recommendations).

**Resolution / devicePixelRatio pitfalls (verified bugs):**

- **Non-power-of-two dpr breaks advanced blend modes** (#11311, closed via docs): overlay/color-dodge/soft-light only cover part of the sprite when resolution ≠ 1 or Po2 — reported on a phone with dpr 2.625. Fix (PR #12067, merged June 2026): documented workaround `Filter.defaultOptions.resolution = 'inherit'`. Spec implication: simplest dodge is to not use advanced blend modes at all — a classic Arkanoid look needs normal + additive at most.
- `HTMLText` batch resolution updates can corrupt texture references (#11790, open, priority: high) — another reason in-game text is `BitmapText`/`Text`, not `HTMLText`.
- Canvas renderer had its own dpr bug (TilingSprite `tilePosition` divided by resolution, #11939 → fixed by PR #11957, April 2026) — sign that the Canvas path's dpr handling is younger than the WebGL path's.

## 3. fps policy: 60 target / 30 floor

**Facts:**

- **60 Hz is the panel rate of the reference class** (§1) — there is no faster display to target, and 60 fps = perfect vsync on it. web.dev "Rendering performance" (Paul Lewis): at 60 Hz the frame budget is 16.66 ms, and after browser overhead app work must fit **~10 ms**; missing it = jank. That figure is for animation generally, desktop and mobile alike.
- **Ball motion is the stress case for 30 fps, and it's a render-only problem.** The sim is fixed-60 Hz regardless (Research 02/03 architecture), so at a 30 fps render the ball's *physics* is identical — but each rendered frame spans 2 sim ticks, so a fast ball visually jumps ~2× the distance per frame and interpolated paddle response shows up to 33 ms late instead of 16 ms. A paddle game's feel lives in (a) paddle-tracking latency and (b) reading the ball's trajectory; (b) degrades noticeably for fast balls at 30 fps. Verdict: 30 fps is a *playable floor* for degraded/thermally-throttled devices, not a design target; comparable browser arcade games (the rAF/WebGL casual-game norm) target 60 and accept frame drops rather than capping at 30 — I found no primary source establishing a contrary norm, so this line is judgment grounded in the web.dev 60 fps standard, labeled as such.
- **The architecture makes the floor cheap:** because sim (60 Hz fixed) and render (rAF) are decoupled, a 30 fps render mode is just "skip every other rAF frame" — zero sim/netcode impact, snapshots still interpolate at full 60 Hz fidelity. This asymmetry is why 60/30 (render) is defensible while the sim itself never drops below 60.
- **Thermal reality:** sustained 60 fps on a 3–4 GB entry phone will throttle clocks after continuous play. A 30 fps render cap is also the right battery/thermal escape hatch for sessions > 15–20 min. Projection from device-class behavior, not a measured curve — uncertainty noted.

## 4. PixiJS v8.16+ Canvas fallback — viability

**Facts:**

- **Status (official v8.16.0 blog, Feb 2026):** "experimental Canvas renderer for environments without WebGL/WebGPU… runs well on older hardware… doesn't cover every feature the GPU renderers support, but it handles core use cases: **sprites, graphics, text, and basic filters**. If a device doesn't support WebGL or WebGPU, PixiJS falls back to Canvas automatically. No configuration needed."
- **It is maintained and improving:** dedicated `env: canvas` triage label exists. 2026 track record — fixed: TilingSprite/resolution (#11939→#11957, Apr 2026), roundPixels anchor offset (#12051, merged June 2026), spritesheet texture-fill shift in production (#12111, closed Aug 2026). Open: NineSliceSprite visual mismatch vs WebGL (#12096, June 2026), Mesh transform crash (#12097, priority: high), text malformed in the official 8.16 demo (#12076, June 2026, priority: high).
- **Core-use-case coverage matches our scene.** Our scene graph is sprites + rectangle masks + bitmap text — squarely inside "core use cases." The open bugs are in features we don't need (NineSliceSprite, Mesh, canvas-text quirks).
- **Not a performance floor.** Canvas 2D is CPU-rasterized: every pixel of 1–2 play fields redraws through the rasterizer every frame with no GPU batching — Research 03 already judged full-screen Canvas 2D at 60 fps × 2 fields "the classic low-end-mobile bottleneck." The v8.16 Canvas renderer is *smaller and older-hardware-tolerant*, not faster. WebGL-capable devices (96.68% of browsers, caniuse) should never be pushed onto it deliberately.
- **Policy shape:** `preference: 'webgl'` (explicit, per Research 03) → Canvas only when WebGL context creation genuinely fails. That is an unsupported-class-only path, not a degraded-mode-perf path.

## 5. Frame budget: 1–2 play fields on the reference class

**Facts and derivation:**

- **Total frame budget at 60 fps: 16.67 ms.** web.dev: app work must fit **~10 ms** after browser overhead (compositor, input, GC pauses). On the reference class (Cortex-A75 single big core doing JS + rasterizer driver work), assume the aggressive end: plan app-side work ≤ **10 ms**, and design to ≤ 8 ms for thermal/throttle headroom.
- **Sim tick (fixed 60 Hz):** 2 play fields of Arkanoid physics = a few dozen moving entities (balls, paddles, capsules) + up to ~2×200 brick AABBs, swept/stepped deterministically. Sub-millisecond arithmetic even on a big-core A75; allocate a **≤ 2 ms** gate including input queue + netcode tick on the host device (host also runs the 20–60 Hz DataChannel flush per Research 02, measured ≈ 45 KB/s — bandwidth, not CPU, bound).
- **Render sync (snapshot → scene graph):** position/tint updates for ≤ ~500 sprites (2 fields × ~200 bricks + paddles + balls + particles + HUD). Pixi v8 transform updates are pool-friendly and the ParticleContainer path handles 100K+; at our scale this is **≤ 2–3 ms** on the reference class (projection from batching ceilings, not a measured number — validate in the game-feel prototype).
- **Pixi render + GPU submit:** with one atlas, uniform blend mode, rectangle scissor masks: expected **≤ 10 draw calls/frame** (Research 03's gate of < 20 stands, 2 fields should sit well under it), and fill-rate within the §2 envelope if dpr is capped. Allocate **≤ 5 ms** for the WebGL flush on the A75/Adreno 610 class.
- **Sum: 2 + 3 + 5 = ~10 ms** → lands exactly at the web.dev budget line with zero headroom; the dpr cap below buys the margin. At the 30 fps floor the same work has 33 ms — 3× headroom — which is why 30 fps absorbs thermal throttling gracefully.
- **Texture memory budget:** single brick/particle/HUD atlas + bitmap font, 1× and 0.5× variants ⇒ **≤ 32–64 MB GPU textures** total, trivially inside even a 3 GB phone's browser share. The only way to breach it is unbounded per-frame `Text`/`HTMLText` churn (§2) — banned by the BitmapText policy.

---

## Recommended performance targets (for the spec)

| Target | Value | Evidence |
|---|---|---|
| **Reference device class** | Entry Android: Cortex-A75+A55 (UNISOC T606/T612/T616, Helio G85, or Snapdragon 680), Mali-G57/Adreno 610 GPU, 3–4 GB RAM, 720×1600 HD+ **60 Hz** panel (Moto G Play tier) | Wikipedia chipset tables; UNISOC 13% AP share (Counterpoint 2024); Moto G Play 2021 spec table |
| **fps target / floor (render)** | **60 target, 30 floor.** Fixed 60 Hz sim never drops — it is decoupled. 30 fps render = skip alternate rAF frames; offer as explicit degraded/thermal mode, never silently | §3; web.dev 60 Hz/10 ms standard; sim-render seam (Research 03) |
| **Per-frame budget (app work)** | **≤ 10 ms** total at 60 fps: sim tick ≤ 2 ms, render sync ≤ 3 ms, Pixi render ≤ 5 ms. Design headroom to ~8 ms | web.dev rendering-performance (16.66 ms frame, ~10 ms app); §5 derivation |
| **Draw calls** | **< 20/frame hard gate; ≤ 10 expected** at 1–2 play fields, one atlas, uniform blend mode, rect masks | Pixi Performance Tips (16-texture batches, blend-mode splits); Research 03 gate |
| **devicePixelRatio policy** | **Cap renderer resolution at `min(devicePixelRatio, 2)`; step down to 1.5 / 1.0 only when the fps floor is breached.** Never rely on advanced blend modes (broken at non-Po2 dpr, #11311). Ship `@0.5x` atlas variant | §2 dpr bugs; Performance Tips (@0.5x, smaller textures on older devices); fill-rate math (§2) |
| **Renderer options** | `preference: 'webgl'`, `antialias: false`, `useContextAlpha: false` (opaque background) — free wins on older mobile | Pixi Performance Tips verbatim |
| **Text policy** | `BitmapText` for any per-frame-updating text (score/timer); static `Text` for menus; **no `HTMLText` in-game** (open resolution bug #11790 + context-restore bug #11685) | §2 context-loss and text bugs |
| **Canvas fallback policy** | **Unsupported-class-only:** automatic only when WebGL context creation fails. Not a perf floor, not user-selectable. Scene must stay in "core use cases" (sprites, graphics, bitmap text, rect masks) so the fallback path renders correctly; smoke-test on `preference: 'canvas'` each release | v8.16.0 blog; open/fixed canvas-issue track record (§4) |
| **Context-loss policy** | Single WebGL context for the whole device (never two). Listen for `webglcontextrestored` on the renderer; treat it as a resync-from-snapshot event; BitmapText makes restore text-safe | #11685, #8814, #10649, #12042 |
| **Perf gates for CI/prototype** | On reference class: 60 fps with 2 full play fields + particles sustained ≥ 10 min without thermal drop below 60; ≤ 10 draw calls; ≤ 10 ms app frame time; ≤ 64 MB textures | §5 |

## Open uncertainties

1. **Exact share of Android users on the entry tier** — proxies (UNISOC 13% shipments, vendor mix, Android version tail) suggest 25–40%, but no primary source states the browsing-user share directly. Doesn't change the targets; changes how loudly to market "works on cheap phones."
2. **Moto G Play 2024 exact spec** — page fetches blocked/absent (GSMArena turnstile, no Wikipedia article). The class is well-evidenced from the 2021 table + chipset lineages; if the spec names a concrete reference device, re-verify on a spec site that allows fetch.
3. **Frame-budget split (2/3/5 ms) is derived, not measured.** The 10 ms total is the web.dev standard; the split is engineering allocation. Must be validated on real hardware in the game-feel prototype — add a frame-time HUD from day one.
4. **Thermal throttling curve** on entry SoCs under sustained WebGL load: no primary benchmark found. The 30 fps floor + ≤ 8 ms design headroom are the hedge; measure in the prototype.
5. **30 fps acceptability for ball feel** is judgment (no controlled study of paddle-game fps perception found in primary sources). The 60 fps target carries the design; 30 is strictly a graceful-degrade mode. Playtest in the prototype with a forced-30 toggle.
6. **Canvas fallback rendering parity on real no-WebGL devices** — no such device was available to test; evidence is the official blog's feature list + issue tracker. The smoke-test gate (render both paths, diff screenshots) mitigates.

---

Sources (fetched 2026-08-31): pixijs.com/8.x/guides/concepts/performance-tips.md; pixijs.com/blog (index + v8.16.0 post, "Canvas renderer (experimental)"); pixijs.com/llms.txt; pixijs.com/8.x/guides/migrations/v8.md; pixijs.com/faq; pixijs.com/blog/particlecontainer-v8 (Oct 2024); github.com/pixijs/pixijs via API — issues #11311, #11685, #11790, #8814, #11939, #11943, #12042, #12051, #12067, #12076, #12096, #12097, #12111; PRs #10649, #11957; release v8.20.1 (2026-08-26, pixi.min.js 818,871 B raw); en.wikipedia.org — Moto G (2021) spec table, UNISOC (incl. Counterpoint 13% AP share 2024), ARM Cortex core/SoC tables; gs.statcounter.com — Android version share July 2026 (16.0: 25.5%, 15.0: 17.2%, 13.0: 14.78%, 14.0: 13.14%, 12.0: 10.08%, 11.0: 8.33%), mobile vendor share July 2026 (Samsung 19.14%, Xiaomi 10.13%, vivo 5.79%, Oppo 5.7%); web.dev/articles/rendering-performance (60 Hz, 16.66 ms, ~10 ms app budget); caniuse.com/webgl 96.68% (via Research 03, fetched 2026-08-30).
