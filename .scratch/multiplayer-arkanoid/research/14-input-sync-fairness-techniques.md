# Research: input sync & fairness techniques — findings

Ticket: `../issues/14-input-sync-fairness-techniques.md`
Date: 2026-08-31
Method: primary sources only — Gaffer On Games (Glenn Fiedler) networking articles, GGPO official site + GitHub SDK repo (Tony Cannon), MDN WebRTC DataChannel / data-channel usage guides, web.dev (Chrome team) datachannel article, MDN Gamepad API and Pointer Events guides. No forum folklore; derived engineering judgments are labeled as such.

Prior constraints: Research 02 fixed host-authoritative star (host holds authoritative state, ≤3 guest DataChannels, 20–60 Hz ≈ 45 KB/s, wake lock + Worker tick). Research 03 fixed headless fixed-timestep 60 Hz sim decoupled from render (sim = pure TS module, renderer consumes snapshots). Input mapping (07) fixed the **input frame** seam: per-player per-tick 2D axis `[-1..1]` + buffered edge events (launch, cycle target, fire); keyboard digital full-speed, gamepad/touch stick proportional, mouse chases pointer at full speed; cross-method speed parity deferred to this ticket.

---

## 1. Input synchronization models — fit for a host-authoritative star

Gaffer's taxonomy (all three articles cross-checked):

