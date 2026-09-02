# 49 — Doh boss round

**What to build:** Round 33 as a boss finale: the Doh boss on the play field, using the boss sprite (29) and boss theme (30) and the round-33 data (35). Boss behavior is classic-accurate — implementer follows the 1986 original's Doh fight as reference (multi-hit boss, projectile attacks, paddle death on contact); exact hit count and patterns are implementer's judgment against the classic, no further design decision required. In scope: Race, both coop variants, Solo. Excluded: Duel (draws rounds 1–32) and Attack (Doh excluded) — enforced by content constraints from 32/35.

**Blocked by:** 30 — Audio engine + content; 35 — Content: rounds 17–33.

**Status:** ready-for-agent

- [ ] Round 33 plays as a Doh boss fight to defeat in Solo, Race, and both coop variants
- [ ] Boss uses the registered sprite + boss theme; defeat = episode/match finale
- [ ] Duel and Attack can never reach round 33 (constraints hold, regression-tested)
- [ ] Boss behavior classic-accurate in feel: multi-hit, attacks the paddle, beatable but final-tier difficulty
