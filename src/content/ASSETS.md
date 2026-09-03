# Asset provenance (spec §13)

All shipped assets are CC0 (public domain) — zero attribution obligation.
Provenance per asset recorded below; the optional Credits screen + README
assets line ship separately.

## Current status: procedural placeholders

Real CC0 pack downloads (Kenney Puzzle Pack 2, Buch OGA Breakout set, Tiny
Break-em Pack, OGA Pixel Space, Kenney UI Pack / Input Prompts) were
**blocked in this environment** — no network + no shell execution available
to the implementing agent. Per the ticket's fallback instruction, the full
registry + readability-gate machinery ships with **procedural placeholder
assets** (authored in-repo descriptors rendered as Pixi Graphics geometry —
same approach as the runtime-generated BitmapFont atlas in
`src/render/gameFont.ts`). The gap is documented here; swapping descriptors
for real sprite PNGs later is a render-layer change only (paint functions in
`src/render/skinPainter.ts`), registries and gate stay untouched.

## Registries

| Registry | File | Contents |
|---|---|---|
| Player skins (paddle + ball) | `src/content/skins.ts` | 3 skins, UUID ids |
| Field themes (brick set + background + chrome tint) | `src/content/themes.ts` | 3 themes, UUID ids |
| Capsule pills (10 letters) | `src/content/capsulePills.ts` | B C D E L M P S R ? |
| Doh boss sprite (data only — behavior ticket 49) | `src/content/bosses.ts` | 1 boss |

## Per-asset provenance

| Asset | Source | License | Production |
|---|---|---|---|
| All skins, themes, pills, boss (current) | authored in-repo (procedural descriptor) | CC0 | procedural |

## Intended real-asset sources (when downloads unblock)

Per the all-CC0 recipe (research doc 20, verified 2026-09-02):

- **Paddle skins**: Kenney Puzzle Pack 2 (primary) / OGA "Breakout set" by
  Buch (14 bars) / OGA "Tiny Break-em Pack" (30 paddles) — all CC0.
- **Ball skins**: Tiny Break-em Pack (33 balls) / Buch set (7) / OGA
  "Breakout graphics" by Mopz. Owner-colored variants = render-time tint on
  white-base sprites — **never authored per-owner PNGs**.
- **Brick sets**: Buch OGA Breakout set + surt/InanZen expansions /
  Kenney Puzzle Pack 2 / Tiny Break-em Pack.
- **Capsule pills**: custom-authored lettered pills (no free pack ships
  Arkanoid lettered capsules — research §4.1). Current: pill-template +
  3×5 pixel-glyph composite (`src/render/pillGlyphs.ts`).
- **Field backgrounds**: OGA "Pixel Space Background" (64×64 tileable) /
  Kenney Background Elements — darkening overlay pass regardless of source.
- **UI chrome**: Kenney UI Pack (430) + Kenney Game Icons (105).
- **Touch glyphs**: Kenney Input Prompts (1500).

Excluded per license rules: CraftPix freebies (custom license vs public
commits), freepd.com (dead), LGPL/GPL OGA entries, Game-icons.net +
incompetech (CC-BY — CC0 equivalents exist).

## Readability gate

Every shipped skin/theme must pass `src/content/readabilityGate.ts` (spec
§13 hard constraint): owner-colored outline glow (owner color + white
outline) renders over whatever skin the ball wears — never the sole signal
for Duel ball ownership. Enforced by unit tests over the full registry ×
theme matrix.
