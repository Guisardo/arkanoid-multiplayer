# Asset provenance (spec §13)

All shipped assets are CC0 (public domain) — zero attribution obligation.
Provenance per asset recorded below; the optional Credits screen + README
assets line ship separately.

## Registries

| Registry | File | Contents |
|---|---|---|
| Player skins (paddle + ball) | `src/content/skins.ts` | 3 skins, UUID ids |
| Field themes (brick set + background + chrome tint) | `src/content/themes.ts` | 3 themes, UUID ids |
| Capsule pills (10 letters) | `src/content/capsulePills.ts` | B C D E L M P S R ? |
| Doh boss sprite (data only — behavior ticket 49) | `src/content/bosses.ts` | 1 boss |

## Per-asset provenance

| Asset | Files | Source | License | Production |
|---|---|---|---|---|
| Paddle sprites (3) | `public/assets/paddles/paddle-{a-red,b-purple,c-blue}.png` | OGA "Tiny Break-em Pack" (Screaming Brain Studios) | CC0 | sourced |
| Ball sprites (3) | `public/assets/balls/ball-{red,yellow,green}.png` | OGA "Tiny Break-em Pack" (Screaming Brain Studios) | CC0 | sourced |
| Field background (Deep Space theme) | `public/assets/backgrounds/pixel-space.png` | OGA "Pixel Space Background" (ZaninDevelopers) | CC0 | sourced |
| Capsule pills (10) | `src/render/pillGlyphs.ts` composite | custom-authored (no free pack ships lettered capsules — research §4.1) | CC0 | procedural |
| Brick fills + crack overlays | `src/render/brickCracks.ts` + theme tier colors | custom-authored (procedural tint+crack per spec §13) | CC0 | procedural |
| Doh boss sprite | `src/render/skinPainter.ts` paintBoss | custom-authored moai silhouette (behavior ticket 49) | CC0 | procedural |

## Sprite loading + fallback

`src/render/spriteSheet.ts` preloads every shipped sprite once at boot
(`loadSkinSprites`, called from `src/app/main.ts`). Any failure — node test
environment, missing file, network error — degrades to the procedural
geometry painters in `src/render/skinPainter.ts`. The readability gate
(owner glow ring) renders on the geometry layer, so ownership stays visible
over whatever the ball wears, sprite or not.

Owner-colored ball variants are a render-time tint/glow on the base sprite —
never authored per-owner PNGs.

## Excluded per license rules

CraftPix freebies (custom license vs public commits), freepd.com (dead),
LGPL/GPL OGA entries, Game-icons.net + incompetech (CC-BY — CC0 equivalents
exist). Kenney packs (Puzzle Pack 2, UI Pack, Input Prompts) remain available
as future CC0 sources for UI chrome + touch glyphs (tickets 41/42).
