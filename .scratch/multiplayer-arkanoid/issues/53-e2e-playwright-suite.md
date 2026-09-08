# 53 — E2E Playwright suite

**What to build:** The browser end-to-end suite per spec §17: landing/menu navigation, settings persistence, i18n switch (es-419/en-US), Solo start/pause/continue, versus-bots config screen, lobby room-code create/join (two browser contexts), ready gate + start countdown, P2P connect via manual copy-paste fallback (no deployed infra needed — fallback doubles as dev-mode connector), touch overlay presence in mobile-emulated viewport, zero console errors. Headless WebGL via SwiftShader = functional only — perf budgets stay manual on the reference device. Seam rule: e2e owns wiring/UI/connection; sim logic stays in Vitest, never re-tested in e2e.

**Blocked by:** 42 — Touch overlay + mobile layouts; 45 — Remote play; 51 — Versus bots mode; 52 — i18n completion.

**Status:** resolved

- [x] All spec'd e2e scenarios run green headless (SwiftShader WebGL)
- [x] Two-context lobby create/join + ready gate + countdown covered
- [x] Copy-paste P2P connect covered without deployed infra
- [x] Mobile-emulated viewport shows touch overlay; desktop doesn't
- [x] Zero console errors asserted across the suite
- [x] No sim-logic assertions in e2e — those live in Vitest only

## Answer

Implemented on `chunk/e2e-suite` (9 specs, 9/9 green ×2 runs; 923 unit tests, typecheck/lint/build clean):

**Production gaps the suite forced closed (wiring, not sim logic):**

- **Solo episode flow wired at last** (`src/app/soloSession.ts`): the session now consumes `createSoloEpisode` (ticket 36's module — previously built but never wired) — Esc/menu-key/touch-pause opens a pause menu (Resume / Settings / Quit; Settings = Audio/Display only per spec §14, returns to the pause menu), game over / episode complete shows the solo `EndScreen` (Continue = same round + score −60%, Restart = round 1 + score 0, Quit = back to landing via new `onQuit` seam instead of reload). New probes: `soloPhase`, `soloRound`, `soloScore`, `paused`, `debugSetBall`.
- **Real bug found + fixed** (`src/app/soloEpisode.ts`): the episode's internal `score` never synced from the sim at game over — Continue applied −60% to a stale score (0). Now synced before recording; e2e asserts Continue keeps `floor(score × 0.4)`.
- **Copy-paste fallback UI** (`src/ui/copyPasteScreens.ts`, new): host screen (offer code + answer paste) / guest screen (offer paste + answer code), auto-offered when the signaling WS fails (spec §9), wired in `main.ts` host/guest flows (signaling first, fallback on `SignalingUnavailable`; copy-paste sessions have no rejoin — reconnect stays signaling-only). 9 locale keys ×2.
- **Settings sections option** (`settingsScreen`/`settingsRoute`): in-session settings = Audio/Display only (spec §14) — Controls/Appearance rebind mid-match would desync.
- **N2 — mp mouse/touch wiring** (deferred from ticket 46): `makeLocalInput(flow)` gains per-local-player `MouseAdapter` (pointer routed by field-region hit-test, paddle-chase parity) + `TouchAdapter`/`TouchOverlay` per local player (mounted at match start via new `MpFlow` probes: `renderApp`, `localRegion(player)`, `localPlayers`, `currentMode`; `SplitScreenView.regionOf(player)` maps sim player → screen region). Sample merge: touch > mouse > gamepad > keyboard, edges OR'd.
- **Loop fix** (`src/app/loop.ts`): `start()` after `advance()`-mode use no longer resets the clock to wall-time — it poisoned the next advance's delta (pause/resume froze ticks in test mode).

**Specs (e2e/):** `i18n` (es-419 switch → reload → lang/title/landing, persists, back), `soloFlow` (pause freeze/resume, deterministic 3-life drain via `debugSetBall`, Continue/Restart semantics), `versusBots` (variant picker, Duel clamps bots→1, difficulty, Start boots), `lobby` (two contexts, copy-paste exchange through the UI, lobby sync, ready gate, countdown, match canvas both sides — signaling deterministically down via `routeWebSocket` abort; guest enters via `?code=` QR path), `touchOverlay` (mobile-emulated context has the overlay, desktop doesn't — mobile context closed first: second live WebGL context in one browser process hangs), `settings` (pause menu → Settings Audio/Display-only, audio persists across reload), plus existing boot/solo/remote kept green.

**CI:** `.github/workflows/e2e.yml` (new) — chromium + `npm run e2e` on push/PR, alongside the existing Vitest coverage job.

**Judgment calls:** lobby e2e aborts the signaling WS via Playwright's `routeWebSocket` — the dev server accepts the upgrade but never speaks the relay protocol, which stalls the guest ~30 s non-deterministically; aborting makes signaling-down (the honest precondition for the fallback) deterministic. Solo drain uses `debugSetBall(20, 240, 0, 120)` + per-life `waitForFunction` on lives — fixed sleeps reset the falling ball mid-flight (700 ms < 53-tick fall) and never lost a life.
