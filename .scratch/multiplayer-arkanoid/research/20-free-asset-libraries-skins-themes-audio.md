# Research: free asset libraries for skins, themes & audio

Status: complete
Date: 2026-09-02
Ticket: issues/20-free-asset-libraries-skins-themes-audio.md
Target: PixiJS v8 + TypeScript, GitHub Pages, MIT-licensed repo (assets ship inside a public repo — redistribution-friendliness matters as much as price).

All licenses below verified at the primary source on 2026-09-02. Where a site was unreachable, noted with fallback evidence.

---

## 1. Recommended sourcing recipe per asset class

Uses CONTEXT.md vocabulary: Paddle, Brick, Capsule, Play field, HUD strip, Touch overlay.

| Asset class | Primary | Fallback | Notes |
|---|---|---|---|
| **Paddle skins** | Kenney Puzzle Pack 2 (paddle sprites, CC0) | OGA "Breakout set" by Buch (14 bars, CC0); Tiny Break-em Pack (30 paddles, CC0) | No free library ships a Vaus-like paddle — expect to recolor/re-style. Owner-colored variants easiest via tint at render time. |
| **Ball skins** | Tiny Break-em Pack (33 colored balls, CC0) | OGA "Breakout set" (7 balls); OGA "Breakout graphics" by Mopz (CC0) | Owner-colored ball variants better done as tint/outline in PixiJS than as shipped PNGs — ownership is dynamic. |
| **Brick sets** | OGA "Breakout set" (Buch, CC0 — 28 bricks incl. silver/gold-strength tiers via expansion sheets) | Kenney Puzzle Pack 2 (brick tiles, CC0); Tiny Break-em Pack (34 bricks + bumps) | 13×18 grid needs a uniform-size tileable brick; Buch set is grid-friendly. Multi-hit "silver" brick states need authoring or recolor passes. |
| **Capsule sprites** | OGA "Breakout Game Assets" by Graul98 (CC0 — includes bonus items) | OGA "Assorted Powerups" by ZaninDevelopers (CC0, 16×16 orb tokens — proof-of-concept only, wrong shape) | **No free library ships Arkanoid-style lettered capsules (E/Expand, L/Laser, P/Player, B/Break, S/Slow, C/Catch, T/Ball-split).** Custom authoring required. Generic orb powerups exist but read as shmup pickups, not Arkanoid capsules. |
| **Field backgrounds** | OGA "Pixel Space Background" (CC0, 64×64 tileable, tiny file — ideal for mobile bandwidth) | Kenney Background Elements / Remastered (CC0, 90–110 elements — build layered parallax scenes); Kenney Skyboxes/Textures | A play field background must be low-contrast so bricks/ball stay readable — plan a darkening overlay pass regardless of source. |
| **UI chrome (HUD strip, lobby, menus)** | Kenney UI Pack (CC0, 430 files: buttons, panels, sliders) + Game Icons (CC0, 105) | Kenney UI Pack Sci-Fi / Pixel Adventure (all CC0); OGA "Shiny Breakout additional assets" (Buch, CC0 — 32×64 title font, combo/attack meter frame, 800×600 background) | Buch's combometer frame maps 1:1 onto the attack/assist meter in the HUD strip. |
| **Touch overlay glyphs** | Kenney Input Prompts (CC0, 1500 files: keyboard/mouse/gamepad/touch gestures, 64×64) | Kenney Input Prompts Pixel / 1-Bit (CC0) | Directly feeds the Touch overlay (virtual stick + button cluster). |
| **SFX (per-event variants)** | OGA "512 Sound Effects (8-bit style)" by SubspaceAudio/Juhani Junkala (CC0, neatly categorized) | Kenney Digital Audio + Sci-fi Sounds + Impact Sounds + Interface Sounds (all CC0, 60+70+130+100 files) | 512-pack has multiple variants per event category — matches the per-event-variants requirement. One user shipped an Arkanoid game with exactly this pack. |
| **Round-intro jingles** | OGA "NES Shooter Music" by SketchyLogic (CC0 — 3 jingles included) | Kenney Music Jingles (CC0, 85 files) | Both verified CC0. |
| **Level/boss music (chiptune)** | OGA "5 Chiptunes (Action)" by Juhani Junkala (CC0, 5 seamless loops incl. title + ending + level themes) | OGA "NES Shooter Music" (CC0, 5 tracks incl. boss); incompetech Kevin MacLeod (CC-BY 4.0, attribution required — see §3) | CC0 OGA packs cover the whole soundtrack need; MacLeod only needed if a specific mood is missing. Avoid the paid SubspaceAudio itch packs (CC-BY 4.0 + $29.90 — the free 512/5-chiptune OGA subsets are CC0). |
| **SFX generation tooling** | jsfxr (chr15m/jsfxr, Unlicense = public domain) — generates WAVs from presets, `npm i jsfxr` | sfxr (original, public domain, desktop) | Generate per-event variant families procedurally (mutate params), batch to WAV. Zero license surface. |

