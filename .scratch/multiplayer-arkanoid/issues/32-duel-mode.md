# 32 — Duel mode

**What to build:** Two players on one shared field, both paddles bottom side-by-side, solid to each other (block, never overlap), wall-constrained separation (each paddle moves only as far as the wall allows, leftover shift goes to the other, ends flush). No lives, no reset — ball drop grants opponent +500. Ball model lobby choice: shared ball with steal-on-touch, or owned balls with deflect-only (no transfer); multiball = per-ball last-toucher. Ball ownership visually signaled: ball colored by owner + white outline glow over whatever skin it wears. Round ends on field clear or timeout; winner = most points (brick points to ball owner + drop bonuses); timeout tie → draw. Local split-screen pair on one device (single centered field, paddles color-coded per player).

**Blocked by:** 24 — Capsule system + capsule scripts; 31 — Content pipeline + rounds 1–16.

**Status:** ready-for-agent

- [ ] Two local players play a Duel on one shared field to a clear or timeout
- [ ] Paddles solid to each other; wall-constrained separation with leftover-shift, ends flush (unit-tested)
- [ ] Both ball models work: shared-steal and owned-deflect; lobby choice switches between them
- [ ] Ball drop pays opponent +500; multiball drop = per-ball last-toucher, only last ball re-attaches
- [ ] Brick points attributed to ball owner; winner = most points; timeout exact tie → draw
- [ ] Ownership readable: owner color + white outline glow over any skin (readability gate holds)
- [ ] Duel draws rounds 1–32 only — round 33 never selected (content constraint enforced)
