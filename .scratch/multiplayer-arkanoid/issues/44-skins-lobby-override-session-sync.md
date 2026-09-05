# 44 — Skins: lobby override + session sync

**What to build:** Skin selection flowing through the session: per-player skin override in the lobby (same slot as name editing) over the per-device Settings default; full skin UUID rides the lobby join on the control channel (once); host assigns a compact per-session skin index (byte); snapshots carry the index; field theme id gets the same treatment via lobby config broadcast. Everyone sees everyone's actual skin — synced via session state. Bots keep auto-assigned distinct skins (from 25).

**Blocked by:** 29 — Skins/themes system + asset set; 43 — Lobby + landing + session flow.

**Status:** resolved

- [x] Lobby skin picker per player in the name-editing slot; overrides device default for the session
- [x] Full UUID at join → compact session index in snapshots; index assignment collision-free
- [x] Field theme id broadcast via lobby config; applied to every rendered field
- [x] All players see all players' actual skins (local + remote) without reload
- [x] Bots still auto-assigned distinct skins, never colliding with any human's choice

## Answer

Implemented on `chunk/skins-lobby-sync` (worktree arkanoid-wt-44), PR #28:

- **`src/app/lobbyState.ts`**: `LobbyPlayer.skinId` (UUID; Settings default until lobby override), events `setPlayerSkin`/`setPlayerName` (trim, 12-char cap, never empties — completes ticket 43's name-editing leftover), `themeId` in `LobbyConfig` (host-only via setConfig, unknown theme keeps current, ready-reset on any change incl. theme), `remoteJoined` carries the full skin UUID (spec §13 wire rule). Unknown UUIDs fall back to default — never a crash.
- **`src/content/skinSync.ts`** (new, pure, content/leaf so sim+app both consume without seam violations): `assignSkinIndices` — UUID→compact per-session index (byte), deterministic first-appearance order, session-scoped uuid table; `autoAssignBotSkins` — first registry skins not taken by humans, wraps deterministically when bots outnumber free skins; `skinUuidFor` — session index→UUID, out-of-range → default.
- **Sims**: `skinIndices` option on roundSim, multiField (incl. field reset), sharedField, duel, attackSession, assistSession (incl. round advance) — flows into `PlayerSnapshot.skinIndex`; serializer byte already existed, roundtrip regression-tested with non-zero indices. versusBots: `humanSkinId` option + auto-assigned distinct bot skins across all 5 variants.
- **`src/ui/lobbyScreens.ts`**: per-local-player skin `<select>` (same row slot as name editing) + name `<input>` (12-char max, never localized); host theme `<select>` in config panel; guests see theme name read-only. `defaultSkinId` option seeds new locals from Settings Appearance.
- **`src/render/splitScreen.ts`**: `skinIds[]` + `themeId` options flow into each FieldView (FieldView already consumed ids — ticket 29).
- **Tests**: 30 new — skinSync (24: assignment determinism, collision-free bot skins, fallbacks, all 5 sim variants, serializer roundtrip) + lobby screens (6: picker render, dispatch, host/guest visibility, remote rows). Full suite 620/620 green; typecheck/lint/build clean.

Judgment calls: skinSync lives in content/ (leaf) not app/ — sim imports it for versusBots, and the seam rules forbid sim→app; session index table is per-session (not registry position) so index 0 ≠ default skin necessarily — renderers resolve via the session table, default fallback only on out-of-range.