---

## 2. Per-library table (licenses verified at primary sources)

| Library / pack | URL | License (verified) | Formats | Style fit (arcade/chiptune) | Quantity | Constraints |
|---|---|---|---|---|---|---|
| Kenney.nl (all asset packs) | https://kenney.nl/assets | **CC0** — support page: "all game assets on the asset pages are public domain licensed (CC0)... even in commercial projects"; "Attribution is not required... Do not use our logo" | PNG (vector in some), WAV/OGG-ish audio, sprite sheets | Flat, bold, modern-arcade. Not pixel-art (except dedicated Pixel series) | ~40 packs relevant; Puzzle Pack 2 = 795 files; UI Pack = 430; Input Prompts = 1500 | No attribution. Logo forbidden. No redistribution restriction stated — CC0. |
| Kenney Puzzle Pack 1 & 2 | kenney.nl/assets/puzzle-pack-1, /puzzle-pack-2 | CC0 (each pack page states "License: Creative Commons CC0" with link) | PNG | Paddle/brick/coin/pipe — the closest Kenney has to breakout | PP1: 75 files; PP2: 795 | Same as above. |
| Kenney UI Pack (+ Sci-Fi, Pixel Adventure variants) | kenney.nl/assets/ui-pack | CC0 | PNG (+ vector in remastered) | Clean UI chrome, 9-slice panels/buttons | 430 | — |
| Kenney Game Icons | kenney.nl/assets/game-icons | CC0 | PNG | Interface glyphs | 105 | — |
| Kenney Input Prompts | kenney.nl/assets/input-prompts | CC0 | PNG, spritesheets, fonts | Gamepad/keyboard/touch glyphs | 1500 | — |
| Kenney Background Elements (+ Remastered) | kenney.nl/assets/background-elements(-remastered) | CC0 | PNG | Layered scenery elements | 110 / 90 | — |
| Kenney Digital Audio | kenney.nl/assets/digital-audio | CC0 | WAV/OGG | Retro-digital laser/space SFX | 60 | — |
| Kenney Sci-fi Sounds | kenney.nl/assets/sci-fi-sounds | CC0 | OGG | Engine/laser/charge | 70 | — |
| Kenney Impact Sounds | kenney.nl/assets/impact-sounds | CC0 | OGG | Hits/crashes — brick break, life lost | 130 | — |
| Kenney Interface Sounds | kenney.nl/assets/interface-sounds | CC0 | OGG | Clicks/confirms — lobby, menus | 100 | — |
| Kenney Music Jingles | kenney.nl/assets/music-jingles | CC0 | OGG/Mp3 | Short stingers — round intro | 85 | — |
| OpenGameArt.org | https://opengameart.org | **Per-submission** — CC0, CC-BY, OGA-BY, CC-BY-SA, GPL all present. License shown on each submission page. | PNG, SVG, OGG, MP3, FLAC, WAV | Mixed; strong retro/pixel scene | ~53 breakout-tagged 2D art entries; 1200+ chiptune music entries | Check every submission individually. CC-BY/CC-BY-SA entries require attribution (SA also share-alike). GPL entries (LGPL arcanoid starter set found) — avoid for an MIT repo. |
| OGA "Breakout set" (Buch; collabs surt, InanZen) | opengameart.org/content/breakout-set | **CC0** (page: CC0 badge + "Attribution NOT REQUIRED, though appreciated: credit me as Buch") | PNG (Dawnbringer 32-color palette) | Pixel-art breakout-native — excellent fit | 28 bricks, 14 paddles, 7 balls, bitmap font, heart icons; expansion sheets add more sizes + lockable brick + drops | None. Author-appreciated credit: "Buch" + OGA profile link. |
| OGA "Shiny Breakout additional assets" (Buch) | opengameart.org/content/shiny-breakout-additional-assets | CC0 | PNG (2×-scaled; downscale with Nearest) | Matches Breakout set | 32×64 title font, combo meter frame, 800×600 bg | — |
| OGA "Breakout graphics" (Mopz/Marcus) | opengameart.org/content/breakout-graphics | CC0 | PNG 32×32 (+40×40 shadowed) | Programmer-art bricks + backdrop | 1 sheet + bg | No source files (xcf lost) — no clean edit path. |
| OGA "Breakout Game Assets" (Graul98) | opengameart.org/content/breakout-game-assets | CC0 ("can be used for any purpose even commercially. You do not have to credit me") | PNG | Balls, bricks, background, UI, bonus items | 1 zip (2.4 MB) | Bonus items included — closest existing free capsule analog. |
| OGA "Tiny Break-em Pack" (Screaming Brain Studios) | opengameart.org/content/tiny-break-em-pack | CC0 | PNG, multiple sizes | Tiny/retro; textured + solid bricks | 99 sprites: 34 bricks, 30 paddles, 33 balls | — |
| OGA "Arcanoid starter set" (noway) | opengameart.org/content/arcanoid-starter-set | **LGPL 2.1/3.0** | SVG | Vector paddle/bricks | 1 file | **Avoid** — LGPL is license friction in an MIT repo. |
| OGA "Pixel Space Background" (ZaninDevelopers) | opengameart.org/content/pixel-space-background | CC0 | PNG 64×64 tileable | Starfield | 1 | Author asks (non-binding) for a link to the project using it. |
| OGA "Assorted Powerups" (ZaninDevelopers) | opengameart.org/content/assorted-powerups | CC0 | PNG 16×16 | Orb pickups (red/blue/yellow) | 3 colors | Generic orbs, not lettered capsules. |
| OGA "512 Sound Effects (8-bit style)" (SubspaceAudio / Juhani Junkala) | opengameart.org/content/512-sound-effects-8-bit-style | **CC0** (author confirmed in comments: "It's CC0 license so you are free to do what ever you like") | WAV | 8-bit/NES — perfect fit | 512, categorized | None. |
| OGA "5 Chiptunes (Action)" (Juhani Junkala) | opengameart.org/content/5-chiptunes-action | CC0 | OGG/MP3/WAV (49.6 MB zip) | SID-style action loops, seamless | 5 loops (title, ending, 3 level themes) | None. |
| OGA "NES Shooter Music" (SketchyLogic) | opengameart.org/content/nes-shooter-music-5-tracks-3-jingles | **CC0** | WAV (18 MB) + FTM (FamiTracker source) | NES 2A03 — boss track with intro section, 3 jingles | 8 tracks | Past DMCA/patent-troll incident (2019) — investigated by OGA moderator, downloads restored, confirmed baseless. Safe, but archive the OGA page + this history for provenance. |
| jsfxr (chr15m) | https://github.com/chr15m/jsfxr + https://sfxr.me | **Unlicense** (public domain) — UNLICENSE file in repo | Generates WAV from JSON presets; npm lib | sfxr-style retro SFX synthesis | Infinite (parametric) | Tool, not a library — outputs are yours. |
| Game-icons.net | https://game-icons.net | **CC-BY 3.0** — about page: "provided under the terms of the Creative Commons 3.0 BY license... 'Icons made by {author}. Available on https://game-icons.net' is fine" | SVG (512×512), PNG export via Studio | Monochrome HUD/menu glyphs, TF2/DK2-inspired | 4000+ (Lorc 1429, Delapouite 2022, ...) | **Attribution required.** 30+ authors — per-author credit lines. Prefer Kenney Game Icons (CC0) unless a specific icon is needed. |
| incompetech (Kevin MacLeod) | https://incompetech.com/music/royalty-free/ | **CC-BY 4.0** (free tier) — FAQ gives the exact credit block (see §3) | MP3/OGG | Orchestral/electronic; chiptune-adjacent subset exists, not core | 1000+ tracks | Attribution must be "findable" — video games: credits screen in settings menu. No commercial-free no-credit option except paid Standard License. |
| freepd.com | https://freepd.com | **Site closed 2025** — landing page: "[freepd.com] is now permanently closed." Was CC0/public domain | — | Was the CC0 MacLeod alternative | — | **Dead. Do not cite.** Replace with Pixabay Music (MacLeod's own recommendation for public domain) — secondary evidence, verify per-track before use. |
| CraftPix freebies | https://craftpix.net/freebies/ + /file-licenses/ | **Custom freebie license** — free section: "permitted to use... in any number of personal and commercial projects"; "No attribution or link back... required"; **Forbidden**: "You can NOT resell the art source files (PNG, JPG, EPS...) or... redistribute the art or modified version of the art in a manner that would make some or all of the art files useable to another end user" | PNG, AI, EPS | High-polish 2D kits (platformers/defense/quiz; no breakout kit found in free tier) | ~29 freebie pages | Custom license, not CC0. Committing source PNGs to a public MIT repo = redistribution of source files — **gray zone; treat as unusable for this repo unless clarified with CraftPix.** Game-embedded use is fine; open-source repo publication is the problem. |
| itch.io (free packs generally) | https://itch.io/game-assets/free | Per-pack; free tier runs CC0/CC-BY/custom mix | PNG/WAV | Strong chiptune/retro scene | Large | Verify every pack page; many "free" packs are non-commercial or require itch login. SubspaceAudio's paid 1000/6000 packs are CC-BY 4.0 + paid — the OGA 512 subset is the CC0 equivalent. |
| freesound.org | https://freesound.org | **Per-file**: CC0 / CC-BY 4.0 / CC-BY-NC 4.0 (+legacy Sampling+). FAQ verified. | WAV, FLAC, OGG, MP3 | Huge but field-recording-heavy; retro subset requires filtering | ~900k sounds | Per-file license hygiene mandatory: filter to CC0 only. CC-BY needs per-sound credit ("sound1" by user1 + URL). CC-BY-NC excluded (repo is MIT — treat as commercial-compatible-only). Account required to download. Raw unmodified SFX have triggered YouTube Content ID false claims (documented in FAQ) — irrelevant to GitHub Pages but note for trailers. |

