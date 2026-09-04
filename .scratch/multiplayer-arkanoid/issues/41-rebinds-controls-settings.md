# 41 — Rebinds + Controls settings

**What to build:** Full input customization: keyboard fully rebindable including menu keys; gamepad buttons rebindable (movement fixed); touch/mouse fixed. Rebind screen per-player with tab between local players' maps; duplicate bindings rejected with highlight, checked across all local players' maps on the device; stored in localStorage per device. Menus navigable by any local input (first input takes focus). 4-on-keyboard achievable via rebinding; ~6-key rollover caveat documented in UI.

**Blocked by:** 26 — Mouse + gamepad input; 28 — Settings shell + persistence.

**Status:** resolved

- [x] Keyboard rebind screen: every action rebindable incl. menu keys; changes apply live
- [x] Gamepad buttons rebindable; stick/d-pad movement stays fixed
- [x] Duplicate binding rejected with highlight; checked across all local players' maps on the device
- [x] Rebind maps persist per device; corrupt maps fall back to defaults
- [x] Any local input navigates menus; first input takes focus; tab switches between local players' rebind maps
- [x] Rollover caveat visible in Controls UI

## Answer

Implemented in PR #20 (commits 36c0ae9 + fb3d86b):

- `src/input/bindings.ts` — pure rebind model: `KEYBOARD_ACTIONS` (incl. `menu`), `GAMEPAD_ACTIONS` (movement fixed), serialize/parse with per-player corrupt fallback, pairwise `findKeyboardConflicts`/`findGamepadConflicts` across all local players' maps (shared menu keys exempt).
- Adapters consume maps: `KeyboardAdapter`/`GamepadAdapter` gained `setBindings()` (live swap), `consumeMenuEvent()` (rebound menu key / Start), `flush()` (stale-edge kill on settings close).
- Settings → Controls: keyboard/gamepad device tabs, 4 player tabs (4-on-keyboard achievable), key capture with Esc-cancel, gamepad capture via 50 ms button-edge polling, duplicate rejection with CSS highlight (`.conflict`/`.capturing`), movement-fixed notice, rollover caveat, reset-to-defaults.
- Persistence: `settings.bindings.keyboard` / `settings.bindings.gamepad` (§16 key table); corrupt stored maps fall back to spec defaults, never throw.
- `soloSession` applies stored bindings at boot and re-applies live on settings close; rebound menu key / gamepad Start opens settings via `menuRequested()` in the render loop.
- Validation: typecheck + lint clean, 458/458 tests (+43 new: bindings 17, keyboard 12, gamepad 17, settingsScreen 13 jsdom, storage 14).

Code review (standards + spec axes) findings fixed in fb3d86b: dead gamepad capture path, menu rebind not honored in-game, edge leak on resume, 2-player tab limit, invisible conflict highlight, non-pairwise conflict detection.
