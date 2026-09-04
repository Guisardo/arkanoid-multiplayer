# 22 — Repo scaffold + seam enforcement

**What to build:** A greenfield app skeleton where the game can be built: Vite + strict TypeScript + Vitest + Playwright + PixiJS v8 wired up, an empty app shell that renders, and lint rules that mechanically enforce the spec's seams — `sim/` never imports DOM, Pixi, or network; `render/` reads Snapshots only, never sim internals; `net/` moves Input frames and Snapshots; `input/` emits Input frames only. Renderer config locked per spec (antialias off, no context alpha, one WebGL context per device).

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] Vite dev build + production build pass; strict TypeScript compiles clean
- [x] Vitest runs (at least one placeholder test green); Playwright installed with one placeholder spec green under SwiftShader headless WebGL
- [x] PixiJS v8 initializes an empty scene with spec renderer config (antialias: false, useContextAlpha: false, single context)
- [x] ESLint import-boundary rules reject cross-seam imports (verified by a deliberately-violating test case); sim module provably free of DOM/Pixi/network imports
- [x] `webglcontextrestored` handler stub exists (resync-from-snapshot contract documented, impl later)
- [x] MIT attribution placeholder for ball-and-wall content DNA present in README

