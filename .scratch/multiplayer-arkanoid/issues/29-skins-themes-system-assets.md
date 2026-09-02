# 29 — Skins/themes system + asset set

**What to build:** The skin and theme system with its real assets. Player skins (paddle + ball — shape/texture/trim variants, not just color) and field themes (brick set + field background + UI chrome tint, host-chosen, visual-only) backed by registries keyed by UUID minted at authoring — never a small enum. Assets sourced per the all-CC0 recipe: paddle skins from Kenney Puzzle Pack 2 / Buch OGA Breakout set / Tiny Break-em Pack; ball skins from Tiny Break-em (33) / Buch (7); brick sets from Buch + surt/InanZen expansions; custom-authored lettered capsule pills (~10 sprites or pill-template + bitmap-font composite); field backgrounds from OGA Pixel Space / Kenney Background Elements with darkening overlay; UI chrome from Kenney UI Pack + Game Icons; touch glyphs from Kenney Input Prompts. Owner-colored ball variants = render-time tint on white-base sprites, never authored PNGs. Settings Appearance section live (default skin + theme preference, persisted). Every shipped skin passes the readability gate: never the sole signal for Duel ball ownership — owner-colored outline glow renders over whatever skin the ball wears.

**Blocked by:** 23 — Tracer bullet: Solo round playable.

**Status:** ready-for-agent

- [ ] Skin + theme registries with UUID ids; uniqueness unit-tested
- [ ] At least one full paddle-skin and ball-skin set per source pack committed, CC0-only (no CraftPix/freepd/GPL/CC-BY)
- [ ] Custom lettered capsule pills authored for all 10 capsules, readable at game scale
- [ ] Brick hit-state crack overlays (or procedural tint+crack) working
- [ ] Doh boss sprite sourced/authored and registered (behavior lands in ticket 49)
- [ ] Owner-colored ball variants via render-time tint on white-base sprites — no per-owner PNGs
- [ ] Every shipped skin passes the readability gate (owner outline glow renders over the skin)
- [ ] Settings Appearance section live: default skin + theme preference, persisted per device
- [ ] Asset provenance recorded (source pack + license per asset); optional Credits screen + README assets line
