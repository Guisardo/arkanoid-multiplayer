# Competitive mode design

Type: grilling
Status: resolved

## Question

What are the exact rules of each competitive variant?

Design all three, with per-variant win conditions, round/match structure, player-count caps (2-4), level selection, and tie-break/timeout handling:

- **Race** — identical parallel fields, first to clear wins.
- **Attack** — parallel fields; clears and power-ups send attacks to opponents. Define the attack actions (e.g. added bricks, effects sent) and their effects.
- **Duel** — shared field, direct interference. Define paddle/ball interaction rules (ball stealing? paddle collision? ball ownership).

HITL: play-style preferences decide. Invoke /grilling and /domain-modeling; add resolved terms to CONTEXT.md.

## Answer

All three competitive variants fully specified. Everything below is lobby-configurable where marked.

**Match structure (configurable):** best-of-N rounds (round = one level) / continuous episode race / one-off single level. **Level selection (configurable):** host-pick per round / fixed episode order / random. All players always get the identical level — fairness requirement. **Round time cap (configurable):** finite or infinite.

**All variants:**
- Lives: 5. 0 lives → current level resets (fresh brick layout, lives restored) — only cost is time lost while opponents progress.
- Timeout resolution: round-based → most bricks destroyed that round; continuous → furthest along (levels cleared, then bricks in current); one-off → most bricks. Exact tie → draw, no round point, next level.
- Power-ups: full roster active in all variants.
- Player counts: Race 2–4, Attack 2–4, Duel exactly 2. Three players is a first-class configuration (Race/Attack).

**Race:** identical parallel fields, first to clear wins the round/match per structure.

**Attack:** same win conditions as Race — attacks are interference, not a win path. Triggers (each lobby-toggleable, all-on default): chains (N consecutive bricks without paddle touch, bigger = stronger), power-up capture (small attack), level clear (continuous structure only — round-based clear ends the round instantly), charged manual — one shared attack meter filled by brick breaks, each button fires a different attack type at a manually picked target, per-type costs. Effects (all available): brick rain (scaled by trigger), paddle shrink (temp), ball speed up (temp), control mangle (temp). Stacking: same-type refreshes duration, different types apply independently. Targets mid-level-reset are immune; manual attacks auto-retarget.

**Duel:** shared field, both paddles bottom side-by-side, solid to each other (can block, can't overlap). No lives, no reset — ball drop grants opponent bonus points. Ball model (lobby choice): shared ball with steal-on-touch, or owned balls with deflect-only (no transfer); multi-ball = per-ball last-toucher. Round ends on field clear or timeout; winner = most points (brick points to ball owner + opponent ball-drop bonus). Timeout tie → draw.

**Glossary terms added to CONTEXT.md:** Race, Attack, Duel, Round, Match, Chain, Attack meter, Brick rain, Ball ownership, Lobby, Room code.

**Downstream notes:** 3/4-player split-screen layouts now required — carried to Split-screen rendering & layout (10). Attack tuning values (chain length N, meter costs, effect magnitudes/durations) deferred to Content set (09).
