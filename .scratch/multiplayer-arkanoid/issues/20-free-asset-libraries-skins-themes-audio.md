# Research: free asset libraries for skins, themes & audio

Type: research
Status: resolved
Blocked by: (none)

## Question

Which free asset libraries provide usable, license-safe assets for the game's customizable theme/skin system and the richer audio set?

Scope (decided in assembly session, 2026-09-02): players identify paddles/balls via customizable skins/themes rather than fixed colors; audio = richer set (per-event SFX variants, round-intro jingles, boss/level music, chiptune/arcade aesthetic).

Establish, verifying licenses at primary sources:

- **Visual** — paddle/ball skins, brick sets, capsule sprites, field backgrounds, UI chrome for an Arkanoid-style game rendered with PixiJS v8 (PNG / sprite atlas). Candidates to verify: Kenney.nl (which packs, CC0 vs CC-BY), OpenGameArt.org, itch.io free packs, CraftPix free tier, Game-icons.net, others found.
- **Audio** — SFX (per-event variants: brick hit, paddle bounce, capsule catch, attack send/receive, life lost, launch, countdown), round-intro jingles, level/boss music. Candidates: Kenney audio packs, jsfxr/sfxr-style synthesized SFX, freesound.org (license hygiene per-file), Kevin MacLeod/incompetech, freepd.com, OpenGameArt music, chiptune generators.

For each library record: license (CC0/MIT/CC-BY — exact attribution terms if CC-BY), format, style fit for arcade/chiptune aesthetic, quantity/variety, any usage constraints (no-credit clauses, redistribution terms, format conversion needs). Note which assets need authoring regardless (Arkanoid-specific: paddle Vaus-like, capsule letters).

Deliver: recommended sourcing recipe per asset class (primary + fallback) with attribution obligations, for the spec. Findings to `research/20-free-asset-libraries-skins-themes-audio.md`.

## Answer

**Skin/theme system feasible entirely from free CC0 assets — no commissioned art for launch.** All-CC0 recipe (per class, primary/fallback): paddles — Kenney Puzzle Pack 2 / Buch OGA Breakout set / Tiny Break-em Pack; balls — Tiny Break-em (33) / Buch (7), owner variants = render-time tint, never authored PNGs; bricks — Buch set + surt/InanZen expansions (grid-friendly tiers); capsules — **custom-author lettered pills** (no free pack ships Arkanoid capsules; Graul98 bonus items closest); backgrounds — OGA Pixel Space (64×64 tileable) + darkening overlay pass; UI chrome — Kenney UI Pack + Game Icons, Buch combometer = attack/assist meter frame; touch glyphs — Kenney Input Prompts; SFX — Junkala OGA 512 retro pack (per-event variants) + jsfxr (Unlicense) for gaps; jingles — SketchyLogic NES (3) / Kenney Music Jingles; level/boss music — Junkala 5 Chiptunes Action / SketchyLogic boss track.

**License rules for the public MIT repo**: CC0 only for committed assets. Excluded: CraftPix freebies (custom license forbids source redistribution — gray zone for public commits), freepd.com (site dead 2025), LGPL/GPL OGA entries (Arcanoid starter set), Game-icons.net + incompetech (CC-BY attribution burden — CC0 equivalents exist). Attribution obligation zero under all-CC0; ship optional Credits screen + README line anyway. SketchyLogic provenance records kept (documented false-DMCA history, baseless).

**Custom-authoring gaps (bounded, days not commissions)**: lettered capsule sprites (~10), Vaus-profile paddle skin (if lore-accurate silhouette wanted), brick hit-state crack overlays (or procedural tint+crack), Doh boss sprite, theme manifest glue (engineering).

Full findings with per-library license verification: [research/20-free-asset-libraries-skins-themes-audio.md](../research/20-free-asset-libraries-skins-themes-audio.md)
