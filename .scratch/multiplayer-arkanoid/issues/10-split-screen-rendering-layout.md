# Split-screen rendering & layout

Type: grilling
Status: resolved
Blocked by: 03, 13

## Question

How is the viewport laid out for 1-2 local players?

Decide: split orientation (vertical/horizontal) per device class; play-field aspect ratio and scaling across phone/desktop; HUD placement; how shared-field modes render on one device (single field, no split); performance cost of two fields on low-end Android. Informed by the stack choice from Research: browser stack options.

HITL. Invoke /grilling and /domain-modeling.

## Answer

- **Field geometry:** fixed logical aspect per play field, letterboxed inside its region; fractional scale allowed; devicePixelRatio capped at 2 (per Research: low-end Android performance targets). Exact aspect ratio computed at spec assembly.
- **Brick cells:** classic Arkanoid proportions, ~2:1 wide:tall — the 13×18 grid plus paddle zone lands near-square. Exact pixel ratio at spec assembly.
- **Desktop layout:** N-across equal-width columns for N ≥ 2 local players; single centered field at N = 1.
- **Mobile 2-local:** landscape; attempt fullscreen + orientation lock at match start; if lock fails, side-by-side fields in whatever orientation results. No stacked mode.
- **Mobile 1-local:** portrait; no orientation lock; letterboxing handles either orientation gracefully.
- **Shared-field / Duel with 2 local players:** single centered field, never split; local paddles color-coded per player.
- **HUD:** per-field strip directly above each play field, inside its region. HUD content per mode/player-count owned by Menus & UI beyond the lobby.
- **Remote opponents' fields:** never rendered on other devices; opponent progress via HUD indicators only, both device classes. Watch panes = post-spec candidate if the game-feel prototype flags Race as blind (map fog).
- **Two fields on low-end Android:** accepted as within budget (atlas batching keeps draw calls < 20); validated on the entry-Android reference device in the game-feel prototype. Fallback ladder: dpr 2 → 1.5 → 1.0 → 30 fps degraded mode. Never collapse to one-field rendering.
- **Touch overlay:** floats over the field's bottom corners, semi-transparent; no reserved layout space. Exact overlay layout owned by Menus & UI beyond the lobby.
- **Gutters:** thin visible gutter between adjacent field regions; exact styling at spec assembly.
