# Game-feel prototype

Type: prototype
Status: resolved
Blocked by: 04, 05, 08

## Question

Do the mode designs and netcode decisions feel right in practice?

Build a throwaway prototype (per /prototype skill) and validate by playing:

- Mode feel: Race/Attack/Duel competitive variants; shared-field and parallel-assist coop; attack/assist meter mechanics.
- Netcode feel: local-paddle prediction + error-offset reconcile; remote paddle/ball interpolation; host-only input delay D=3–5 ticks (default 4) in competitive modes.
- Marked validate-after-prototype items: input redundancy window ~10 ticks (Netcode sync architecture Q7); host overload catch-up cap + slow-motion with throttle warning (Q13); attack tuning defaults — chain thresholds 4/7/10, meter costs 30/25/20/40, magnitudes/durations (Content set: levels & power-ups).
- Host tick budget with 3 guests: sim tick ≤ 2 ms must still hold with input-queue + snapshot-serialization duty added (Research: low-end Android performance targets flag 3).
- Two parallel fields on the entry-Android reference device within the render budget (Split-screen rendering & layout): draw calls stay < 20, render ≤ 5 ms with 2 fields; fallback ladder dpr 2 → 1.5 → 1.0 → 30 fps degraded mode.

Links the prototype as an asset from this ticket. Adjust-after-prototype values get written back into the deciding tickets as resolution amendments.

## Answer

Validated by human playtest across all five modes. Prototype asset: [prototype/game-feel-prototype.html](../prototype/game-feel-prototype.html) (self-contained, double-click to run; smoke-tested headless — all modes, overload path, edge cases).

**Netcode decisions validated:**

- **Prediction + error-offset reconcile works** — direct per-tick compare (sim x vs predicted x), snap prediction to authoritative, fold difference into a display offset decaying ~0.5 s. Player sees smooth correction, never teleport. Critical detail: prediction must respect *every* sim constraint (walls, shared-field slice, duel other-paddle-as-wall) or reconcile reads the constraint as error and the display settles short — visible as a permanent gap.
- **Host renders authoritative state; interpolation is guest-view only.** Drawing remote entities from interpolated snapshots on the host produced visible staleness (paddle gaps in duel). Prototype carries a G-key guest-view toggle to demo interpolation as a guest sees it.
- **Input delay D=4 with prediction: acceptable.** D=5 noticeably worse; D=0 (all-local) feels distinctly better — confirms Q15's D=0 all-local rule.
- **Input redundancy ~10 ticks + stall decay: no gameplay disruption** at 5% loss / 1-tick jitter; loss slider to 30% still playable (redundancy absorbs).
- **Overload policy works:** catch-up cap 5 + slow-motion + banner engages under sustained load and recovers cleanly. Banner reads as warning, not error.

**Mode feel validated (with fixes made during playtest — all now sim rules):**

- Ball/paddle and capsule/paddle collision = **box overlap** (edge contact counts; ball exits via classic offset-deflect, edge contact clamps to sharp ~60° up-and-away). Center-window tests let balls pass through paddle edges and capsules slip past edge contact.
- **Duel ball ownership must be visually signaled** — ball colored by owner (last toucher; attached = catcher). Without it, "who must catch" is unreadable. Owner-colored ball + white outline adopted.
- **Duel paddle separation is wall-constrained** — each paddle moves only as far as the wall allows, leftover shifts to the other; ends flush. Symmetric push-apart left gaps when one paddle was wall-pinned.
- **Multiball drop: only the last ball re-attaches** (all modes, duel included). Per-drop respawn made multiball a liability instead of a buffer.
- **Capsules fall from the just-broken brick's position** (obvious in hindsight; fixed).

**Tuning values confirmed as shipped defaults:** chain tiers 4/7/10, meter costs 30/25/20/40, durations shrink 10 s / speed-up 8 s / mangle 6 s, fill 2/brick + 10/capsule. Live sliders in the prototype allow re-tuning during spec assembly if needed.

**Perf budgets:** sim tick well under 2 ms with 3-guest synthetic load (input-queue + snapshot serialization); render + draw ops within budget for 2 fields on desktop-class hardware. Entry-Android reference-device validation remains for the build phase — prototype is a single canvas-2D file, not the PixiJS renderer, so numbers are directional only.

**Bonus verdict:** the bot AI (ball-chase + meter spending) is good enough to drive a single-player mode — human playtesters could not reliably distinguish its paddle play from a casual remote human. Destination redrawn to include single-player; charted as [Single-player mode design](19-single-player-mode-design.md).

## Comments

### Playtest bug log (fixed in prototype during session)

1. Shared-field prediction clamped to full width, not slice → paddle offset (fixed: p1ClampBounds).
2. Reconcile was dead code (history off-by-one) → duel drift on paddle push (fixed: direct error-offset compare).
3. Attached ball drawn from stale snapshot in duel/shared → ball trailed strafing paddle (fixed: attached-to-P1 rides prediction).
4. Ball passed through paddle edges / paddle slid through ball (fixed: box overlap + offset-deflect).
5. Capsules spawned at field center, not broken brick (fixed).
6. Duel paddle collision unstable, gaps at walls (fixed: wall-constrained separation + host-view rendering).
7. Capsule edge contact didn't catch (fixed: box overlap).
8. Duel prediction ran into bot → permanent gap (fixed: other paddle as prediction wall).
9. Multiball: every dropped ball respawned on paddle (fixed: last ball only).
