# 28 — Settings shell + persistence

**What to build:** The Settings screen shell with per-device persistence: a localStorage wrapper implementing the spec's key table (`settings.name`, `settings.skin`, `settings.theme`, `settings.bindings.keyboard`/`.gamepad`, `settings.audio`, `settings.display`, `settings.language`, `solo.highScore`/`solo.highestRound`), Audio and Display sections live (music/SFX sliders + mute; render quality dpr auto/2/1.5/1 + reduced-effects toggle), Controls and Appearance sections present as stubs to be filled by later tickets. Settings reachable from the landing screen; persisted values survive reload. All strings from locale tables.

**Blocked by:** 23 — Tracer bullet: Solo round playable.

**Status:** ready-for-agent

- [ ] Settings screen opens from landing; all four sections visible (Controls/Audio/Display/Appearance)
- [ ] Audio sliders + mute persist and apply on reload
- [ ] Display dpr mode (auto/2/1.5/1) + reduced-effects toggle persist and apply
- [ ] localStorage wrapper covers the full §16 key table with typed read/write
- [ ] Corrupt/unparseable stored values fall back to defaults, never crash
- [ ] Zero hardcoded strings; both locales complete for shipped UI
