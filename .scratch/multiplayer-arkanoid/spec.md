# Multiplayer Arkanoid — Implementation-Ready Spec

Status: assembled 2026-09-02 from all resolved wayfinder tickets (01–19, 21) + research (20). Human review: passed 2026-09-02 (one amendment: Playwright e2e added to §3/§17).
Vocabulary: `CONTEXT.md` at repo root is canonical — Capsule (not power-up), Play field (not level/arena), Round (one level), Match, Episode, Input frame, Snapshot, Field region, HUD strip. This spec uses that vocabulary throughout.

## 1. Overview

A multiplayer Arkanoid for PC/Mac/Android web browsers: split-screen and remote play combinable in one session, up to 4 players (max 4 local per desktop device, max 2 local per mobile device), keyboard/mouse/gamepad/touch input, competitive (Race/Attack/Duel) and coop (Shared field/Parallel assist) modes, single-player (Solo + Versus bots), customizable player skins and host-chosen field themes, full classic content (33 rounds, Doh finale), free infrastructure only (P2P WebRTC + Cloudflare Workers + GitHub Pages), multilingual UI (es-419 + en-US).

Every decision below is locked. Values marked **[authoring]** are concrete data to produce/verify during content authoring — no design choice remains, only data entry against the stated shape.

## 2. Architecture

Headless, fixed-timestep (60 Hz) deterministic-order simulation as the core module; every renderer is a pure consumer of state. The sim never touches DOM, Pixi, or network — it consumes Input frames and emits state + events.

Module map (greenfield TypeScript, one repo):

```
sim/        headless core: fields, paddles, balls, bricks, capsules, meters,
            effects, scoring, round/match state machines, bot input source
net/        host-authoritative pipeline: delay queue, snapshot serializer,
            channels, guest prediction + interpolation, rejoin, heartbeat
signaling/  room-code WebSocket client + manual copy-paste fallback
render/     PixiJS v8: snapshot→scene sync, split-screen composition, HUD,
            touch overlay, skins/themes
input/      device adapters: keyboard, mouse, gamepad, touch → Input frame
ui/         landing, lobby, settings, pause, end screens, i18n string tables
content/    level JSON, capsule scripts, scoring tables, skin/theme registries
audio/      SFX + music engine
persistence/ localStorage wrapper
```

Seams (hard boundaries, enforced by lint rules on imports):
- **Input frame seam** — `input/` → `sim/`: per-player, per-tick normalized frame only (§11).
- **Sim/render seam** — `sim/` emits state; `render/` reads snapshots, never sim internals. Host renders authoritative state; interpolation is guest-view only.
- **Net seam** — `net/` moves Input frames and Snapshots; `sim/` is net-agnostic (bots prove it: same pipeline, no network).

ADRs (binding): [0001 no host migration](../../docs/adr/0001-no-host-migration.md), [0002 host-authoritative netcode](../../docs/adr/0002-host-authoritative-netcode.md), [0003 trust the host](../../docs/adr/0003-trust-the-host.md).

## 3. Stack

- **PixiJS v8** (8.20.1) — rendering library, not framework. WebGL with automatic Canvas fallback (v8.16+) for no-WebGL devices only (unsupported-class-only, never user-selectable, never a perf floor).
- **TypeScript** (strict), **Vite**, **Vitest**, **Playwright** (browser e2e).
- Hand-built (accepted trade-off): split-screen composition, rAF/accumulator loop, keyboard/gamepad glue — all behind the seams above.
- Renderer config: `antialias: false`, `useContextAlpha: false`, no advanced blend modes (broken at non-Po2 dpr), BitmapText for per-frame text, `@0.5x` atlas shipped, one WebGL context per device, `webglcontextrestored` = resync-from-snapshot.
- Attribution: content DNA from ball-and-wall (MIT) if copied — carry MIT notice.

## 4. Content set

