# Research: browser stack options — findings

Ticket: `../issues/03-browser-stack-options.md`
Date: 2026-08-30
Method: primary sources only — GitHub repo APIs (release metadata, source trees, READMEs, changelogs), npm registry (dist-tags, package metadata), jsdelivr CDN builds (measured gzip), caniuse.com (Gamepad API, WebGL), official library blogs/docs. No benchmark folklore; where a claim is qualitative it is labeled as such.

Prior constraints: Research 01 (base survey) resolved **build from scratch**, so stacks are compared fresh, on merits. Research 02 (WebRTC) fixed the netcode shape: **host-authoritative star over RTCDataChannel**, which requires a **headless deterministic fixed-timestep simulation cleanly separated from rendering** from day one. This ticket picks what sits on the *render* side of that seam.

---

## 1. Requirements recap

From the map and prior tickets:

1. **Targets:** PC/Mac/Android web browsers — Chrome, Firefox, Safari, Android Chrome. 60 fps.
2. **Render load:** 1–2 play fields per device (split-screen; max 2 local players), on **low-end Android phones**.
3. **Input:** keyboard, mouse, Gamepad API, touch.
4. **Architecture:** headless deterministic fixed-timestep sim, host-authoritative, synced over WebRTC DataChannels. The rendering layer must consume sim state without owning it (no engine physics/scene lifecycle entanglement).
5. **Free tooling, agent-driven DX:** Vite-style dev server, TypeScript, good scaffolding.

## 2. Verified shared facts (apply to all options)

- **Gamepad API (caniuse.com/gamepad, fetched 2026-08-30):** supported in Chrome 21+, Edge 12+, Firefox 29+, Safari 10.1+, Chrome for Android, Firefox for Android, Samsung Internet. Global 96.37%. No target browser lacks it. Wrapping it is trivially possible with raw `navigator.getGamepads()` polling — no engine required.
- **WebGL (caniuse.com/webgl, fetched 2026-08-30):** supported in all target browsers (Chrome 8+, Firefox 4+, Safari 5.1+/8+ for reliable, Chrome Android, Samsung Internet). Global 96.68%. Caveat on the page: "WebGL support is dependent on GPU support" — driver blacklists exist but are rare on current Android Chrome. WebGL-first is a safe baseline; a Canvas fallback is cheap insurance, not a hard requirement.
- **Two play fields ≠ two canvases.** All three options can render both fields into one canvas/context (viewports, cameras, or clipped containers). Two separate WebGL contexts would double driver state and memory on low-end Android — avoid regardless of stack. The real differences are *how much per-pixel/per-sprite work each option does* and *whether split-screen composition is a first-class concept*.

## 3. Option A — Plain Canvas 2D (no engine)

**Facts:**

- **Renderer:** single `CanvasRenderingContext2D`, CPU rasterized. No dependency, zero KB. Compositing and fill-rate are the CPU/GPU's rasterizer work — every pixel of two play fields re-rasterized every frame at 60 fps.
- **Split-screen:** manual. `ctx.save() → clip() → draw field A → restore() → …` per field. Workable, fully in our control, but nothing is provided.
- **Input:** all raw Web APIs. We write keyboard listeners, pointer events for mouse/touch, and a Gamepad poll loop ourselves (~150–300 lines total, one-time).
- **Sim/render seam:** **best-in-class.** Nothing exists to fight — we own the loop, call `sim.tick()`, then `render(ctx, simState)`. The seam is exactly as deep as we make it (the weibenfalk pattern from Research 01: dumb data objects + isolated view).
- **Performance on low-end Android:** the risk point. Full-screen Canvas 2D fill-rate for 2 fields × 60 fps is the classic low-end-mobile bottleneck; hundreds of brick rects + particles per frame tax the rasterizer with no batching. Mitigable (render bricks to an offscreen canvas once per level change, dirty-rect redraws) — but that is hand-rolling a mini-engine.
- **Maintenance/DX:** no upstream. All bugs are ours. Canvas 2D itself is a stable browser primitive (Baseline "widely available").

**Assessment:** maximum architectural purity, minimum dependency risk, maximum implementation burden, and the *least certain* perf story on the exact hardware the map calls out.

## 4. Option B — PixiJS v8 (current: 8.20.1)

**Facts (all primary-source, fetched 2026-08-30):**

