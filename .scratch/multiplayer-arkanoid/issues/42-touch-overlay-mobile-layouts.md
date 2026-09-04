# 42 — Touch overlay + mobile layouts

**What to build:** Touch as a first-class input method plus mobile layout handling. Touch overlay anchored to the player's own field region: left-thumb virtual stick (proportional, 0.2 deadzone), right-thumb context cluster (Launch; Attack: 4 attack + cycle; Assist: 3 assist + cycle); buttons ≥48 px, semi-transparent, faint-visible always, brighten on active touch, multi-touch supported. Mobile layouts: 1-local = portrait, no lock, letterboxing handles either orientation; 2-local = landscape, attempt fullscreen + orientation lock at match start, lock fails → side-by-side in whatever orientation results; no stacked mode. Touch pause icon top corner, out of drag zone. Menus: tap targets ≥48 px, zero hover dependencies.

**Blocked by:** 34 — Race mode, local split-screen.

**Status:** ready-for-agent

- [ ] Virtual stick + context cluster render anchored to own field region; correct cluster per mode (Launch/Attack/Assist)
- [ ] Buttons ≥48 px, semi-transparent, faint-visible always, brighten on active touch; multi-touch works (stick + buttons simultaneously)
- [ ] Mobile 1-local portrait; 2-local landscape with fullscreen + orientation-lock attempt; lock failure → side-by-side fallback; no stacked mode
- [ ] Touch pause icon top corner out of drag zone; pause request works
- [ ] All menus tap-navigable; ≥48 px targets; zero hover dependencies
- [ ] Touch emits the same Input frame shape as other devices (parity at the seam)