- **Deterministic lockstep** (Gaffer, *Deterministic Lockstep*): peers exchange *inputs only*; every machine runs the full sim; frame n executes only when all players' inputs for n have arrived. Consequences: (a) each player's latency = the most lagged player ("each player in the game has latency equal to the most lagged player" — same failure that made Doom unplayable over modems, *What Every Programmer Needs To Know About Game Networking*); (b) requires bit-exact cross-platform determinism; (c) Gaffer caps it at "2-4 players at most" (*Snapshot Interpolation*, intro). **Rejected**: contradicts the decided host-authoritative star (all peers equally authoritative by construction) and couples everyone to the worst connection. Our 4-player casual session cannot sit hostage to one lagged phone.
- **Input relay** (client→server inputs, server authoritative): guests send input frames to the host only. Not lockstep: the host never *waits* for a missing input — Gaffer's *State Synchronization* describes exactly this relaxation: "if we don't have the next input we don't stop the simulation and wait for it, we continue extrapolating forward with the last input received." For a paddle whose axis rarely changes, holding the last known axis is a near-perual default. Edge events that arrive late apply on the next tick (a 16–33 ms event slip for that player only — acceptable).
- **State broadcast** (server→clients snapshots): host sends state snapshots; guests reconstruct visually without running the authoritative sim (*Snapshot Interpolation*: "snapshot interpolation doesn't run any simulation on the right side at all").
- **State synchronization** (Gaffer's third strategy, *State Synchronization*): both inputs and state flow; receiver extrapolates between updates. This — plus Gaffer's own advice to "run the simulation at the same framerate on both sides (for example 60HZ)" so the sequence number doubles as the frame number — is the closest label for what we need.

**Verdict:** the decided host-authoritative star **is** the classic client/server model (host = server, guests = clients, WebRTC DataChannels = transport). Gaffer's *What Every Programmer Needs To Know* documents that lineage: Quake → QuakeWorld client-side prediction → authoritative server + prediction + interpolation, the combo every FPS has shipped since. Recommended model: **input relay (guest→host, unreliable+redundant) + state broadcast (host→guest snapshots) + host-side extrapolation of missing guest inputs**. GGPO itself frames the traditional alternative as "adding delay to a player's input" — delay-based lockstep is not our path; we keep input relay and compensate with prediction/interpolation (§2).

**Reliable input over an unreliable channel** — Gaffer's *Deterministic Lockstep* trick applies even though we reject lockstep: send every input frame redundantly in each packet until acked ("redundantly include all inputs in each UDP packet until we know for sure the other side has received them"). Edge events (launch/fire/cycle) ride the input stream; packet redundancy plus the host echoing "last input tick applied per player" in every snapshot makes edge delivery effectively reliable without a reliable-ordered channel's head-of-line stalls. This matters because SCTP reliable-ordered mode stalls behind retransmits (web.dev: "a lost packet causes other packets to get blocked behind it, and the lost packet might be stale by the time it is retransmitted").

**DataChannel configuration** (MDN `RTCDataChannel` + web.dev):
- Input + snapshot channels: `createDataChannel(..., { ordered: false, maxRetransmits: 0 })` → UDP semantics (web.dev: "For UDP semantics, set `maxRetransmits` to 0 and `ordered` to false").
- Control channel (lobby, resync snapshot, pause): default reliable+ordered.
- Keep messages small (≤ ~1 KB): MDN warns large messages without interleaving cause head-of-line blocking across channels; default negotiated max message size is 64 KB — we stay orders of magnitude under it.
- Backpressure: watch `bufferedAmount` / `bufferedAmountLowThreshold` if a guest stalls.

## 2. Latency compensation — local paddle, remote paddles, ball

- **Local player's paddle → client-side prediction.** Gaffer (*What Every Programmer…*, QuakeWorld/Carmack + Sweeney "The Server Is The Man"): client predicts its own avatar immediately from local input; server stays authoritative; client reconciles via rewind-and-replay of buffered inputs when a correction arrives. For our paddle: guest runs the *same* 1-D movement code (axis × Vmax × dt, wall clamp) as a shadow over the input history; render the shadow; on each authoritative snapshot compare at the host tick and reconcile. Because the paddle has no external forces except rare ones (attack effects, rejoin snap, missed-input divergence), corrections are small and rare. **Use error-offset smoothing instead of hard rewind-replay**: Gaffer's *State Synchronization* visual smoothing — render at sim position + error offset, decay the offset exponentially per frame — covers small corrections invisibly; snap outright when the error is large. Full circular-buffer replay is overkill for a 1-D input-driven paddle; the shadow + input history we already keep for redundancy gives us rewind for free if the prototype proves it needed.
- **Remote paddles + the ball → snapshot interpolation.** Gaffer's *Snapshot Interpolation*: buffer snapshots, interpolate between the two most recent, render at (latest − interpolation delay). Rule of thumb: hold ~2–3 snapshot intervals so two consecutive losses still leave something to interpolate toward. Linear interpolation suffices at 30–60 Hz for position-only state (Gaffer needed Hermite at 10 pps; at 60 pps he drops velocity from snapshots entirely — "Linear interpolation is good enough at 60HZ", *Snapshot Compression*). Ball extrapolation is explicitly weak ("as soon as objects start colliding with non-stationary objects, extrapolation starts to break down") — the ball bounces constantly, so **do not extrapolate the ball**; hold-and-catch-up at the interpolation seam instead.
- **Rollback (GGPO) → rejected for v1.** GGPO (ggpo.net): rollback "is designed to be integrated into a fully deterministic peer-to-peer engine" — all peers simulate everything, run ahead on predicted remote inputs, and resimulate from divergence when real inputs land. That is a **peer-symmetric authority model**; it contradicts the decided host-authoritative star (no peer may rewrite authoritative history). Cost side: every guest would resimulate all play fields (2–4 fields × up to ~8 frames) inside the ≤2 ms sim-tick budget Research 13 set for low-end Android — feasible on paper, high complexity in practice. What we adopt from GGPO is its fairness insight (input delay as an equalizer, §4), not its architecture. Flag for the spec: a rollback *upgrade path* for Duel would require guest-side full determinism — see §7 flag 2.

**Recommended numbers:**
- Input frames: 60 Hz per local tick, redundant window = frames since last host ack (cap ~15 ≈ 250 ms).
- Snapshots: **30 Hz baseline, 60 Hz for Duel** (shared field = highest reaction demands; Research 02 already validated 20–60 Hz ≈ 45 KB/s, bandwidth is not the constraint). Effective remote-view latency ≈ ½RTT + 2–3 intervals ≈ 110–145 ms @ 30 Hz, ≈ 75–95 ms @ 60 Hz — inside the range classic action games shipped with for decades (Gaffer's own demos target that band).

## 3. Tick alignment and clock sync

- **The host tick is the timeline.** No wall-clock synchronization is required: guests never run the authoritative sim. Snapshots carry (host tick, state, per-player last-input-tick ack). Gaffer (*State Synchronization*): same-framerate both sides lets the sequence number double as the frame number — our fixed 60 Hz both sides gives that for free.
- **Guest→host mapping:** guest samples one input frame per local 60 Hz tick (rAF-accumulator loop, same discipline as the sim seam), sends batches tagged with guest tick; host applies each frame to the first host tick after arrival and acks the highest applied tick. Guest keeps unacked frames (they ARE the redundancy payload + prediction history). Clock drift between devices is absorbed by the host-arrival rule — there is no shared tick counter to keep in lockstep.
- **RTT estimate:** `RTCPeerConnection.getStats()` exposes current round-trip time; use it (or a lightweight ping-pong on the control channel) for the guest's interpolation-delay calibration and HUD, not for authority. Gaffer's dedicated clock-sync article is no longer reachable (dead link on gafferongames.com, archive 404 — noted in uncertainties); its function here is subsumed by tick-tagged snapshots + the jitter buffer discipline from *State Synchronization* ("delay packets just enough (say 4-5 frames @ 60HZ) so that they come out of the buffer properly spaced apart").
- **Adaptive interpolation delay:** start at 2.5 snapshot intervals; widen by ±0.5 interval on sustained late-snapshot runs (derived policy, engineering judgment — validate in the game-feel prototype).

## 4. Input-delay approaches and competitive fairness

The asymmetry in a host-authoritative star: the host samples input and applies it the same tick, and renders the authoritative ball with zero pipeline delay; a guest's own paddle is prediction-masked (0 ms feel), but the guest *reads* the ball ½RTT + interpolation-delay late, and their paddle's *effect on the ball* lands ~½RTT after their intent. So the host enjoys a genuine reaction advantage in competitive modes.

- **GGPO's framing** (ggpo.net): traditional netcode hides transmission time by "adding delay to a player's input, resulting in a sluggish, laggy game-feel"; rollback removes the delay by predicting. We reject rollback (§2) but invert the delay trick — apply it to the *host only*, equalizing reaction windows instead of degrading everyone.
- **Recommendation: host-side fixed input delay in competitive modes only.** Host samples its players' input frames but schedules them for tick N+D (D = 3–5 ticks ≈ 50–83 ms, lobby-configurable, default 4 ≈ 66 ms ≈ typical guest view delay). Host still simulates tick N on schedule (its paddles move from tick N−D's frames — pure bookkeeping at the input queue). Coop modes: D = 0 (no fairness requirement). This is the classic delay-based equalizer, applied surgically where it's cheap.
- **Residual unfairness to accept:** guest-vs-guest asymmetries (different RTTs) and the host's ~0 ms *ball-read* minus D remain; full symmetry requires peer-symmetric rollback (rejected, §2). Flag in the spec: competitive remote play is "fair-ish," not frame-perfect; the game-feel prototype should A/B D values.
- Coop pause / guest rejoin are already settled (ticket 06); the rejoin snapshot resync rides the reliable control channel — no new technique needed.

## 5. Cross-input-method paddle-speed normalization

Facts from the input APIs (MDN):
- Gamepad axes are floats in `[-1.0..1.0]` (analog proportional, natively); buttons poll per frame; a standard mapping exists (`mapping: "standard"`).
- Mouse and touch are positional events (Pointer Events: one event model, `pointerType` distinguishes mouse/touch/pen); they carry position, not rate.
- Keyboard is digital.

The sim contract (CONTEXT.md, *input frame*) already says the sim sees only an axis in `[-1..1]`. **Normalization principle: paddle speed = Vmax × |axis|, with Vmax a single sim constant for all players; every adapter must saturate at |axis| = 1 and never emit positional teleports.** Per-method adapter behavior:

| Method | Adapter output | Notes |
|---|---|---|
| Keyboard | axis = −1/0/+1 from held keys | Digital full speed; full-speed parity by construction |
| Gamepad/touch stick | axis = stick deflection, radial deadzone ≈ 0.2 (kills drift), soft cap at 1.0 | Proportional *below* max is method identity, not a parity breach; optional response curve (e.g. square) is a per-method feel choice — max speed unchanged |
| Mouse | axis = ±1 toward pointer while \|pointer − paddle\| > capture deadzone (~half paddle width), else 0 | "Chase at full speed" (decided, ticket 07) expressed as a **binary axis** — identical to keyboard at the sim seam |
| Touch drag | axis = ±1 while dragging beyond threshold | Same binary-axis rule as mouse |

Why the mouse must chase rather than teleport: a positional mouse (set paddle = pointer) (a) exceeds Vmax, breaking cross-method parity in exactly the remote-competitive case this ticket exists for; (b) emits state, not rate, so host clamping would fight the client prediction with constant corrections; (c) the decided behavior is already chase — this confirms it. Fairness residual: methods differ in *precision and effort* (analog fine control; mouse holds full speed effortlessly), not in *maximum capability* — the standard competitive compromise, and the sim cannot tell methods apart (it never sees devices). Derived recommendation, grounded in the ticket-07 decisions and API facts; validate feel in the prototype.

## 6. Recommended technique set (for the spec / Netcode sync architecture)

| Concern | Recommendation | Evidence |
|---|---|---|
| **Sync model** | Host-authoritative input relay + state broadcast (client/server pattern over WebRTC): guests → host input frames; host → guests snapshots; host continues with last known axis on missing input, never blocks on a player | Gaffer *State Synchronization*, *What Every Programmer Needs To Know*; GGPO.net (delay-based alternative framing) |
| **Channels** | 3 per guest: input `{ordered:false, maxRetransmits:0}` 60 Hz redundant frames; snapshots `{ordered:false, maxRetransmits:0}` 30 Hz (60 Hz Duel); control reliable-ordered (lobby/resync/pause). Messages ≤ ~1 KB; `bufferedAmountLowThreshold` backpressure | MDN RTCDataChannel, MDN Using data channels, web.dev datachannels |
| **Local paddle** | Client-side prediction (shadow + input history), error-offset smoothing reconcile, hard snap on large error (rejoin/attacks) | Gaffer *What Every Programmer…* (QuakeWorld), *State Synchronization* visual smoothing |
| **Remote paddles + ball** | Snapshot interpolation, render at latest − (2.5 intervals, adaptive); no ball extrapolation | Gaffer *Snapshot Interpolation*, *Snapshot Compression* (60 Hz linear suffices) |
| **Tick alignment** | Host tick = timeline; guest frames applied on arrival tick, acked in snapshots; no wall-clock sync; RTT via getStats for calibration only | Gaffer *State Synchronization* (same-rate, seq = frame), jitter-buffer guidance |
| **Fairness** | Host-side fixed input delay 3–5 ticks (default 4 ≈ 66 ms), competitive modes only, lobby-configurable; coop D=0; residual asymmetry accepted | GGPO.net (delay framing); derived equalizer policy |
| **Paddle parity** | axis-only seam, single Vmax; keyboard ±1; stick = deflection w/ deadzone; mouse/touch = binary chase axis ±1; no positional writes | MDN Gamepad/Pointer docs; CONTEXT.md input frame; ticket 07 decisions |
| **Rollback** | Not in v1; documented upgrade path for Duel requires peer-symmetric determinism (rejected) | GGPO.net; Gaffer *Floating Point Determinism* |

## 7. Contradictions and flags against prior decisions

1. **Lockstep/GGPO vs host-authoritative star** — direct architectural conflict; both rejected cleanly, decisions intact. No change needed.
2. **"Fixed 60 Hz deterministic sim" (prior wording) overstates the requirement.** With host-authoritative state broadcast, *no cross-browser determinism is ever exercised* — only the guest's local-paddle prediction runs sim-adjacent code, and that is 1-D arithmetic (add/multiply/clamp) which JS guarantees IEEE-754-exact. The spec should downgrade "deterministic sim" to "deterministic-order sim on the host" (fixed timestep, stable iteration order — still required for replays/tests), and record the constraint that any future guest-side sim sharing (rollback, ball prediction) must avoid implementation-defined `Math.*` transcendentals across engines (Gaffer, *Floating Point Determinism*; JS arithmetic is spec-exact, `Math.sin/pow/…` are not — derived, flagged for prototype verification).
3. **Snapshot interpolation delay is irreducible without rollback** — guests read the ball 75–145 ms late in every mode. Not a contradiction (nothing prior promised guest zero-latency), but the spec must set this expectation; the 60 Hz Duel option exists to shrink it.
4. **Research 13's ≤2 ms host sim budget gains a second duty** — host now also runs input queues + snapshot serialization per tick; still trivial arithmetic vs the draw-call-bound renderer, but the game-feel prototype should measure host tick time with 3 guests attached.

## Open uncertainties

1. **Adaptive interpolation-delay policy** (2.5 intervals ± jitter reaction) is derived, not sourced — tune in the game-feel prototype with synthetic loss/jitter (Chrome DevTools network throttling on the DataChannel or a test harness).
2. **Host input-delay value D** — 3–5 ticks is an estimate from typical ½RTT+interp figures; A/B test in the prototype; wrong-too-high just feels laggy for the host, wrong-too-low keeps the host advantage.
3. **Gaffer's clock-synchronization article is unreachable** (live 404, archive 404) — tick-tagged snapshots make it moot for v1; if absolute time sync ever matters (e.g., shared replays), re-research from his book *Networking for Game Programmers*.
4. **Deadzone/capture-deadzone constants** (0.2 stick, half-paddle mouse capture) are feel parameters — prototype territory, not sourceable facts.
5. **SCTP partial-reliability interplay with redundancy** — we chose maxRetransmits:0 + app-level redundancy over maxPacketLifeTime variants; the trade (in-order loss bursts vs stale retransmits) deserves a synthetic-network test in the prototype.
6. **JS `Math.*` cross-engine determinism claim** (flag 2's future constraint) is derived from ECMAScript semantics knowledge, not from a fetched primary source — verify empirically (V8 vs SpiderMonkey) before any guest-side-sim feature relies on it.

---

Sources (fetched 2026-08-31): gafferongames.com — "What Every Programmer Needs To Know About Game Networking" (Feb 2010), "Deterministic Lockstep" (Nov 2014), "Snapshot Interpolation" (Nov 2014), "Snapshot Compression" (Jan 2015), "State Synchronization" (Jan 2015), "Floating Point Determinism" (Feb 2010); ggpo.net (GGPO Rollback Networking SDK — official description of rollback vs delay-based netcode); github.com/pond3r/ggpo (MIT-licensed SDK, Vector War sample, doc/images); developer.mozilla.org — RTCDataChannel reference, "Using WebRTC data channels" (Jun 2026), "Using the Gamepad API" (Apr 2026), "Pointer events" (Aug 2026); web.dev — "Send data between browsers with WebRTC data channels" (Dan Ristic & Sam Dutton; SCTP TCP/UDP/configurable-delivery table, UDP-semantics configuration, multiplayer gaming use, BananaBread precedent).