- **Version/cadence:** latest 8.20.1, published 2026-08-26 (GitHub releases API). 2026 releases: 8.14–8.20 — roughly monthly or better. Repo `pixijs/pixijs`, MIT, **48,097 stars / 5,068 forks**, last push 2026-08-26.
- **Renderers:** WebGL + WebGPU via `autoDetectRenderer` (README; `src/rendering/renderers/{gl,gpu}`). **Canvas renderer restored as experimental in v8.16.0 (2026-02-04)** — official blog: "an experimental Canvas renderer for environments without WebGL/WebGPU". So Pixi v8 covers WebGL-first with a no-WebGL escape hatch in the box. WebGL 2 canvases supported in v4-equivalent line since v8.0 (migration guide).
- **Bundle:** `pixi.min.js` v8.20.1 measured **818,871 bytes raw / 226 KB gzip** (jsdelivr, gzip -9). Tree-shakeable via the extensions system (`manageImports: false` + manual init imports — v8 migration guide) — a sprite-only subset ships meaningfully smaller.
- **npm dependencies:** earcut, tiny-lru, gifuct-js, ismobilejs, eventemitter3, @pixi/colord, parse-svg-path — **no physics, no game loop mandate, no scene lifecycle** (registry package metadata).
- **Input:** federated event system for **mouse + multi-touch** on the scene graph (`src/events/`: FederatedMouseEvent, FederatedPointerEvent, FederatedWheelEvent — repo tree). **No keyboard, no gamepad** — those are raw DOM/Gamepad API in our code (~100–200 lines).
- **Loop ownership:** `app.ticker` is opt-in; the renderer can be driven manually. We keep the rAF loop, tick the sim ourselves, then `app.render()` — no hidden game state.
- **Sim/render seam:** excellent by design — PixiJS positions itself as a rendering library ("the fastest, most lightweight 2D library available for the web", README), not a game framework. Our sim stays a plain TS module; the render layer maps sim state → Sprites/Graphics. Nothing fights a headless sim.
- **TypeScript:** written in TypeScript; first-party types ship in-package (source `.ts` throughout the repo; generated docs). Quality high.
- **Agent DX:** official **AI agent skills + llms.txt support** (June 2026 blog, "official AI agent skills"; llms.txt since v8.11 blog). `npm create pixi.js@latest` scaffolds a Vite + TS template (README; create-pixi CLI blog 2024-12).
- **v8 API notes relevant to us:** async `app.init()`, `Graphics` overhaul (build shape → fill/stroke), `ParticleContainer` with plain `IParticle` data objects — note that particles are *data objects, not sprites*, i.e. PixiJS's own high-perf path is exactly a state-then-sync shape (v8 migration guide).

**Assessment:** battle-tested WebGL batching (bricks as sprites → few draw calls), the smallest engine footprint of the two engines, renderer redundancy (WebGL → WebGPU → Canvas fallback), and zero architectural interference with the sim. Costs: we build the loop, split-screen composition, and keyboard/gamepad input ourselves.

## 5. Option C — Phaser (v3 vs v4 status verified)

**Facts (all primary-source, fetched 2026-08-30):**