- **33 rounds**, single numbered sequence; round 33 = **Doh** boss. In scope: Race, both coop variants, Solo. Excluded: Duel (draws rounds 1–32), Attack (Doh excluded — attack triggers on level clear conflict with a boss round; rounds 1–32).
- **Bricks**: standard (colored, 1-hit, point tiers by color), silver (multi-hit), gold (indestructible, layout walls). No regenerating, no multiplayer-only bricks.
- **Silver hits**: `min(1 + floor(round / 8), 4)`.
- **Capsule roster (10)**: B (Break — fly through the exit = round clear, standard clear points, no bonus; counts as clear in every respect incl. win condition, attack trigger, timeout progression), C (Catch), D (Disrupt), E (Expand), L (Laser), M (Multiball), P (Player — extra life), S (Slow), R (Reduce, negative), ? (Random). Cut: T (Twin), 1/2 (warp).
- **Drops — deterministic capsule script per level**: fixed count 6–10, fixed release order, each bound to a specific brick-break count, encoded in level data. Zero RNG. `?` resolves to the next undropped scripted capsule for that level; E fallback when script exhausted. Player-opaque.
- **Difficulty knobs in level JSON**: per-round base ball speed; in-level speed tier bumps at ≤15 and ≤8 bricks remaining.
- **Level format**: JSON per level — char grid 13 cols × 18 rows **[authoring: exact dims verified]** + metadata (capsule script, base speed, silver-hit override, scoring overrides). Legend: `.` empty, letters = brick colors, `S` silver, `G` gold. Hand-editable.
- **Scoring**: classic-accurate table in content data **[authoring: exact values]** — colored tiers ~50–120, silver pays per hit, gold 0, capsule catch bonus, level clear bonus. Duel drop bonus = 500 (prototype-validated).
- **Capsule effect behaviors** (durations, what clears on ball loss): classic-accurate **[authoring]**.

## 5. Core sim rules (prototype-validated)

- **Logical units**: play field 208 × 256; brick cell 16 × 8 (≈2:1), grid 13 × 18, brick area top offset 20; paddle zone below. Paddle 32 × 6 at y = 242; ball radius 3; capsule 12 × 6 falling at 45 u/s. Base ball speed per level JSON (prototype reference: 110 for round 1).
- **Collision = box overlap** (edge contact counts) for ball/paddle and capsule/paddle; ball exits via classic offset-deflect; edge contact clamps to sharp ~60° up-and-away.
- **Paddle model**: single Vmax = 150 u/s for all players; speed = Vmax × |axis|. Keyboard/mouse-chase/touch-drag emit binary ±1/0; stick proportional with 0.2 radial deadzone, soft cap 1. Methods differ in feel below max speed, never in max capability.
- **Multiball drop**: only the last ball re-attaches to the paddle (all modes, Duel included). Other dropped balls are simply lost (Duel: drop bonus paid to opponent).
- **Capsules spawn at the just-broken brick's position.**
- **Duel paddle separation is wall-constrained**: each paddle moves only as far as the wall allows, leftover shift goes to the other; ends flush.
- **Serve**: attach-and-launch; ball attached to paddle, owner launches. Move live during countdown + serve; launch ignored until countdown ends.
- **Control mangle** (attack effect): sim-side — input frame arrives honest, sim corrupts the consumed axis per tick (invert/jitter). Hits every input method equally.

## 6. Modes

### 6.1 Solo (single-player)

- One human, one field, rounds 1–33, Doh finale. No lobby, no bots — straight from landing to game.
- 3 lives (classic-accurate), score accumulates across the run, round advances on clear.
- Game over → **Continue**: resume from current round N with fresh 3 lives, **score reduced by 60%** (>50% per design ruling; 60 locked as the shipped value), or **Restart episode** (score 0, round 1).
- localStorage: highest round reached + high score. No difficulty select — the 33-round curve is the difficulty.
- Pause freely (coop semantics).

### 6.2 Versus bots (single-player)

- Every multiplayer variant playable solo: Race/Attack (1–3 bots), Duel (1 bot), Shared field / Parallel assist (1–3 bot teammates). Exactly 1 human + N bots — never bots alongside >1 human.
- Trimmed lobby config (no room code, no ready check): variant picker with player-count validation, match structure, difficulty selector (session-wide, default Normal).
- Same host-authoritative pipeline: bot = host-local input source through the standard delay queue, D = 0, net module idle. One code path.
- Pause freely (coop semantics) — "competitive no-pause" is about remote fairness, absent here.

### 6.3 Competitive (multiplayer)

All lobby-configurable where marked. All players always get the identical level (fairness).

