# 35 — Content: rounds 17–33

**What to build:** The second half of the classic content: rounds 17–33 authored in the level JSON pipeline — grids, capsule scripts, base speeds, tier bumps, silver overrides — following the established format and passing the same validation suite. Round 33 = Doh boss round: level data and parameters authored (boss sprite already registered from 29; boss behavior lands in ticket 49). Doh excluded from Attack (attack triggers conflict with a boss round) — content selection constraint enforced.

**Blocked by:** 31 — Content pipeline + rounds 1–16.

**Status:** ready-for-agent

- [x] Rounds 17–33 authored, each playable start-to-clear with its capsule script
- [x] All 33 rounds pass the validation suite (dims, script bounds, metadata)
- [x] Round 33 data authored for the Doh boss (parameters consumable by ticket 49)
- [x] Doh excluded from Attack mode level selection (constraint enforced, unit-tested)
- [x] Difficulty curve continuous across the 1–16 / 17–33 boundary (base speeds, silver hits escalate per formula)