- **Version status — this changed recently:** **Phaser 4.2.1 is current** (published 2026-07-09). **v4.0.0 "Caladan" GA'd 2026-04-10** — "the biggest release in Phaser's history - a ground-up rebuild of the WebGL renderer" (v4.0.0 release notes). v3 line ended at **3.90.0 (2025-05-23)**; v3 is now legacy (no 3.x release in 15 months). Training data that says "Phaser 3 is current" is outdated. New v4 since GA: 4.1.0 (2026-04-30), 4.2.0 (2026-06-19), 4.2.1 (2026-07-09).
- **Renderer:** WebGL-only focus in v4. Official changelog: "**Canvas renderer deprecated** — still available but should be considered deprecated… almost everything new in Phaser 4 is not available in Canvas. As WebGL support is effectively baseline today, we recommend focusing on WebGL." No WebGPU renderer shipped yet in v4.
- **Repo/maintenance:** `phaserjs/phaser`, MIT, **40,234 stars / 7,154 forks**, last push 2026-08-21, 134 open issues. 13+ years old, commercially backed (Phaser Studio Inc).
- **Bundle:** `phaser.min.js` 4.2.1 measured **1,375,976 bytes raw / 346 KB gzip** (README confirms 345 KB; `phaser-arcade.min.js` 313 KB strips Matter). v4 removed the 16 MB generic vertex buffer and uses index buffers (⅓ less vertex data) — renderer is lean, the framework around it is not.
- **Input:** the only option with **all four inputs first-class** — `src/input/` contains `gamepad`, `keyboard`, `mouse`, `touch` directories (repo tree), plus the InputPlugin per scene.
- **Split-screen:** the only option with a first-class abstraction — **cameras** (bounds, scroll, per-camera filters; v4 rewrote the camera matrix system).
- **Sim/render seam:** the friction point. Phaser is a framework: scenes own the update/render lifecycle, Arcade/Matter physics are built-in (and arcade has its own fixed-step mode), game objects carry behavior. You *can* disable physics and override `scene.update` to drive your own sim — but you're then paying for scenes, clocks, tweens, input plugins, and a physics module you don't use, and the game-object model tempts state to live in the display layer. Research 01's ourcade finding showed the failure mode: physics inside the scene lifecycle, "game state is the scene."
- **TypeScript:** source is ES5-era JavaScript with JSDoc; **`.d.ts` are generated from JSDoc** (repo `scripts/tsgen`, `types/phaser.d.ts`). Types are first-party and editor-detected, but generated-from-JSDoc, not native TS — historically looser than Pixi's hand-written-in-TS types.
- **Agent DX:** strong and deliberate — **28 AI agent skill files in-repo** (`skills/` verified: input-keyboard-mouse-touch, physics-arcade, scenes, v3-to-v4-migration, etc.), README markets AI-assisted development. `npm create @phaserjs/game` scaffolds Vite + TS templates.
- **Ecosystem caveat:** v4 is 5 months old. 2,000+ examples and most tutorials/plugins target v3; v4 broke the renderer, tint, FX/mask APIs (migration guide). Agent knowledge of v4 is fresh and the in-repo skills mitigate, but community content is mid-transition.

**Assessment:** the most complete framework — input and split-screen cameras are genuinely given — but the parts it gives are the parts we'd rather own (input is thin glue either way; split-screen is a layout problem), and the parts it mandates (scene lifecycle, bundled physics, JSDoc types, WebGL-only) are the parts our headless-sim architecture wants to avoid. Plus 346 KB gzip vs 226 KB.

## 6. Build tooling

