# Research: input sync & fairness techniques

Type: research
Status: resolved

## Question

Which synchronization techniques give fair, smooth real-time play for a host-authoritative P2P browser game — and how should cross-input-method paddle speed be normalized?

Establish: input synchronization models (lockstep vs input relay vs state broadcast) and their fit for a host-authoritative star topology; latency compensation (client prediction, GGPO-style rollback, interpolation of remote paddles and the ball); tick alignment and clock sync between host and guests; input-delay approaches to competitive fairness; how competitive games normalize movement speed across input methods (digital keyboard vs analog stick vs positional mouse) without breaking game feel. Primary sources: Gaffer On Games, GGPO documentation and articles, MDN WebRTC docs, WebRTC game postmortems.

Deliver: recommended sync + fairness technique set for the spec's netcode (informs Netcode sync architecture) and a normalization approach for paddle movement across input methods (refines the normalization principle recorded in Input mapping design).

## Answer

Full findings with evidence: [`../research/14-input-sync-fairness-techniques.md`](../research/14-input-sync-fairness-techniques.md)

- **Sync model:** host-authoritative input relay + state broadcast (classic client/server over WebRTC DataChannels) — guests send 60 Hz input frames on an unreliable+redundant channel; host never blocks on a missing player (continues with last axis); host broadcasts 30 Hz snapshots (60 Hz for Duel). Lockstep and GGPO rollback both rejected: peer-symmetric authority contradicts the host-authoritative star, and lockstep couples all players to the most lagged one.
- **Latency compensation:** client-side prediction for the local paddle only (shadow sim + input history + error-offset smoothing reconcile); snapshot interpolation for remote paddles and the ball (render at latest − ~2.5 intervals, adaptive; never extrapolate the ball — it collides too much). Rollback documented as a rejected v1 upgrade path for Duel.
- **Tick alignment:** the host tick is the timeline — no wall-clock sync. Guest frames apply on arrival tick and are acked inside every snapshot; unacked frames double as the redundant resend payload. RTT via `getStats()` is calibration/UX only.
- **Fairness:** host-only fixed input delay D = 3–5 ticks (default 4 ≈ 66 ms), competitive modes only, lobby-configurable; coop D = 0. Equalizes the host's zero-pipeline advantage; residual guest-vs-guest RTT asymmetry accepted (full parity needs rollback, rejected).
- **Paddle-speed normalization:** sim sees only the input frame axis; single Vmax for all players, speed = Vmax × |axis|. Keyboard and mouse/touch chase emit binary ±1/0 (mouse chases the pointer at full speed — no positional writes); gamepad/touch stick = deflection with ~0.2 radial deadzone, soft cap 1. Methods differ in feel below max speed, never in max capability — parity the sim can verify.
- **Flags:** (1) "deterministic sim" should be downgraded to host-side deterministic-order sim — nothing cross-browser is ever exercised by this architecture; (2) interpolation delay means guests read the ball 75–145 ms late, irreducible without rollback — Duel uses 60 Hz snapshots to shrink it; (3) host tick budget (Research 13 ≤ 2 ms) gains input-queue + snapshot-serialization duty — measure with 3 guests in the prototype.

### Prototype amendment (Game-feel prototype, ticket 16)

- **Prediction + error-offset reconcile: validated in playtest.** Sharpened shape: direct per-tick compare (authoritative x vs predicted x), snap prediction to authoritative on divergence, fold the difference into a display offset decaying ~0.5 s. Prediction must clamp to every sim constraint (walls, shared-field slice, duel other-paddle) or reconcile misreads constraints as error and the display settles short.
- **D=4 default: confirmed** acceptable with prediction; D=5 noticeably worse; D=0 all-local distinctly better (confirms the D=0 rule).
- **Flag 3 (host tick budget with 3-guest duty): measured in prototype** — sim tick stays well under the 2 ms budget with synthetic 3-guest input-queue + snapshot-serialization load.