### Unreachable / not independently verified

- kenney.itch.io (All-in-1 bundle page) — HTTP 429 rate-limited during research. Not needed: kenney.nl primary pages verify CC0 per pack.
- jsfxr.frozenfractal.com — transport error. chr15m/jsfxr GitHub repo (primary source for the maintained fork) verified instead.
- BeepBox GitHub repo (BeepBox/BeepBox) — 404. BeepBox exists at beepbox.co with published source under its own free license (secondary knowledge, unverified this session) — not needed for recommendation; OGA packs + jsfxr cover music/SFX. If procedural chiptune composition is wanted later, verify BeepBox's license at its repo before adopting.

---

## 3. Attribution obligations summary

**If the recipe in §1 is followed (all-CC0 core), the in-game/README obligation is zero** — CC0 waives attribution. Recommended anyway (good citizenship, cheap): a single "Assets" section in README:

```
Assets: Kenney (kenney.nl), Buch/Juhani Junkala/SketchyLogic and other
OpenGameArt contributors (opengameart.org) — all CC0 public domain.
```

**Only if deviating:**

| Source | Obligation | Exact form |
|---|---|---|
| Game-icons.net (CC-BY 3.0) | **Required.** | `"Icons made by {author}. Available on https://game-icons.net"` — per author used; credit must be findable (credits screen reachable from settings is the accepted game convention). |
| incompetech (CC-BY 4.0) | **Required.** | Per track: `Title Kevin MacLeod (incompetech.com)\nLicensed under Creative Commons: By Attribution 4.0\nhttps://creativecommons.org/licenses/by/4.0/` — replace *Title* with the actual track title. Edits must state which parts are yours. |
| freesound CC-BY files | **Required, per sound.** | `"soundname" by username (https://freesound.org/s/{id}/) licensed CC-BY 4.0` — freesound supports a consolidated "attribution list" page link if the list gets long. |
| freesound CC-BY-NC / Sampling+ | **Excluded from use.** MIT repo + GitHub Pages = treat as commercial context. | — |
| OGA CC-BY entries | Required per submission. | Author name + link to OGA submission. |
| Buch's breakout packs (CC0) | None (optional appreciated credit: "Buch" + OGA profile). | — |
| Kenney (CC0) | None; **logo use forbidden**; optional "Kenney" text credit. | — |