**Common**: lives 5; 0 lives → current level resets (fresh layout, lives restored) — cost is time. Power-up roster fully active. Match structure (configurable): best-of-N rounds / continuous episode race / one-off single level. Level selection (configurable): host-pick per round / fixed episode order / random. Round time cap (configurable): finite or infinite. Timeout resolution: round-based → most bricks that round; continuous → furthest along (levels cleared, then bricks in current); one-off → most bricks; exact tie → draw, no round point, next level.

**Race** (2–4): identical parallel fields, first to clear wins round/match per structure.

**Attack** (2–4): Race win conditions — attacks are interference, not a win path. Triggers (each lobby-toggleable, all-on default): chains (N consecutive bricks without paddle touch — bigger = stronger), capsule capture (small attack), level clear (continuous structure only), charged manual (shared attack meter, filled by brick breaks, each button fires a different attack type at a manually picked target). Effects: brick rain (scaled by trigger), paddle shrink (temp), ball speed up (temp), control mangle (temp). Stacking: same-type refreshes duration, different types independent. Mid-level-reset targets immune; manual attacks auto-retarget.

**Duel** (exactly 2): shared field, both paddles bottom side-by-side, solid to each other (block, never overlap). No lives, no reset — ball drop grants opponent +500. Ball model (lobby choice): shared ball with steal-on-touch, or owned balls with deflect-only (no transfer); multiball = per-ball last-toucher. Ball ownership visually signaled: ball colored by owner + white outline (§13 constraint). Round ends on field clear or timeout; winner = most points (brick points to ball owner + drop bonuses). Timeout tie → draw.

### 6.4 Coop (multiplayer)

Both variants: 2–4 players, max 2 local per device, continuous play-through of lobby-chosen level range (episode), no rounds/best-of/time cap. Win = team clears range; lose = life failure.

**Shared field**: one field, shared team life pool = **3 × player count** (2P = 6, 3P = 9, 4P = 12). Lobby-configures paddle placement + ball model (shared / per-player color-coded):
- Placement A (bottom edge): paddles side-by-side, each owns a slice, movement confined to slice.
- Placement B (multiple edges): fixed order — 2P bottom+right, 3P +left, 4P +top. Paddle edges open (miss = ball lost), non-paddle edges walls, bottom always open. Side paddles move vertically; top paddle = normal bounce surface; ball hits bricks from any direction.
- Placement C (shared paddle): one paddle, free-for-all summed inputs (axis sum, clamp ±1); center drop serve, any player launches.
- Ball: attach-and-launch serve; per-player model respawns toward owner's paddle. Life lost when ball count hits zero (per player or field, by model) — multiball is a buffer. Multiball splits the capturing player's ball only. Capsules affect capturer's paddle only (placement C: the shared paddle).
- Scaling: ball speed +5–8% per player beyond 2 (placements A/B; C exempt). No brick scaling. No assist meter — cooperation is positional.

**Parallel assist**: separate fields, shared score, per-player lives (5). Downed at 0 lives: field frozen, spectates, no meter income; life gift is the only revival (revive = 1 life, ball attached, owner launches). Assist meter (same fill rules as attack meter): power-up gift (send captured capsule to teammate's field) — cost 20; brick clear (remove 8 lowest bricks in teammate's field) — cost 30; life gift — cost 40 (life created by spend, never transferred; no self life gift). Downed players keep spend rights (gift/clear, not self-life); early clearer spectates with full gift rights incl. life gift. Team wins when last player clears; loses when all downed simultaneously. No ball-speed scaling.

### 6.5 Attack/assist economy (prototype-validated defaults, live-tunable)

- Chain tiers: ≥4 / ≥7 / ≥10 bricks = small / medium / large attack.
- Meter costs (of 100): brick rain 30, paddle shrink 25, ball speed up 20, control mangle 40.
- Magnitudes: rain 3/6/12 bricks (by tier), shrink 40%, speed +30%, mangle duration 6 s.
- Effect durations: shrink 10 s, speed-up 8 s, mangle 6 s.
- Meter fill: 2 per brick + 10 per capsule catch.

## 7. Bots

Same bot code, three parameter sets (Easy/Normal/Hard) — knobs, not separate logic. Session-wide selector, default Normal, solo unaffected.

