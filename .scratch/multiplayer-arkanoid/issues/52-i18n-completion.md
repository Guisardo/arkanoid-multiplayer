# 52 — i18n completion

**What to build:** Full multilingual coverage: every string key present in both es-419 and en-US tables — no hardcoded strings anywhere in the app. Language auto-detect from `navigator.language`, Settings override, persisted, en-US fallback. Single BitmapText atlas covering Basic Latin + Latin-1 Supplement (á é í ó ú ñ ü ¿ ¡) for both locales. Language is per-device, never session state, never synced. Names, room codes, digits never localized.

**Blocked by:** 28 — Settings shell + persistence; 41 — Rebinds + Controls settings; 42 — Touch overlay + mobile layouts; 43 — Lobby + landing + session flow; 44 — Skins: lobby override + session sync; 48 — Remote pause/quit coordination; 50 — End screens + between-match flow; 51 — Versus bots mode.

**Status:** ready-for-agent

- [ ] i18n completeness test green: every key in en-US exists in es-419 and vice versa; no key used in code missing from tables
- [ ] Zero hardcoded user-facing strings (lint/test-enforced)
- [ ] Auto-detect + Settings override + en-US fallback all work; persisted per device
- [ ] BitmapText atlas renders both locales incl. á é í ó ú ñ ü ¿ ¡
- [ ] Language never synced across session; names/room codes/digits never localized
