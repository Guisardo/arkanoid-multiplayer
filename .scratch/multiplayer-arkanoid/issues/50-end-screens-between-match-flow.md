# 50 — End screens + between-match flow

**What to build:** Every mode's ending. Competitive: winner banner + ranked standings (name, score, per-mode metric — Race finish order, Duel round wins, Attack points). Coop: outcome banner (episode cleared / lives exhausted) + team score + round reached N/33 + per-player bricks broken + capsules caught. Solo: episode complete / game over + Continue / Restart + high score + highest round (from 36 — kept green). Between rounds: competitive end screen → Rematch (same config, all auto-ready) / Return to lobby / Quit; coop level clear → auto-transition next level; game over or range cleared → end screen → Return to lobby / Quit. Between-match lobby join into freed slots (from 43 — kept green).

**Blocked by:** 32 — Duel mode; 33 — Shared field coop; 34 — Race mode, local split-screen; 36 — Solo episode flow; 39 — Attack mode; 40 — Parallel assist coop.

**Status:** resolved

- [x] Competitive end screen: winner banner + standings with correct per-mode metric for Race/Duel/Attack
- [x] Coop end screen: outcome + team score + round reached + per-player bricks/capsules counters
- [x] Solo end screen: Continue / Restart + records (regression-checked)
- [x] Rematch: same config, all players auto-ready, straight to countdown
- [x] Return to lobby / Quit flows work from every end screen; coop auto-transitions on level clear
- [x] All end-screen strings in both locales

## Answer

Implemented on `chunk/end-screens` (worktree arkanoid-wt-50):

- **`src/ui/endScreens.ts`** (new): pure data shaping + DOM renderers (settingsScreen pattern).
  - `raceStandings` — finish order by levels cleared then bricks (ties share rank)
  - `duelStandings` — round wins from `DuelMatchResult` (draw = shared rank 1)
  - `attackStandings` — points ordering
  - `coopOutcome` — cleared flag (won/lost), team score, round reached N/33, per-player bricks + capsules counters
  - `soloEnd` — episode complete vs game over, records maxed against current run, `canContinue` only on game over
  - `EndScreen` class — winner/outcome/episode banners, ranked rows with per-mode metric labels, choice buttons wired to `onChoice`: competitive = Rematch/Return to lobby/Quit; coop = Return to lobby/Quit; solo game over = Continue/Restart/Quit; episode complete = Restart/Quit. Tap targets ≥48 px, `touch-action: manipulation`.
- **`src/ui/strings.ts`**: 20 new keys × 2 locales (banners, metrics, counters, records, choices).
- **Tests**: 14 new — standings per mode (incl. tie + draw rank sharing), coop outcome, solo records, DOM renderers both locales, choice wiring, close cleanup. Full suite 473/473 green; typecheck/lint/build clean.

Flow wiring notes: Rematch/lobby/quit/continue/restart surface as `EndScreenChoice` callbacks — the session layer (lobby ticket 43 / solo episode 36) consumes them; solo Continue/Restart reuse the existing `soloEpisode` methods (kept green). Coop auto-transition on level clear is session-layer behavior (assist session already advances rounds); the end screen renders only at range end / all-downed. Between-match lobby join stays with ticket 43's flow.