| Knob | Easy | Normal | Hard |
|---|---|---|---|
| Aim noise (error added to target x) | ±24 u | ±8 u | ±2 u |
| Tracking engagement (lock onto descending ball at) | y > 0.65 × field height | y > 0.40 | y > 0.25 |
| Launch timing | random 60–240 ticks | ~97 ± 30 ticks | 40–120 ticks |
| Meter-spend threshold | ≥80, hoards | ≥30 | ≥20 |
| Fire chance / tick | 0.2% | 0.8% | 1.5% |
| Target quality | random | random | smart (Race leader; downed teammate first in assist) |

Normal ≈ prototype behavior + small aim noise. Bot input frames enter the same delay queue as any local player (D=0). Bots get auto-assigned distinct skins, never colliding with the human's choice.

## 8. Session & lobby flow

**Landing — three entries**: Solo (straight to game) / Versus bots (trimmed config) / Multiplayer (room code).

**Room code**: 5 chars from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no lookalikes). Create shows code large; Join = 5 auto-advancing boxes. **QR share**: lobby shows QR encoding `https://<host>/?code=XXXXX` (client-side generation, no infra); landing reads `?code=` and prefills join.

**Local players**: "Add local player" in lobby — desktop max 4/device, mobile max 2 (touch = 1 player, 2nd = gamepad), session cap 4. Addable any time before start.

**Configuration**: host-only; guests see live read-only panel. Config change resets all ready checks. Mode picker disables invalid variants for player count (Duel greyed unless exactly 2; all need ≥2).

**Ready & start**: every player (incl. host locals) marks ready; host Start enabled only when all ready (between-match joiners start unready; existing keep state). Start → synchronized 3-2-1 countdown → serve.

**Late-join**: none mid-game; code entry during game → "Game in progress". Lobby-join between matches OK (freed slots open); room lives until host quits/closes tab; same code whole session.

**Guest disconnect**: 90 s rejoin window — paddle freezes in place, play continues (ball lost = life lost as normal). Re-enter code → auto-rejoin held slot, resync from snapshot. Expiry → removal: competitive = field eliminated (loss), coop = slot gone, not revivable. Removed players can't return that match.

**Host disconnect**: session dies for all (ADR 0001) — "Host left — session ended".

**Kick**: host-only, both moments — lobby (before start) and mid-session (removal semantics). Auto-accept lobby joins; strangers handled by kick.

**Between rounds**: competitive end screen → Rematch (same config, all auto-ready) / Return to lobby / Quit. Coop: level clear → auto-transition next level; game over or range cleared → end screen → Return to lobby / Quit.

**Pause**: competitive remote = no pause (quit-confirm overlay only, sim never pauses). Coop = any player requests → host pauses sim for all ("Paused by P3"); requester cancels, any player resumes. Solo + versus bots = pause freely, coop semantics. Local split-screen pause always pauses the whole device view.

## 9. Netcode (ADR 0002, prototype-validated)

