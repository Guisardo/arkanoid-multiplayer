# 56 — Versus bots: app session layer

**What to build:** Wire `createVersusBotsSession` (ticket 51's sim module — built but never consumed by the app) into a real versus-bots session: `main.ts` currently starts `startSoloSession(1, { bot })` — a solo round with a bot replacing the human's paddle (watch-bot-play), not a versus match. Build the session layer: versus-bots match rendering (split-screen for race/attack, single field for duel/sharedField), human + N bot players, pause freely (coop semantics — pause menu), end screens per variant (ticket 50 shapes), rematch/back-to-config flow. The trimmed config screen (51) and e2e coverage (53) already exist and stay green.

**Blocked by:** 53 — E2E Playwright suite.

**Status:** resolved

- [x] Versus bots Start boots a real versus match (human plays, bots play — not watch-bot-play)
- [x] All 5 variants render correctly (split-screen vs single field)
- [x] Pause menu works mid-match (coop semantics)
- [x] End screen per variant + rematch/back-to-config flow
- [x] Existing versusBots e2e spec extended to cover match start + one bot interaction

## Answer

Implemented in PR #45 (merged as 5a92a56). Real versus-bots matches now boot from the config screen: split-screen for race/attack/parallelAssist (N fields), single field for duel/sharedField; input merge (keyboard/mouse/gamepad/touch), session audio, perf ladder, pause menu (coop semantics), end screens per ticket 50 shapes, Rematch / back-to-config / Quit.

**Real bug found + fixed during e2e**: parallel-variant bots never launched — bots sampled field-local snapshots (player 0) but were constructed with session indices 1..N, so the 'me' lookup failed and every bot idled in serve forever. Ticket 51's tests only asserted no-crash + tick advance, never bot movement. Fix: parallel bots created player 0 (field-local view), frames remapped to session index for multiField routing; single-field variants keep real indices end to end. Regression unit test: bots launch within their 60–240-tick window and paddles track the ball.

Validation: 972 unit tests ✓ (10 versusBotsSession + 20 versusBots sim), 13 e2e ✓ (3 versusBots specs: 4 fields + bot movement, duel single field + pause, config screen), typecheck ✓, eslint ✓, codecov project 92.95% (floor 92%).
