# 36 — Solo episode flow

**What to build:** The complete Solo experience: straight from landing to game, no lobby, no bots. 3 lives (classic-accurate), score accumulates across the run, round advances on clear, rounds 1–33 with the Doh finale. Game over → Continue (resume from current round N with fresh 3 lives, score reduced by 60%) or Restart episode (score 0, round 1). localStorage records: highest round reached + high score. Pause freely (coop semantics — pause screen with Resume, Settings (Audio/Display), Quit). No difficulty select — the 33-round curve is the difficulty.

**Blocked by:** 24 — Capsule system + capsule scripts; 31 — Content pipeline + rounds 1–16.

**Status:** ready-for-agent

- [ ] Landing → Solo starts immediately; full episode 1–33 playable (Doh behavior from 49 acceptable as stub until then)
- [ ] 3 lives; score accumulates across rounds; round advances on clear
- [ ] Game over offers Continue (current round, fresh 3 lives, score −60%) and Restart (round 1, score 0) — both work
- [ ] High score + highest round persisted; shown on end screen
- [ ] Pause screen: Resume, Settings (Audio/Display only), Quit; sim pauses and resumes cleanly
- [ ] No difficulty select anywhere in the Solo path
