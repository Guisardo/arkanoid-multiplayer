# Content set: levels & power-ups

Type: grilling
Status: resolved
Blocked by: 01

## Question

What is the full Arkanoid content set?

Define: level count and progression; brick types (standard, multi-hit, silver, gold/indestructible); the power-up roster (full classic set — expand, catch, laser, slow, break, multi-ball, etc.?); capsule drop rates; difficulty curve; and the level data format the spec should standardize on. If Research: reusable Arkanoid base survey adopted a base, evaluate its content for reuse.

HITL for scope preferences. Invoke /grilling and /domain-modeling.

## Answer

- **Structure:** 33 rounds, single numbered sequence; round 33 = Doh boss round. No episode data structure — level ranges reference round numbers directly.
- **Boss:** Doh included in Race and both coop variants; excluded from Duel's level pool (Duel draws rounds 1–32).
- **Bricks:** three families only — standard (colored, 1-hit, point tiers by color), silver (multi-hit), gold (indestructible, layout walls). No regenerating bricks, no multiplayer-only brick types (attack triggers already covered by Chain + attack meter).
- **Capsule roster (10):** classic 8 — B (Break), C (Catch), D (Disrupt), E (Expand), L (Laser), M (Multiball), P (Player, extra life), S (Slow) — plus R (Reduce, negative) and ? (Random). Cut: T (Twin — collides with multi-paddle modes), 1/2 (level warp — breaks Race/coop progression). B redefined: flying through the exit = round clear with standard clear points, no bonus — a speedrun mechanic.
- **Drops:** deterministic per-level capsule script — fixed count (~6–10) + fixed release order, each triggered on a specific brick-break count, encoded in level data. Zero RNG in capsule logic.
- **? resolution:** next undropped scripted capsule for that level; E (Expand) fallback when script exhausted. Deterministic, player-opaque.
- **B-exit:** counts as level clear in every respect — win condition, attack trigger, timeout progression.
- **Difficulty:** all knobs in level JSON: per-round base ball speed; in-level speed tier bumps at ≤15 and ≤8 bricks remaining; silver hit count = `min(1 + floor(round / 8), 4)`.
- **Level format:** JSON per level — char grid (13×18, exact dims verified at authoring) + metadata (capsule script, base speed, silver hits, overrides). Legend: `.` empty, letters = brick colors, `S` silver, `G` gold. Hand-editable by design.
- **Scoring:** classic-accurate point table in content data (colored tiers ~50–120, silver pays per hit, gold 0, capsule catch bonus, level clear bonus); exact values verified at authoring; Duel balance re-checked after prototype.
- **Capsule effect behaviors** (durations, what clears on ball loss): classic-accurate, verified at authoring.
- **Attack tuning defaults** (deferred here from Competitive mode design): chain ≥4/≥7/≥10 bricks = small/medium/large attack; meter costs (of 100): brick rain 30, paddle shrink 25, ball speed-up 20, control mangle 40; magnitudes: rain 3/6/12 bricks, shrink 40%, speed +30%, mangle 10 s; effect durations 8–15 s. All marked "tuning values — adjust after prototype".
- **Shared-field placement C note:** capsule effects apply to the shared paddle (the only paddle); placements A/B: effects apply to capturer's paddle only (per Coop mode design).

Downstream: spec assembly uses "capsule" as the canonical term where earlier tickets wrote "power-up". Glossary terms added to CONTEXT.md: Capsule, Capsule script, Episode.

### Prototype amendment (Game-feel prototype, ticket 16)

Attack tuning defaults **validated in playtest** — chain thresholds 4/7/10, meter costs 30/25/20/40, durations shrink 10 s / speed-up 8 s / mangle 6 s, fill 2/brick + 10/capsule. Ship as defaults; live-tunable if spec assembly revisits.
