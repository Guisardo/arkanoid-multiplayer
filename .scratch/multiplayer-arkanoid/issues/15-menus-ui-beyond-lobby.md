# Menus & UI beyond the lobby

Type: grilling
Status: resolved

## Question

What screens, settings, and HUD does the game need beyond the lobby?

Decide: settings screen scope (input rebind UI from Input mapping design, audio/visual options); pause screen content per mode (competitive quit-confirm vs coop pause from Session & lobby flow design); end-screen content per mode (rematch/lobby/quit plus results); in-game HUD content and placement per mode and player count (lives, score, attack/assist meter, target picker, round/level indicator — informed by Content set's scoring and meter costs); touch overlay layout (virtual stick + buttons from Input mapping design). Styling direction only as far as it affects layout decisions — Split-screen rendering & layout owns viewport geometry.

HITL. Invoke /grilling and /domain-modeling.

## Answer

- **Settings screen**: three sections — Controls (keyboard + gamepad rebinds), Audio (music/SFX sliders + mute), Display (render quality: dpr auto/2/1.5/1 per the performance ladder, reduced-effects toggle). Reachable from landing + lobby always; in-session via coop pause only, Controls rebinds disabled mid-session (Audio/Display only). Persisted per-device in localStorage.
- **Competitive quit**: Esc or HUD menu button → quit-confirm overlay ("Quit match? You forfeit"); the sim never pauses behind it. Quit = removal per Session & lobby flow rules, scored as a loss.
- **Coop pause screen**: "Paused by [name]" header, Resume, Settings (Audio/Display), Quit to lobby, Quit session. Any player's request pauses all; any player resumes; downed players may pause.
- **End screens**: competitive = winner banner + ranked standings table (name, score, per-mode metric — Race finish order, Duel round wins, Attack points). Coop = outcome banner (episode cleared / lives exhausted) + team score + round reached N/33 + per-player bricks broken + capsules caught (only counters the sim already tracks).
- **Per-field HUD strip**: left→right: name + color chip, lives icons (omitted in Duel), score, R12/33, meter bar + target name (attack/assist modes only). Shared-field coop: single strip (shared life pool, team score, round); players identified by paddle color. All per-frame text = BitmapText.
- **Remote progress strip**: top edge above all field regions, one row per remote player: name + color, score, R12/33, lives (competitive) / downed flag (parallel assist). Mobile landscape compresses to name + score. Numbers only — no live brick-grid mirroring.
- **Target display**: target name + color chip in the HUD strip; cycle-target flashes the chip + brief pulse toward that player's progress row (remote) or field region (local). No separate picker screen.
- **Touch overlay**: bottom-left corner = virtual stick; bottom-right corner = context-sensitive cluster: Race/Duel = single Launch button; Attack = 4 attack buttons + cycle-target; parallel assist = 3 assist buttons + cycle-target. Buttons ≥ 48 px, semi-transparent. Downed player: stick dead, assist cluster stays live.
- **Player naming**: default "Player N" + auto-assigned color; editable in lobby (~12 char max); stored in localStorage, reused next session; host = Player 1 slot.
- **Multilingual UI**: es-419 + en-US minimum. Auto-detect via `navigator.language`, Settings override, persisted, en-US fallback. All UI chrome localized via per-locale string tables — no hardcoded strings anywhere; never localized: player names, room codes, digits. Language is per-device, never session state, never synced. Single BitmapText atlas covering Basic Latin + Latin-1 Supplement (á é í ó ú ñ ü ¿ ¡) for both locales.
- **Audio controls vs content**: settings ship audio controls now (music/SFX sliders, mute); audio content scope (which SFX and music) stays fog for spec assembly.
