# 50 — End screens + between-match flow

**What to build:** Every mode's ending. Competitive: winner banner + ranked standings (name, score, per-mode metric — Race finish order, Duel round wins, Attack points). Coop: outcome banner (episode cleared / lives exhausted) + team score + round reached N/33 + per-player bricks broken + capsules caught. Solo: episode complete / game over + Continue / Restart + high score + highest round (from 36 — kept green). Between rounds: competitive end screen → Rematch (same config, all auto-ready) / Return to lobby / Quit; coop level clear → auto-transition next level; game over or range cleared → end screen → Return to lobby / Quit. Between-match lobby join into freed slots (from 43 — kept green).

**Blocked by:** 32 — Duel mode; 33 — Shared field coop; 34 — Race mode, local split-screen; 36 — Solo episode flow; 39 — Attack mode; 40 — Parallel assist coop.

**Status:** ready-for-agent

- [ ] Competitive end screen: winner banner + standings with correct per-mode metric for Race/Duel/Attack
- [ ] Coop end screen: outcome + team score + round reached + per-player bricks/capsules counters
- [ ] Solo end screen: Continue / Restart + records (regression-checked)
- [ ] Rematch: same config, all players auto-ready, straight to countdown
- [ ] Return to lobby / Quit flows work from every end screen; coop auto-transitions on level clear
- [ ] All end-screen strings in both locales


