# 42 — Touch overlay + mobile layouts

**What to build:** Touch as a first-class input method plus mobile layout handling. Touch overlay anchored to the player's own field region: left-thumb virtual stick (proportional, 0.2 deadzone), right-thumb context cluster (Launch; Attack: 4 attack + cycle; Assist: 3 assist + cycle); buttons ≥48 px, semi-transparent, faint-visible always, brighten on active touch, multi-touch supported. Mobile layouts: 1-local = portrait, no lock, letterboxing handles either orientation; 2-local = landscape, attempt fullscreen + orientation lock at match start, lock fails → side-by-side in whatever orientation results; no stacked mode. Touch pause icon top corner, out of drag zone. Menus: tap targets ≥48 px, zero hover dependencies.

**Blocked by:** 34 — Race mode, local split-screen.

**Status:** resolved

- [x] Virtual stick + context cluster render anchored to own field region; correct cluster per mode (Launch/Attack/Assist)
- [x] Buttons ≥48 px, semi-transparent, faint-visible always, brighten on active touch; multi-touch works (stick + buttons simultaneously)
- [x] Mobile 1-local portrait; 2-local landscape with fullscreen + orientation-lock attempt; lock failure → side-by-side fallback; no stacked mode
- [x] Touch pause icon top corner out of drag zone; pause request works
- [x] All menus tap-navigable; ≥48 px targets; zero hover dependencies
- [x] Touch emits the same Input frame shape as other devices (parity at the seam)

## Answer

Implemented on `chunk/touch-overlay` (worktree arkanoid-wt-42):

- **`src/input/touch.ts`** (new, pure): `TouchAdapter` — virtual stick (proportional, 0.2 deadzone, epsilon-safe boundary), context cluster buttons (edge-triggered, buffered max 1/tick), multi-touch pointer ownership (one control per pointer, stick + buttons simultaneously), pause edge, live mode/layout swap. Emits the standard Input frame — parity at the seam. Cluster modes: solo = Launch; attack = 4 fire + cycle; assist = 3 fire + cycle.
- **`src/render/touchOverlay.ts`** (new): Pixi overlay — stick base + knob (axis-driven), round buttons ≥48 px, semi-transparent (idle 0.25 alpha, faint-visible always), brighten on active (0.6), pictorial glyphs (triangle/roman numerals/chevrons/pause bars), anchored bottom-left stick / bottom-right cluster / top-corner pause (out of drag zone, >2 stick radii away). Redraws from adapter state only.
- **`src/app/mobileLayout.ts`** (new, pure): device class detection (coarse pointer + UA incl. iPadOS masquerade), local caps (desktop 4 / mobile 2), layout plans (1-local portrait no-lock; 2-local landscape + fullscreen/orientation-lock attempt), side-by-side regions in ANY orientation (never stacked), injectable fullscreen/orientation surfaces for tests.
- **`src/app/soloSession.ts`**: touch wiring — adapter + overlay on touch devices, pointer routing (pointerdown/move/up/cancel, touch-type only), device-merge priority (touch > mouse > gamepad > keyboard), pause icon → settings overlay (same semantics as menu key), resize re-anchors overlay.
- **`src/ui/settingsScreen.ts`**: tap targets — buttons min-height/min-width 48 px + `touch-action: manipulation` on coarse pointers (hover-capable devices keep compact sizing); zero hover dependencies.
- **`src/ui/strings.ts`**: 6 new keys × 2 locales (touch.pause/stick/launch/fire/cycle).
- **Tests**: 34 new — touch adapter (17: stick math, edges, multi-touch, clusters, pause, frame parity), mobileLayout (12: detection, caps, plans, regions, lock outcomes), overlay render (5: layout math, ≥48 px, no overlap, live swaps). Full suite 493/493 green; typecheck/lint/build clean.

Judgment calls: stick claim radius = 1.5× base (generous grab zone); pause = edge-only (no hold semantics); overlay `eventMode: none` — app routes pointers (single event path, no double-handling with canvas listeners).


