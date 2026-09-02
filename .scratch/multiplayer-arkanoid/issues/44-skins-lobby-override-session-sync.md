# 44 — Skins: lobby override + session sync

**What to build:** Skin selection flowing through the session: per-player skin override in the lobby (same slot as name editing) over the per-device Settings default; full skin UUID rides the lobby join on the control channel (once); host assigns a compact per-session skin index (byte); snapshots carry the index; field theme id gets the same treatment via lobby config broadcast. Everyone sees everyone's actual skin — synced via session state. Bots keep auto-assigned distinct skins (from 25).

**Blocked by:** 29 — Skins/themes system + asset set; 43 — Lobby + landing + session flow.

**Status:** ready-for-agent

- [ ] Lobby skin picker per player in the name-editing slot; overrides device default for the session
- [ ] Full UUID at join → compact session index in snapshots; index assignment collision-free
- [ ] Field theme id broadcast via lobby config; applied to every rendered field
- [ ] All players see all players' actual skins (local + remote) without reload
- [ ] Bots still auto-assigned distinct skins, never colliding with any human's choice
