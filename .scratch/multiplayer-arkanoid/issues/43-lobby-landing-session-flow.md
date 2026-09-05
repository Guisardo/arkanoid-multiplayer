# 43 — Lobby + landing + session flow

**What to build:** The full session flow around the game. Landing with three entries: Solo (straight to game), Versus bots (trimmed config), Multiplayer (room code). Room code: 5 chars from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`; Create shows the code large; Join = 5 auto-advancing boxes; QR share encoding `https://<host>/?code=XXXXX` (client-side generation); landing reads `?code=` and prefills join. Local players: "Add local player" — desktop max 4/device, mobile max 2 (touch = 1 player, 2nd = gamepad), session cap 4; addable any time before start. Configuration host-only; guests see a live read-only panel; config change resets all ready checks; mode picker disables invalid variants for player count (Duel greyed unless exactly 2; all need ≥2). Ready & start: every player (incl. host locals) marks ready; host Start enabled only when all ready; between-match joiners start unready, existing keep state; Start → synchronized 3-2-1 countdown → serve. Late-join: none mid-game — code entry during game → "Game in progress"; lobby-join between matches OK (freed slots open); room lives until host quits/closes tab; same code whole session. Kick: host-only, lobby + mid-session. Host disconnect → "Host left — session ended" (ADR 0001). Player naming: default "Player N" + auto color, editable ~12 char max, localStorage-reused; names/room codes/digits never localized.

**Blocked by:** 34 — Race mode, local split-screen; 37 — Signaling: Cloudflare Worker + Durable Object + copy-paste fallback.

**Status:** resolved

- [x] Landing shows three entries; Solo skips straight to game
- [x] Create room → code shown large + QR; Join → 5 auto-advancing boxes; `?code=` prefill works
- [x] Add local players enforced: desktop ≤4, mobile ≤2 (touch=1, 2nd gamepad), session cap 4
- [x] Host config live-updates guests' read-only panel; any config change resets all ready checks
- [x] Mode picker greys invalid variants for current player count (Duel = exactly 2; all ≥2)
- [x] All-ready gate: Start disabled until every player ready; countdown → serve synchronized
- [x] Mid-game join → "Game in progress"; between-match join works into freed slots; same code whole session
- [x] Host kick works in lobby and mid-session; host quit/tab close ends session for all with clear message
- [x] Names: default Player N, editable, persisted, never localized

## Answer

Implemented on `chunk/lobby-flow` (worktree arkanoid-wt-43):

- **`src/app/lobbyState.ts`** (new, pure): lobby state machine — `reduceLobby(state, event, device)`. Covers: create/join (charset-validated codes), add-local (desktop 4 / mobile 2 device caps, session cap 4), remote join/leave, kick (host-only on remotes), ready checks, host-only config with **all-ready reset on any config change**, all-ready gate + 3-2-1 countdown, mode validation (`modeErrorFor`/`validModes`: all ≥2, Duel exactly 2), phase machine (lobby → countdown → inGame → betweenMatches), **no mid-game late-join** (joinRoom/addLocalPlayer/remoteJoined rejected in inGame+countdown), between-match join (joiners unready, existing keep state), hostLeft → fresh local lobby (ADR 0001).
- **`src/ui/lobbyScreens.ts`** (new): `LandingScreen` (Solo / Versus bots / Multiplayer; `?code=` prefill auto-opens multiplayer), `RoomCodeScreen` (create: code large + client-side QR canvas via `qrcode-generator` lib, payload `https://<host>/?code=XXXXX`; join: 5 auto-advancing boxes with backspace-nav, prefill fills boxes), `LobbyScreen` (players with ready toggles, host kick buttons on remotes, add-local button, mode picker greying with error tooltips, host config vs guest read-only panel, countdown display). Tap targets ≥48 px.
- **QR**: `qrcode-generator` dependency (MIT, ~10 KB, zero network) — justified over hand-rolling: QR encoding is Reed-Solomon + masking, too large to hand-roll safely; lib is tiny, client-side only.
- **`src/ui/strings.ts`**: 28 new keys × 2 locales (lobby labels, errors, host-left message).
- **Tests**: 28 new — state machine (17: caps, ready-reset, all-ready gate, countdown, mode validation, kick, join windows, host-left) + screens (11: landing entries + prefill, create code+QR payload, join boxes auto-advance + prefill, lobby render, mode greying, guest read-only). Full suite 487/487 green; typecheck/lint/build clean.

Signaling wiring note: `SignalingClient` (ticket 37) connects the room code to the relay; the lobby state machine is transport-agnostic — the session layer feeds `remoteJoined`/`remoteLeft`/`hostLeft` events from signaling and drives `sync()` on every screen. Full remote game start (WebRTC data flow) is ticket 45's seam.


