# 43 — Lobby + landing + session flow

**What to build:** The full session flow around the game. Landing with three entries: Solo (straight to game), Versus bots (trimmed config), Multiplayer (room code). Room code: 5 chars from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`; Create shows the code large; Join = 5 auto-advancing boxes; QR share encoding `https://<host>/?code=XXXXX` (client-side generation); landing reads `?code=` and prefills join. Local players: "Add local player" — desktop max 4/device, mobile max 2 (touch = 1 player, 2nd = gamepad), session cap 4; addable any time before start. Configuration host-only; guests see a live read-only panel; config change resets all ready checks; mode picker disables invalid variants for player count (Duel greyed unless exactly 2; all need ≥2). Ready & start: every player (incl. host locals) marks ready; host Start enabled only when all ready; between-match joiners start unready, existing keep state; Start → synchronized 3-2-1 countdown → serve. Late-join: none mid-game — code entry during game → "Game in progress"; lobby-join between matches OK (freed slots open); room lives until host quits/closes tab; same code whole session. Kick: host-only, lobby + mid-session. Host disconnect → "Host left — session ended" (ADR 0001). Player naming: default "Player N" + auto color, editable ~12 char max, localStorage-reused; names/room codes/digits never localized.

**Blocked by:** 34 — Race mode, local split-screen; 37 — Signaling: Cloudflare Worker + Durable Object + copy-paste fallback.

**Status:** claimed

- [ ] Landing shows three entries; Solo skips straight to game
- [ ] Create room → code shown large + QR; Join → 5 auto-advancing boxes; `?code=` prefill works
- [ ] Add local players enforced: desktop ≤4, mobile ≤2 (touch=1, 2nd gamepad), session cap 4
- [ ] Host config live-updates guests' read-only panel; any config change resets all ready checks
- [ ] Mode picker greys invalid variants for current player count (Duel = exactly 2; all ≥2)
- [ ] All-ready gate: Start disabled until every player ready; countdown → serve synchronized
- [ ] Mid-game join → "Game in progress"; between-match join works into freed slots; same code whole session
- [ ] Host kick works in lobby and mid-session; host quit/tab close ends session for all with clear message
- [ ] Names: default Player N, editable, persisted, never localized


