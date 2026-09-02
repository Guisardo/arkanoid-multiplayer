# Input mapping design

Type: grilling
Status: resolved

## Question

How do keyboard, mouse, gamepad, and touch each control the game?

Define per method: in-game controls (paddle movement, launch, pause), menu navigation, and where mappings are fixed vs rebindable. Cover two-local-players-on-one-device input separation (keyboard+gamepad? two gamepads?), browser Gamepad API quirks (incl. Android), and touch design (drag paddle, tap to launch, touch-friendly menus).

HITL. Invoke /grilling and /domain-modeling.

## Answer

**Local player capacity:** desktop up to 4 local players (any mix of keyboard, mouse, gamepad; mouse = 1 slot max — single pointer); mobile up to 2 (touch = 1 player per device, second local = gamepad, max 2 gamepads). Destination updated accordingly.

**Per-method in-game mappings (defaults, keyboard fully rebindable; gamepad buttons rebindable, movement fixed; touch/mouse fixed):**

- **Keyboard:** P1 `←`/`→` move, `Space` launch, `,`/`.` cycle target, `1`-`4` fire attack/assist type. P2 `A`/`D` move, `W` launch, `Z`/`C` cycle, `R`/`T`/`F`/`G` fire. Solo: both keysets drive P1. 4-on-keyboard possible via rebinding; spec notes ~6-key rollover caveat on cheap keyboards.
- **Mouse:** paddle chases pointer at full speed beyond small dead band (parity with keyboard max speed, no proportional mouse); click = launch; HUD panel clickable. Wheel unmapped.
- **Gamepad:** left stick (0.2 dead zone) and d-pad both always live; stick beyond dead zone wins, else d-pad (no summing). `A`/Cross launch, `LB`/`RB` cycle, `X`/`Y`/`B`/`RT` fire (4 slots). `Start` pause/menu. Disconnect mid-game → input idle, player stays in session (rejoin window logic, ticket 06).
- **Touch:** transparent virtual-stick + virtual-button overlay anchored to player's own play-field region; left thumb = stick (proportional, 0.2 dead zone), right thumb = buttons (launch, cycle ◀/▶, fire ×4; assist shows 3). Faint-visible always, brighten on active touch. Multi-touch supported. Menus: tap targets ≥ 48 px, zero hover dependencies.

**Action model (from tickets 04/05):** cycle target forward/back + fire type 1-4 (Attack: brick rain, paddle shrink, ball speed up, control mangle; Assist: power-up gift, brick clear, life gift — 3 buttons). Target select = cycle; action type = which button pressed.

**Cross-method speed parity:** normalize — cross-input-method paddle speed must be fair in remote competitive play; exact technique (e.g. unified max-speed model vs analog ramp) deferred to Research: input sync & fairness techniques (14), which also feeds Netcode sync architecture (08).

**Input→sim seam:** per-player normalized input frame sampled per sim tick: 2D move axis `[-1..1]` (horizontal paddles consume x, vertical side paddles consume y — shared-field placement B side paddles move on y; keyboard quantizes to −1/0/+1), launch edge-event, action edge-events (cycle/fire). Edge events buffered max 1 per action per tick; move axis sampled at tick boundary. Device adapters own all quirks (polling, dead zones, touch deltas, mouse absolute→axis conversion); sim sees only the frame. This is the seam Netcode sync architecture (08) builds on.

**Pause/quit input vs mode:** coop: `Esc`/`Start`/touch pause icon → pause request → host pauses. Competitive: same inputs open quit-confirm overlay only — sim never pauses, cancel returns to play. Touch pause icon top corner, out of drag zone.

**Menus:** any local input navigates any menu (first input takes focus); rebind screen is per-player (tab between local players' maps). Lobby config stays host-only (ticket 06) — locals on host device don't get config rights by proximity. Keyboard menus: arrows/WASD navigate, `Enter` select, `Esc` back; gamepad: stick/d-pad navigate, `A` select, `B` back; mouse/touch: point/tap.

**Rebinding:** keyboard fully rebindable (game + menu keys), gamepad buttons rebindable (movement fixed), touch/mouse fixed. Duplicate bindings rejected with highlight (no silent swap), checked across all local players' maps on one device. Stored in localStorage per device. Settings/rebind screen detail = menus fog (map Not yet specified).

**Downed-player clarification (appended to ticket 05):** downed player keeps action panel live — can spend existing meter on teammates (power-up gift, brick clear), cannot self life gift (revival is teammates' act). Early clearer unchanged: full gift rights including life gift.

**Countdown/serve:** move live during countdown + serve (position paddle), launch ignored until countdown ends. Consistent with attach-and-launch serve (tickets 04/05).

**Control mangle placement:** sim-side — input frame arrives honest, sim corrupts the consumed axis per tick (invert/jitter flavor = ticket 09 tuning). Hits every input method equally, adapters stay clean.

**Glossary term added to CONTEXT.md:** Input frame.
