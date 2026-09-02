# Research: browser stack options

Type: research
Status: resolved
Blocked by: 01

## Question

Which browser game stack should this be built on?

Given the reusable-base verdict from Research: reusable Arkanoid base survey: if a base was adopted, validate its stack for our needs (multi-field rendering, 4-way input, low-end Android performance) rather than re-surveying. If building fresh, compare plain Canvas, PixiJS, and Phaser for: rendering 1-2 play fields at 60fps on low-end Android, Gamepad API + touch + keyboard + mouse input, and a multiplayer-friendly state architecture.

Deliver: stack recommendation with trade-offs. This gates Split-screen rendering & layout and the final spec.

## Answer

**Recommended stack: PixiJS v8 (8.20.1) + TypeScript + Vite + Vitest.** Pixi is a rendering library, not a framework — no physics, no scene lifecycle, no mandated loop — so the headless deterministic fixed-timestep sim stays the core module and the renderer is a pure consumer of snapshots: the sim/render seam our host-authoritative WebRTC design requires. WebGL sprite batching makes 1–2 play fields a handful of draw calls on one canvas (best perf certainty for low-end Android at 60 fps), with an experimental Canvas fallback (v8.16+) for no-WebGL devices, at 226 KB gzip full. Vite is the tooling both ecosystems scaffold natively; TypeScript confirmed (Pixi is hand-written TS with first-party types). Phaser 4 (GA 2026-04, current 4.2.1) was the runner-up: best out-of-box input (all 4 modes) and split-screen cameras, and in-repo agent skills — declined because its scene/physics framework model interferes with a headless sim, its Canvas renderer is deprecated (WebGL-only), and v4 is 5 months old. Plain Canvas 2D declined: cleanest seam but worst perf certainty on the target hardware. Main trade-off accepted: we hand-build split-screen composition, the rAF/accumulator loop, and keyboard/gamepad glue (~days) — all behind the same seam, which keeps the renderer swappable. Full findings: [03-browser-stack-options.md](../research/03-browser-stack-options.md).
