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
| Paddle sprites (3) | `raw-assets/gameplay{m}/gameplay-atlas{tps}/paddle-{a-red,b-purple,c-blue}.png` | OGA "Tiny Break-em Pack" (Screaming Brain Studios) | CC0 | sourced |
| Ball sprite (1, shared by every Skin) | `raw-assets/gameplay{m}/gameplay-atlas{tps}/ball-base.png`, generated from `scripts/sources/ball-yellow.png` by `scripts/gen-ball-frame.mjs` | OGA "Tiny Break-em Pack" (Screaming Brain Studios), lifted to a white base | CC0 | sourced |
| Field background (Deep Space theme) | `raw-assets/boot{m}/boot-atlas{tps}/pixel-space.png` | OGA "Pixel Space Background" (ZaninDevelopers) | CC0 | sourced |
| Capsule pills (10) | `src/render/pillGlyphs.ts` composite | custom-authored (no free pack ships lettered capsules — research §4.1) | CC0 | procedural |
| Brick fills + crack overlays | `src/render/brickCracks.ts` + theme tier colors | custom-authored (procedural tint+crack per spec §13) | CC0 | procedural |
| Doh boss sprite | `src/render/skinPainter.ts` paintBoss | custom-authored moai silhouette (behavior ticket 49) | CC0 | procedural |

## Sprite keys

Skins and Field themes name their art by **atlas frame name**, taken from
`SPRITE_PATHS` in `src/content/spriteFrames.ts` (for example
`SPRITE_PATHS.paddles.purple` = `"paddle-b-purple.png"`). That is the exact
key the loader registers textures under. Never use a public path such as
`"/assets/paddles/..."`: it misses every lookup (issue #152), and
`tests/content/skinsThemes.test.ts` asserts each key exactly.

## Sprite loading + fallback

`src/render/spriteSheet.ts` loads the `boot` atlas at startup and the
`gameplay` atlas (paddles, the ball, particles) when a match is created
(ADR 0004). The sprite art is a Skin's canonical look. Every Paddle wears its
owner's Skin (a three-slice: the end caps keep the art's aspect, only the
middle stretches) and every ball draws the shared white-base frame.

Procedural geometry (`src/render/skinPainter.ts`, painted in the same palette:
gray body, the Skin's accent) is drawn only when a frame is unavailable: node
tests, an atlas that failed to load, or a field built before its atlas
landed, which upgrades on a later sync. Once an atlas has loaded, a Skin or
Field theme key with no frame logs `console.error` once per key, with the
owner's id. It is a content bug, not a fallback.

The readability gate (owner glow ring) renders on the geometry layer under
the ball sprites, so ownership stays visible over whatever the ball wears.

Owner-colored ball variants are a render-time tint on the white-base sprite,
applied only when 2+ players share a field (a solo ball stays untinted white).
They are never authored per-owner PNGs. `ball-base.png` keeps every body texel
at luminance ≥ 0.7, so the tint dominates. Regenerate it with
`npm run assets:ball`.

## Excluded per license rules

CraftPix freebies (custom license vs public commits), freepd.com (dead),
LGPL/GPL OGA entries, Game-icons.net + incompetech (CC-BY — CC0 equivalents
exist). Kenney packs (Puzzle Pack 2, UI Pack, Input Prompts) remain available
as future CC0 sources for UI chrome + touch glyphs (tickets 41/42).
