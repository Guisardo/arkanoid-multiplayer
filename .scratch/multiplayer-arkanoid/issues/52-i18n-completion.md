# 52 — i18n completion

**What to build:** Full multilingual coverage: every string key present in both es-419 and en-US tables — no hardcoded strings anywhere in the app. Language auto-detect from `navigator.language`, Settings override, persisted, en-US fallback. Single BitmapText atlas covering Basic Latin + Latin-1 Supplement (á é í ó ú ñ ü ¿ ¡) for both locales. Language is per-device, never session state, never synced. Names, room codes, digits never localized.

**Blocked by:** 28 — Settings shell + persistence; 41 — Rebinds + Controls settings; 42 — Touch overlay + mobile layouts; 43 — Lobby + landing + session flow; 44 — Skins: lobby override + session sync; 48 — Remote pause/quit coordination; 50 — End screens + between-match flow; 51 — Versus bots mode.

**Status:** resolved

- [x] i18n completeness test green: every key in en-US exists in es-419 and vice versa; no key used in code missing from tables
- [x] Zero hardcoded user-facing strings (lint/test-enforced)
- [x] Auto-detect + Settings override + en-US fallback all work; persisted per device
- [x] BitmapText atlas renders both locales incl. á é í ó ú ñ ü ¿ ¡
- [x] Language never synced across session; names/room codes/digits never localized

## Answer

Implemented (ticket 52). Audit found 6 gaps; all closed:

- **Language override was dead code**: `settings.language` was stored (§16 key table) but never read — `main.ts`/`soloSession.ts` used `detectLocale` only. Now `resolveLocale(stored, languages)` (pure, in `strings.ts`): valid stored locale wins; null/garbage/"" → `detectLocale` (navigator) → en-US. Wired in both boot paths (`opts.locale` test override still wins).
- **Language row added to Settings Display section**: `<select data-language-select>` with Auto + endonym options (English/Español — endonyms never localized, same in both tables). Persists via `saveSettings({ language })` — "auto" persists as empty string (reads back as auto). Apply = page reload (locale is boot-resolved; reload is the spec-compliant "persisted per device" apply). jsdom-guarded try/catch.
- **Settings unreachable from landing/lobby (spec §14: "landing + lobby always")**: ticket 43's landing rebuild had dropped the entry (28 shipped it, 43 rebuilt with 3). Restored: `LandingScreen` 4th entry + `LobbyScreen` Settings button, both via optional `onSettings` callback; `main.ts` wires both host + guest lobbies to `showSettings` overlay.
- **Hardcoded `R{round}/{max}` in remoteStrip.ts** (guest progress strip): replaced with `format(t(locale, "hud.roundOf"), …)` — same rendered output, now localized shape.
- **Atlas gap**: `GAME_FONT_CHARS` was missing `… · —` (used by `mp.connecting`, `end.coopCounters`, `lobby.hostLeft`/`mp.hostLeft`). Added — atlas now provably covers every character in both tables.
- **Document chrome**: `main.ts` sets `document.documentElement.lang` (es/en) + `document.title` from `t(locale, "app.title")` at boot.

**Enforcement** (new `tests/ui/i18n-completeness.test.ts`, 6 tests): every `t()` literal key used in src exists in both tables; template-literal key prefixes (`settings.action.*`, `settings.controls.*`) resolve to real keys; es-419 covers every en-US key; `{placeholder}` parity across locales per key; atlas ⊇ every character in both tables; no user-facing string literals outside tables (textContent/.text scan with CSS/symbol/interpolation allowlist).

**New keys** (×2 locales): `settings.language.auto/enUS/es419` (endonyms identical in both tables by design).

**Tests**: 17 new (completeness 6, strings resolveLocale/endonyms 4, settingsScreen language row 4, lobbyScreens landing+lobby settings 2, main stored-language boot 1). Full suite 919/919 green; typecheck, lint, build clean.

Language stays per-device, never session state, never synced (no locale field in any lobby/snapshot/control message). Names, room codes, digits never localized (unchanged — verified by the literal scan).