**In-game surface**: keep a Credits screen reachable from the settings/pause menu (matches both MacLeod's and CC best practice). README section covers repo-side.

---

## 4. Custom-authoring list (no free library covers these)

1. **Capsule letter sprites** — E/L/P/B/S/C/T-style lettered pill capsules with color coding per effect. Nothing free ships this; closest are generic orb "powerups" (wrong shape, no letters). ~8–10 small sprites. Either hand-drawn (Aseprite/Piskel) or generated from a pill template + bitmap-font glyph composited in code.
2. **Vaus-like paddle skin** — Buch/Kenney/Tiny Break-em paddles are bars/ships, none with the segmented spaceship profile. If a lore-accurate silhouette is wanted, it must be drawn. (Plain paddle bars are fully covered by free packs.)
3. **Brick strength-state tiles** — silver (multi-hit, crack progression) and gold (indestructible) variants. Buch's set has color tiers, not hit-state damage frames. Either author crack overlays or do damage states procedurally (tint + crack sprite overlay).
4. **Owner-tint variants** — ball/paddle recolors per player identity. Don't author: tint at render time in PixiJS (white-base sprite + `tint`), one line of config per skin.
5. **HUD strip-specific layout art** — meter frames exist (Buch combometer), but the exact HUD strip composition (name + color chip + lives + score + round + meter + target) is layout code, not art. Kenney UI Pack nine-slices cover the parts.
6. **Boss (Doh-like) sprite** — a finale boss for rounds 33-style endings. No free CC0 moai-head boss found; OGA "Space Boss Battle Theme" music exists but boss *art* would need authoring if a boss round is specced.
7. **Theme system glue** — a theme manifest (palette + sprite atlas + SFX bank per theme) is engineering work, not assets.

---

## 5. Verdict

**A skin/theme system is feasible entirely from free (CC0) assets — no commissioned art required for launch scope.** The critical mass exists:

- **Sprites**: Buch's CC0 Breakout set + expansions (bricks/paddles/balls/font/hearts/meter) is a complete Arkanoid-styled base in one consistent palette; Kenney Puzzle Pack 2, Tiny Break-em Pack, and Kenney UI/Input Prompts supply skin variety and chrome. All CC0, safe to commit to a public MIT repo.
- **SFX**: Junkala's 512 CC0 retro pack alone covers per-event variants; jsfxr (Unlicense) fills any gap procedurally with zero license surface.
- **Music/jingles**: Junkala's 5 CC0 action chiptunes + SketchyLogic's CC0 NES pack (incl. 3 jingles + boss track) cover level/boss/round-intro needs; MacLeod CC-BY remains optional depth, at the cost of a credits screen.

The only genuine gaps are Arkanoid-specific: **lettered capsule sprites and any Vaus-profile paddle/boss art** (§4) — small, bounded authoring tasks (a day or two of pixel work), not commissions. Theme differentiation beyond recoloring (distinct art *styles* per theme) will eventually want either more OGA pack archaeology or light custom art, but the game ships credibly on CC0 alone.

Caveats to carry into the spec:
- CraftPix freebies are unusable for an open repo (source-redistribution clause vs. public commits).
- freepd.com is gone — cite Pixabay Music only with per-track verification.
- OGA submissions are per-entry licenses: filter search by CC0 before browsing.
- LGPL/GPL-tagged OGA art (e.g., "Arcanoid starter set") is out.
- SketchyLogic music has a documented false-DMCA history — keep provenance records when committing.