- **Model**: host-authoritative input relay + state broadcast. Guests send 60 Hz input frames (unreliable+redundant game channel); host simulates fixed 60 Hz; broadcasts 30 Hz snapshots (60 Hz for Duel). Lockstep/rollback rejected.
- **Uniform pipeline**: host-local players' frames (and bots) enter the same tick-D delay queue as guest frames — host skips only the network hop. D = 3–5 ticks competitive remote (default 4 ≈ 66 ms, lobby-configurable); D = 0 coop remote; D = 0 all-local (incl. solo + versus bots).
- **Channels per guest**: game (unreliable, unordered — input frames ↑, snapshots ↓) + control (reliable, ordered — lobby, rejoin, pause, version handshake). Binary (ArrayBuffer/DataView) on game; JSON on control.
- **Snapshot**: full state every broadcast tick, no deltas — tick, phase, per-player input acks, kinematics (paddles, balls, falling capsules), snapped state (brick grid, scores, meters, effect timers), event ring buffer (last 8: type, source, target, tick) for one-shot visuals. ≈600 B ≈ 18 KB/s/guest at 30 Hz (budget ~45 KB/s).
- **Loss**: input redundancy window ~10 ticks (validated: clean at 5% loss/jitter, playable at 30%); host dedupes by (player, tick). Snapshots carry no redundancy — guest interpolation buffer (latest − ~2.5 intervals, adaptive) absorbs gaps.
- **Prediction (guest, local paddle only)**: shadow sim + input history; reconcile = direct per-tick compare, snap to authoritative, fold difference into display offset decaying ~0.5 s. Prediction must clamp to every sim constraint (walls, shared-field slice, Duel other-paddle-as-wall) or the display settles short.
- **Interpolation**: remote paddles/balls only, guest-view only; host renders authoritative state. Never extrapolate the ball. Guests read the ball 75–145 ms late (irreducible without rollback; Duel's 60 Hz shrinks it).
- **Input stall decay**: host holds last axis ≤10 missing ticks, then decays to 0 — stalled paddle stops.
- **Disconnect detection**: DataChannel close OR heartbeat (guest ping 5 s, drop at ~10–15 s silence), whichever first → 90 s rejoin window. Guest blind period: prediction continues, remote entities freeze, reconnect banner after ~1 s snapshot silence; session-over at control close or ~10–15 s silence.
- **Rejoin**: join-with-original-player-id on control channel → host validates held slot → rejoin-ack + full snapshot → guest rebuilds, wipes prediction history.
- **Version handshake**: protocol version int in join; mismatch → join refused, "refresh your browser".
- **Host overload**: catch-up cap 5 sim ticks/render frame; sustained overload → slow-motion degradation, snapshots keep 30 Hz wall-clock, throttle warning banner (validated: engages/recovers cleanly).
- **Structural validation (mandatory, both directions — robustness, not anti-cheat)**: host clamps guest axes to [-1..1], ignores unknown action types, dedupes (player, tick), caps input-frame rate. Guest: malformed binary snapshot or control JSON = protocol error → clean session-end ("Connection corrupted — session ended"), never a crash.

## 10. Signaling & infrastructure (free only)

- **Hosting**: GitHub Pages (git-push deploys, auto-HTTPS); Cloudflare Pages fallback; optional itch.io mirror.
- **Signaling (primary)**: Cloudflare Worker + Durable Object per room — `idFromName(<code>)`, SQLite-backed, WebSocket Hibernation (idle host socket free; ~10k sessions/day inside free tier). Worker front door validates code charset `^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$` + Origin allowlist before WS upgrade. Host holds signaling WS all session (discoverable for between-match joins + rejoin); guest closes WS once DataChannel opens — DO never sees game data. Deploy rarely (deploys disconnect DO sockets; clients auto-reconnect).
- **Signaling (fallback)**: manual copy-paste — non-trickle SDP (ICE bundled), gzip via `CompressionStream` + base64 ≈ one chat message each way; auto-offered on WS failure + "Advanced: manual join". Zero infra; doubles as dev-mode connector. Failure UX fail-closed: "Room not found" / "Server unavailable" → offer copy-paste. Signaling failure never fatal to in-progress sessions (game traffic is P2P).
- **ICE**: Google STUN (`stun.l.google.com:19302`) + Open Relay STUN secondary; Open Relay TURN fallback (ports 80/443, UDP/TCP/TLS). TURN credentials via free Cloudflare Worker calling Metered's expiring-credential REST API server-side (secret in Worker, ~1 h TTL, origin-allowlisted) — long-lived key never ships client-side. Worker failure only degrades TURN (STUN-direct still works). Verify Metered free quota (20 GB vs 500 MB conflict) at signup; abuse response = detection (labels, quota webhooks, credential disable).
- **Host tab backgrounding**: wake lock + Worker/timer-driven host tick; WebRTC-in-use exempts intensive throttling, not freeze — pause-and-resync on visibility.
- **Rejected**: Trystero public brokers, PeerJS cloud, Ably/Supabase/Firebase/PartyKit, lockstep/rollback, paid anything.

## 11. Input

**Capacity**: desktop up to 4 local (any mix keyboard/mouse/gamepad; mouse = 1 slot — single pointer); mobile up to 2 (touch = 1 player, 2nd = gamepad).

**Defaults** (keyboard fully rebindable incl. menu keys; gamepad buttons rebindable, movement fixed; touch/mouse fixed):
- Keyboard P1: `←`/`→` move, `Space` launch, `,`/`.` cycle target, `1`–`4` fire. P2: `A`/`D`, `W` launch, `Z`/`C` cycle, `R`/`T`/`F`/`G` fire. Solo: both keysets drive P1. 4-on-keyboard via rebinding; note ~6-key rollover caveat on cheap keyboards.
- Mouse: paddle chases pointer at full speed beyond small dead band (binary ±1/0, parity with keyboard max); click = launch; HUD panel clickable; wheel unmapped.
- Gamepad: left stick (0.2 deadzone) and d-pad both always live — stick beyond deadzone wins, no summing. `A`/Cross launch, `LB`/`RB` cycle, `X`/`Y`/`B`/`RT` fire (4 slots). `Start` pause/menu. Mid-game disconnect → input idle, player stays in session (rejoin window logic).
- Touch: virtual-stick + button overlay anchored to player's own field region — left thumb stick (proportional, 0.2 deadzone), right thumb context cluster (Launch; Attack: 4 attack + cycle; Assist: 3 assist + cycle). Buttons ≥48 px, semi-transparent, faint-visible always, brighten on active touch, multi-touch supported. Menus: tap targets ≥48 px, zero hover dependencies.

**Action model**: cycle target forward/back + fire type 1–4 (Attack: rain/shrink/speed/mangle; Assist: gift/clear/life — 3 buttons). Target = cycle; type = which button.

**Input frame (the seam)**: per-player, per-sim-tick — 2D move axis [-1..1] (horizontal paddles consume x; placement-B side paddles consume y; keyboard quantizes to −1/0/+1), launch edge-event, action edge-events (cycle/fire), buffered max 1 per action per tick; axis sampled at tick boundary. Device adapters own all quirks; sim sees only the frame.

**Pause/quit input**: coop/solo — `Esc`/`Start`/touch pause icon (top corner, out of drag zone) → pause request. Competitive remote — same inputs open quit-confirm only.

**Menus**: any local input navigates any menu (first input takes focus); rebind screen per-player (tab between local players' maps); duplicate bindings rejected with highlight, checked across all local players' maps on the device. Stored in localStorage per device.

## 12. Rendering & layout

- **Field geometry**: fixed logical 208 × 256 per play field, letterboxed inside its region, fractional scale allowed, devicePixelRatio capped at `min(dpr, 2)`.
- **Desktop**: N-across equal-width columns for N ≥ 2 local; single centered field at N = 1.
- **Mobile 2-local**: landscape; attempt fullscreen + orientation lock at match start; lock fails → side-by-side in whatever orientation results. No stacked mode. **Mobile 1-local**: portrait, no lock, letterboxing handles either.
- **Shared field / Duel**: single centered field, never split; local paddles color-coded per player (skin identity, §13).
- **HUD strip**: directly above each field, inside its region — left→right: name + color chip, lives icons (omitted in Duel), score, R12/33, meter bar + target name (attack/assist only). Shared-field: single strip (shared pool, team score, round). All per-frame text = BitmapText.
- **Remote progress strip**: top edge above all field regions, one row per remote player — name + color, score, R12/33, lives (competitive) / downed flag (parallel assist). Mobile landscape compresses to name + score. Numbers only; remote fields never rendered.
- **Target display**: target name + color chip in HUD strip; cycle flashes the chip + brief pulse toward that player's progress row (remote) or field region (local). No separate picker screen.
- **Gutters**: thin visible dark gutter, 8 px, between adjacent field regions.
- **Performance budgets** (entry-Android reference: T606/G85/SD680 class, Mali-G57/Adreno 610, 3–4 GB RAM, 720×1600 60 Hz): 60 fps render target / 30 floor (explicit degraded mode, never a design target); sim fixed 60 Hz never drops. ≤10 ms app work/frame: sim tick ≤2 ms (holds with 3-guest input-queue + serialization duty — measured), snapshot→scene sync ≤3 ms, Pixi render ≤5 ms; headroom to ~8 ms for thermal. <20 draw calls/frame (≤10 expected), ≤64 MB textures. Fallback ladder: dpr 2 → 1.5 → 1.0 → 30 fps degraded. Never collapse two-field rendering to one field.

## 13. Skins, themes & audio

**Player skins** (per-player): paddle skin + ball skin — shape/texture/trim variants, not just color. **Field themes** (host-chosen in lobby config): brick set + field background (+ UI chrome tint); applies to every rendered field; visual-only, no gameplay meaning.

- **Selection**: per-device default in Settings (Appearance section, localStorage); per-player override in lobby, same slot as name editing. Bots auto-assigned distinct skins.
- **Identity**: skin id = UUID (or content hash) minted at authoring — collision-free across future additions/external packs; never a small enum. Wire: full UUID rides lobby join (control channel, once); host assigns compact per-session skin index (byte); snapshots carry the index. Field theme id gets the same treatment via lobby config broadcast.
- **Sync**: via session state — everyone sees everyone's actual skin.
- **Readability gate (hard constraint)**: skins never sole signal for Duel ball ownership — owner-colored outline glow (owner color + white outline, prototype-validated) renders over whatever skin the ball wears. Same for shared-field paddle identity: skin replaces bare color as identity; validated signals stay as orthogonal layers. Every shipped skin must pass this gate.
- **Asset sourcing (all-CC0 recipe, per [Research: free asset libraries](research/20-free-asset-libraries-skins-themes-audio.md))**:
  - Paddle skins: Kenney Puzzle Pack 2 (primary) / Buch OGA Breakout set (14 bars) / Tiny Break-em Pack (30 paddles).
  - Ball skins: Tiny Break-em Pack (33 balls) / Buch set (7) / Mopz Breakout graphics. Owner-colored variants = render-time tint on white-base sprites, never authored PNGs.
  - Brick sets: Buch OGA Breakout set + surt/InanZen expansions (grid-friendly, tiers) / Kenney Puzzle Pack 2 / Tiny Break-em Pack.
  - Capsule sprites: **custom-authored lettered pills** — no free pack ships Arkanoid lettered capsules (Graul98 bonus items closest reference). ~10 small sprites or pill-template + bitmap-font composite in code.
  - Field backgrounds: OGA Pixel Space Background (64×64 tileable) / Kenney Background Elements — darkening overlay pass regardless of source (low-contrast behind bricks/ball).
  - UI chrome: Kenney UI Pack (430) + Game Icons (105); Buch combometer frame maps 1:1 onto attack/assist meter.
  - Touch overlay glyphs: Kenney Input Prompts (1500).
  - SFX: Junkala OGA 512 retro pack (per-event variants) / Kenney Digital+Sci-fi+Impact+Interface bundles; jsfxr (Unlicense) fills gaps procedurally.
  - Jingles: SketchyLogic NES Shooter Music (3 jingles) / Kenney Music Jingles (85).
  - Level/boss music: Junkala 5 Chiptunes Action (seamless loops) / SketchyLogic NES pack (boss track).
  - **License rules**: CC0 only for committed assets (public MIT repo — no source-redistribution clauses); excluded: CraftPix freebies (custom license vs public commits), freepd.com (dead), LGPL/GPL OGA entries, Game-icons.net + incompetech (CC-BY — skip; Kenney/OGA CC0 equivalents exist). Attribution obligation zero; ship optional Credits screen + README assets line anyway. SketchyLogic provenance records kept (documented false-DMCA history, baseless).

**Audio (richer set)**: per-event SFX variants (brick hit pitched by row, escalating chains), round-intro jingles, level music, boss theme for Doh. Settings ship music/SFX sliders + mute now (Audio section). Chiptune/arcade aesthetic — Junkala/SketchyLogic CC0 packs above.

## 14. Menus & UI

- **Settings** (landing + lobby always; in-session via coop pause — Audio/Display only, Controls rebinds disabled mid-session): Controls (keyboard + gamepad rebinds), Audio (sliders + mute), Display (render quality: dpr auto/2/1.5/1 per ladder, reduced-effects toggle), Appearance (skin default, theme preference). Persisted per-device localStorage.
- **Competitive quit**: Esc or HUD menu button → quit-confirm overlay ("Quit match? You forfeit"); sim never pauses behind it. Quit = removal, scored as loss.
- **Coop/solo pause screen**: "Paused by [name]" header, Resume, Settings (Audio/Display), Quit to lobby, Quit session. Any player's request pauses all; any resumes; downed players may pause.
- **End screens**: competitive = winner banner + ranked standings (name, score, per-mode metric — Race finish order, Duel round wins, Attack points). Coop = outcome banner (episode cleared / lives exhausted) + team score + round reached N/33 + per-player bricks broken + capsules caught. Solo = episode complete / game over + Continue / Restart + high score + highest round.
- **Player naming**: default "Player N" + auto-assigned color; editable in lobby (~12 char max); localStorage, reused next session; host = Player 1 slot. Never localized: names, room codes, digits.
- **Multilingual**: es-419 + en-US minimum. Auto-detect `navigator.language`, Settings override, persisted, en-US fallback. Per-locale string tables — no hardcoded strings anywhere. Single BitmapText atlas covering Basic Latin + Latin-1 Supplement (á é í ó ú ñ ü ¿ ¡) for both locales. Language is per-device, never session state, never synced.

## 15. Trust model & accepted risks (ADR 0003)

Trust the host fully — no guest-side plausibility checks, warnings, or enforcement (impossible without a trusted server; detection rejected for false positives on honest hosts). Structural validation both directions is mandatory protocol behavior (§9). Spec carries this accepted-risks section verbatim:

- **Host (accepted)**: state tampering, score alteration, input fabrication, snapshot withholding/delaying (bounded by UX only), arbitrary kick, modded host client.
- **Guest (bounded by protocol)**: input flooding (rate cap + dedupe), input withholding (stall decay), rejoin spam (held-slot + 90 s window only), modded client perfect play (accepted — humanness unverifiable), display tampering (self-harm).
- **Stranger**: room-code guessing (31⁵ ≈ 28.6 M, no listing) — auto-accept + host kick.

## 16. Persistence (localStorage, per device)

| Key | Content |
|---|---|
| `settings.name` | default player name |
| `settings.skin` | default skin UUID |
| `settings.theme` | preferred field theme UUID |
| `settings.bindings.keyboard` / `.gamepad` | rebind maps |
| `settings.audio` | music/SFX levels, mute |
| `settings.display` | dpr mode, reduced-effects |
| `settings.language` | es-419 / en-US override |
| `solo.highScore` / `solo.highestRound` | Solo records |

No server-side persistence of any kind.

## 17. Testing (Vitest + Playwright)

- **sim/**: deterministic headless unit tests — collision (box overlap, offset-deflect, edge clamp), capsule script determinism (zero RNG), silver hits formula, scoring, meters, chain tiers, multiball last-ball rule, Duel ownership/deflect models, shared-field placements A/B/C, stall decay, control mangle.
- **net/**: delay queue, snapshot serialize/deserialize round-trip, redundancy dedupe, rejoin handshake, version mismatch, malformed-frame protocol errors.
- **content/**: level JSON schema validation, capsule script bounds (6–10, triggers ≤ brick count), scoring table completeness, skin/theme registry UUID uniqueness.
- **ui/**: i18n table completeness (every string key in both locales).
- **e2e/ (Playwright)**: browser end-to-end — landing/menu navigation, settings persistence, i18n switch (es-419/en-US), Solo start/pause/continue, versus-bots config screen, lobby room-code create/join (two browser contexts), ready gate + start countdown, P2P connect via manual copy-paste fallback (no deployed infra needed — fallback doubles as dev-mode connector), touch overlay presence in mobile-emulated viewport, zero console errors. Headless WebGL via SwiftShader = functional only — perf budgets stay manual on reference device. Seam: e2e owns wiring/UI/connection; sim logic stays in Vitest, never re-tested in e2e.

## 18. Authoring-time verification list

No design choices — data production/verification against locked shapes:

1. Level JSON: 33 rounds, 13×18 grids (exact dims verified), capsule scripts, base speeds, tier bumps, silver overrides.
2. Scoring table: classic-accurate values (colored tiers, silver per hit, capsule catch, clear bonus); Duel balance re-check against prototype numbers.
3. Capsule effect behaviors/durations: classic-accurate.
4. Skin + theme asset set: per §13 all-CC0 recipe; custom-author lettered capsule pills (~10), Doh boss sprite, brick hit-state crack overlays (or procedural tint+crack); every skin passes the Duel-ownership readability gate.
5. Audio set: per §13 recipe — Junkala 512 SFX (event mapping + variants), Junkala 5 chiptunes (level themes), SketchyLogic jingles + boss track; jsfxr for gaps.
6. BitmapText atlas: Basic Latin + Latin-1 Supplement, both locales.
7. Metered free-quota verification at signup; DO hibernation billing check at first deploy.

## 19. Out of scope

Accounts, matchmaking, global leaderboards, server-side persistence, paid infrastructure, native builds, bots alongside >1 human, watch panes (prototype did not flag Race as blind). Post-spec candidates: watch panes, bots-with-humans, rollback upgrade path for Duel.
