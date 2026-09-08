# 56 — Versus bots: app session layer

**What to build:** Wire `createVersusBotsSession` (ticket 51's sim module — built but never consumed by the app) into a real versus-bots session: `main.ts` currently starts `startSoloSession(1, { bot })` — a solo round with a bot replacing the human's paddle (watch-bot-play), not a versus match. Build the session layer: versus-bots match rendering (split-screen for race/attack, single field for duel/sharedField), human + N bot players, pause freely (coop semantics — pause menu), end screens per variant (ticket 50 shapes), rematch/back-to-config flow. The trimmed config screen (51) and e2e coverage (53) already exist and stay green.

**Blocked by:** 53 — E2E Playwright suite.

**Status:** ready-for-agent

- [ ] Versus bots Start boots a real versus match (human plays, bots play — not watch-bot-play)
- [ ] All 5 variants render correctly (split-screen vs single field)
- [ ] Pause menu works mid-match (coop semantics)
- [ ] End screen per variant + rematch/back-to-config flow
- [ ] Existing versusBots e2e spec extended to cover match start + one bot interaction