- **Vite is current at 8.2.2** (npm registry, 2026-08; Vite 8 is Rolldown-based, Node ^20.19 || >=22.12, MIT). Native-ESM dev server, HMR, TS out of the box via esbuild transform, zero-config prod builds. It is also **what both ecosystems scaffold**: create-pixi generates Vite+TS; create-phaser-game offers Vite+TS templates. No conflict between stack choice and Vite.
- Alternatives considered: **esbuild** dev server (fast but no HMR-equivalent DX ecosystem — esbuild's own docs position it as a bundler/minifier more than an app dev server), **Webpack 5** (slower dev loop, older DX, no reason here), **Rollup** (bundler, not dev server), **Bun** (attractive speed but younger browser-target story; no need to pioneer). **Recommendation: Vite**, with **Vitest** for headless sim tests (same transform pipeline, runs sim determinism tests in pure Node).

## 7. Language

**TypeScript — confirmed, no flags.** Both candidate engines ship first-party types (Pixi native TS; Phaser generated), Vite handles TS natively, and a deterministic fixed-timestep sim with serializable snapshots is exactly the codebase that benefits from strict typing (fixed-point/quantized math units, snapshot schema versioning).

## 8. Recommendation

**PixiJS v8 + TypeScript + Vite + Vitest.**

Rationale, mapped to the hard requirements:

1. **Low-end Android, 2 fields, 60 fps:** WebGL sprite batching makes the two play fields a small number of draw calls into one canvas/context — the load profile low-end mobile handles best. Canvas 2D is the riskiest per-pixel path, and Phaser v4's answer to non-WebGL is "deprecated." Pixi uniquely keeps an in-box Canvas fallback (experimental, v8.16+) for the rare no-WebGL device.
2. **Sim/render seam:** Pixi is a rendering library — no physics, no scene lifecycle, no loop mandate. The headless deterministic sim stays the core module; the renderer is a pure consumer. Phaser's framework grain (scenes own lifecycle, bundled physics) is the exact thing Research 01 said we must not adopt.
3. **Input:** Pixi covers mouse/touch via federated events; keyboard + gamepad are thin raw-API wrappers (~150 lines). Phaser's fuller input stack is real but low-value for us — paddle control needs one axis plus a launch button per player.
4. **Free tooling + agent DX:** MIT, `npm create pixi.js@latest` → Vite+TS in one command, official AI agent skills and llms.txt, monthly release cadence, 48k stars. Smallest engine tax (226 KB gzip full, tree-shakeable below that).
5. **Maintenance:** Pixi is the more active repo right now (multiple 2026 releases; bug-hunt months; canvas fallback shipped Feb 2026), and v8 has been stable since March 2024 — no fresh-major-version churn like Phaser 4.

## 9. Trade-offs accepted

1. **We build what Phaser would have given:** split-screen composition (one canvas, two clipped Containers — straightforward but ours), the rAF/accumulator loop around the fixed-step sim, keyboard/gamepad glue, scene-less UI/menus via Pixi DOM-ish containers or HTML overlay. This is days, not weeks, and it all lives behind the same seam.
2. **Pixi's Canvas fallback is experimental** (v8.16, Feb 2026). If a no-WebGL Android device shows up in testing, options are: keep the WebGL path + accept the experimental fallback, or write a thin Canvas-2D renderer behind the same render interface. The seam makes the renderer swappable — this is the hedge, not a blocker.
3. **WebGPU is Pixi's future-facing renderer** and irrelevant to our low-end targets; `autoDetectRenderer` prefers WebGL in practice. Pin the preference explicitly (below).
4. **Not chosen: plain Canvas 2D** — cleanest seam but worst perf certainty on the stated hardware and the most hand-rolled subsystems. It remains the fallback renderer *shape* if Pixi ever had to be dropped (the seam protects us).
5. **Not chosen: Phaser 4** — richest out-of-box (input, cameras, tilemap, tweens) and the strongest agent-skills story; declined because its framework model conflicts with the headless-sim requirement, its 4.x line is 5 months old with a deprecated Canvas path, and the input/camera advantages don't outweigh the architectural interference for this specific game.

## 10. What the spec should standardize

1. **Renderer init:** `Application.init({ preference: 'webgl' })` (explicit, not auto — keep WebGPU off the target matrix), single canvas, one WebGL context for the whole device including split-screen.
2. **Sim/render contract:** sim is a pure TS module (no Pixi imports — importable headless in Vitest and, later, in the host's Worker tick per Research 02). Render layer reads snapshot state only: positions, brick liveness, paddle/ball/particles. One-way data flow; render never mutates sim state.
3. **Loop shape:** rAF-driven render at display rate + accumulator feeding the fixed-timestep sim (60 Hz tick), decoupled interpolation alpha for smooth remote-snapshot rendering. Host device also drives the netcode tick per Research 02's timer/Worker requirement — the render loop and sim tick must be independently driveable.
4. **Split-screen layout:** each play field = a Pixi `Container` clipped to its viewport rect, positioned by a layout function; play field internal coordinates stay in fixed sim units, scaled per viewport (logical resolution decoupled from device pixels).
5. **Input seam:** one input module normalizing keyboard / mouse / gamepad / touch → per-player `PaddleInput { move: -1|0|1 | targetX, launch: bool }` events; gamepad via raw Gamepad API polling in the loop, touch via Pixi federated pointer events on the paddle strip. Input events are timestamped sim inputs, not renderer state.
6. **Asset strategy:** textures as sprite atlases (AssetPack is Pixi's free pipeline tool); bricks as sprites to keep draw calls batched, not per-brick Graphics.
7. **Bundle budget:** target ≤ 350 KB gzip app total (engine 226 KB leaves ~120 KB for game code/assets metadata); tree-shake via the extensions init if needed.
8. **Perf gates for the low-end Android target ticket:** 60 fps with 2 full play fields + capsule effects on a minimum-spec device; monitor `renderer.extract` off, `failIfMajorPerformanceCaveat` default; measure draw calls/frame (should stay < 20) — these numbers feed the map's "Low-end Android performance targets" not-yet-specified item.

---

Sources (fetched 2026-08-30): github.com/pixijs/pixijs (repo API, README, releases v8.0.0–v8.20.1, `src/events` + `src/rendering/renderers` trees, v8 migration guide at pixijs.com/8.x/guides/migrations/v8); github.com/phaserjs/phaser (repo API, README, releases v4.0.0–v4.2.1 + v3.90.0, changelogs/v4/4.0/CHANGELOG-v4.0.0.md incl. "Canvas Renderer Deprecated", `src/input` tree, `skills/` tree); npmjs.com registry (pixi.js 8.20.1, phaser 4.2.1, vite 8.2.2 dist-tags + metadata); jsdelivr CDN builds measured with gzip -9; caniuse.com/gamepad (96.37%), caniuse.com/webgl (96.68%); pixijs.com/blog (v8.16.0 Canvas renderer post, June 2026 agent-skills post).
