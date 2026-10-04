# Asset Pipeline Audit — Arkanoid Multiplayer

**Ticket:** #79 "Create Game Assets: Asset Pipeline, Sprites, Atlases, Style Bible Audit"
**Date:** 2026-09-30
**Auditor:** AI Agent (research skill)

---

## 1. Asset Manifest & Bundles — Loading Strategy, Caching, Versioning

### Current Implementation (`src/render/spriteSheet.ts:43-59`, `src/render/assetUrl.ts:1-22`)

| Aspect | Current State | Source |
|--------|---------------|--------|
| **Loading strategy** | Sequential `Assets.load()` calls in `for` loop (not parallelized) | `spriteSheet.ts:50-54` |
| **Manifest** | None — hardcoded `SPRITE_PATHS` object with 7 PNG paths | `spriteSheet.ts:10-24` |
| **Bundles** | None — each asset loaded individually | `spriteSheet.ts:45-49` |
| **Cache-busting** | None — Vite config has no `assetFileNames` with content hash | `vite.config.ts:9-36` |
| **Versioning** | None — no manifest, no version tracking | — |
| **Deploy base handling** | `assetUrl()` joins `import.meta.env.BASE_URL` at runtime (ticket 55) | `assetUrl.ts:20-22` |
| **Fallback** | Graceful degradation to procedural geometry on load failure | `spriteSheet.ts:55-57` |

### ADR 0004 Decision (Accepted 2026-09-30) — Planned Migration

> **Decision:** Adopt **PixiJS v8 AssetPack manifest + bundles** as the asset loading strategy.
> - Add `@pixi/assetpack` CLI to dev dependencies
> - Create `assetpack.config.js` packing all boot assets (sprite atlas, MSDF font atlas, background tile)
> - Generate `manifest.json` with content-hash filenames
> - Configure Vite with `assetFileNames: 'assets/[name]-[hash][extname]'` for cache-busting
> - Replace `loadSkinSprites()` with `await Assets.init({ manifest: assetUrl('manifest.json') }); await Assets.loadBundle('boot');`
> - Load bundles progressively — `boot` bundle first, `gameplay` bundle on demand

**Source:** `docs/adr/0004-asset-pipeline-manifest-bundles.md:19-48`

### Projected Texture Memory (ADR 0004)

| Bundle | Assets | Projected Memory |
|--------|--------|------------------|
| `boot` | Atlas (paddles, balls, particles, flash, UI), MSDF font, background | ~1.6 MB << 64 MB budget |

**Source:** `docs/adr/0004-asset-pipeline-manifest-bundles.md:50`

---

## 2. Sprite Atlas Generation — Current Sprites vs Style Bible

### Current Shipped Assets (Public Directory)

| Category | File | Dimensions | Size | Sprite Descriptor Path |
|----------|------|------------|------|------------------------|
| **Paddles** | `paddle-a-red.png` | 64×28 | 2,278 B | `/assets/paddles/paddle-a-red.png` |
| | `paddle-b-purple.png` | 64×28 | 2,233 B | `/assets/paddles/paddle-b-purple.png` |
| | `paddle-c-blue.png` | 64×28 | 2,292 B | `/assets/paddles/paddle-c-blue.png` |
| **Balls** | `ball-red.png` | 16×16 | 492 B | `/assets/balls/ball-red.png` |
| | `ball-yellow.png` | 16×16 | 519 B | `/assets/balls/ball-yellow.png` |
| | `ball-green.png` | 16×16 | 490 B | `/assets/balls/ball-green.png` |
| **Backgrounds** | `pixel-space.png` | 1344×1344 | 47,262 B | `/assets/backgrounds/pixel-space.png` |

**Source:** `public/assets/` directory scan + `spriteSheet.ts:10-24`

### Skin Registry (3 Skins) — `src/content/skins.ts:17-81`

| Skin ID | Name | Paddle Sprite | Ball Sprite | Provenance |
|---------|------|---------------|-------------|------------|
| `6f2a1c34-...` | Classic Vaus | `paddle-a-red.png` | `ball-red.png` | CC0 Tiny Break-em Pack |
| `a3d54b7e-...` | Neon Runner | `paddle-b-purple.png` | `ball-yellow.png` | CC0 Tiny Break-em Pack |
| `c8e91f2a-...` | Retro Arcade | `paddle-c-blue.png` | `ball-green.png` | CC0 Tiny Break-em Pack |

**Note:** All skins use **procedural geometry as fallback** when sprites fail to load (`spriteSheet.ts:37-40`). The sprite paths in skin descriptors are **root-relative** (`/assets/...`) and resolved against `BASE_URL` at runtime (`assetUrl.ts:14-16`).

### Theme Registry (3 Themes) — `src/content/themes.ts:14-84`

| Theme | Background Sprite |
|-------|-------------------|
| Arcade Classic | `null` (procedural flat color) |
| Deep Space | `pixel-space.png` (1344×1344 tileable) |
| Sunset Drive | `null` (procedural flat color) |

### Style Bible Compliance — **NO STYLE BIBLE EXISTS**

**Finding:** No style bible documentation found in the codebase (`glob **/style*bible*.md`, `**/art*.md` returned no results). The project relies on:

1. **Readability Gate** (`src/content/readabilityGate.ts`) — Enforces WCAG contrast ratios programmatically:
   - Owner glow vs theme background: ≥ 3.0 contrast ratio (`readabilityGate.ts:38,46-49`)
   - Ball skin tintability: baseColor luminance ≥ 0.7 (`readabilityGate.ts:56-58`)
   - Paddle trim visibility vs background: ≥ 3.0 contrast (`readabilityGate.ts:65-67`)

2. **Asset Provenance** (`skinTypes.ts:6-13`) — Every asset descriptor carries:
   - `source` string (e.g., "OGA 'Tiny Break-em Pack'")
   - `license: "CC0"` (hard constraint)
   - `production: "sourced" | "procedural"`

3. **Skin/Theme Design Rules** (embedded in type comments):
   - Owner-colored ball variants = **render-time tint on white-base sprites**, never per-owner PNGs (`skinTypes.ts:37-38`, `skins.ts:2-4`)
   - Paddle shape variants: "rounded" | "beveled" | "notched" (`skinTypes.ts:30-31`)
   - Ball surface patterns: "plain" | "panel" | "core" (`skinTypes.ts:41-42`)

---

## 3. Missing Assets for Identified Visual Effects

### Game Feel Audit Requirements (`docs/game-feel-audit.md`)

The audit identifies **zero existing event-driven visual effects** — the render pipeline is purely state-driven (`game-feel-audit.md:37`). Every impact event needs 3–5 visual feedback channels stacked within ~100 ms.

#### Required Asset Categories (Missing Entirely)

| Effect Type | Required Assets | Current Status |
|-------------|-----------------|----------------|
| **Particles** | Particle textures (spark, debris, burst, splat, rise, explode) — packed in atlas | ❌ None |
| **Hit Flash / White Flash** | 1×1 white pixel or small white quad texture (additive blend) | ❌ None |
| **Color Flash Overlays** | Full-field quad (rendered via Graphics, no texture needed) | ⚠️ Code only |
| **Squash & Stretch** | Uses existing paddle/ball sprites — **no new assets needed** | ✅ Procedural fallback covers |
| **Score/Event Pops** | BitmapFont (MSDF) — **no sprite assets needed** | ⚠️ Runtime atlas only |
| **Screen Shake** | No assets — GPU transform on container | ✅ Code only |
| **Boss Effects** | Boss hit/death particles, explosion texture | ❌ None |

#### Per-Event Asset Requirements (from `game-feel-audit.md:288-306`)

| Event | Particles | Flash | Squash/Stretch | Score Pop |
|-------|-----------|-------|----------------|-----------|
| `paddleBounce` | 6 sparks (cyan) | White 2 frames | Ball 1.3/0.7, Paddle 0.9/1.15 | — |
| `brickBreak` (row 0-1) | 10 debris (gold) | White 1 frame | Ball 1.15/0.85 | +50 at brick pos |
| `brickBreak` (row 5-6) | 10 debris (gold) | White 1 frame | Ball 1.15/0.85 | +score |
| `brickSilverHit` | 4 chips (gray) | White 1 frame | Ball 1.1/0.9 | +10 |
| `ballLaunch` | 8 trail | — | Ball 0.7/1.4, Paddle 1.1/0.9 | — |
| `ballLoss` | 20 splat (red) | Red 100ms | Ball 1.5/0.5 (splat) | -life |
| `capsuleCatch` | 12 burst (green) | Color 80ms | Paddle 1.1/0.9 | +bonus |
| `roundClear` | 40 rise (gold) | Gold 150ms | — | +bonus center |
| `bossHit` | 15 (orange) | White 2 frames | Ball 1.2/0.8 | — |
| `bossDead` | 50 explode | White 200ms | — | "BOSS CLEAR" |
| `chainEscalate` (4/7/10) | 8/12/16 (magenta) | Magenta escalating | — | "×2"/"×3"/"×4" |

#### Particle Presets Defined (Code Only — No Textures)

```typescript
// game-feel-audit.md:219-228
static presets = {
  brickBreak: { count: 10, color: 0xffee88, speed: 80, life: 0.4, gravity: 200 },
  brickSilverHit: { count: 4, color: 0xaaaaaa, speed: 50, life: 0.25 },
  paddleHit: { count: 6, color: 0x88ffff, speed: 60, life: 0.3 },
  ballLoss: { count: 20, color: 0xff4444, speed: 120, life: 0.6, gravity: 300 },
  capsuleCatch: { count: 12, color: 0x44ff88, speed: 100, life: 0.5 },
  roundClear: { count: 40, color: 0xffff44, speed: 150, life: 1.0, gravity: -50 },
  bossHit: { count: 15, color: 0xff8844, speed: 100, life: 0.5 },
  chainEscalate: { count: 8, color: 0xff44ff, speed: 80, life: 0.4 },
};
```

**Pool size estimate:** ~200 particles per field (split-screen: 2–4 fields → 400–800 total)

**Source:** `game-feel-audit.md:232-235`

---

## 4. Style Bible Compliance — Color Palette, Pixel Art Constraints, Animation Frames

### Current Color Palettes (Extracted from Code)

#### Player Colors (Ownership) — `shared/playerColors.ts` (referenced in `readabilityGate.ts:6`)

```typescript
// 4 player colors used for ownership glow/tint/bars
PLAYER_COLORS = [0xff4444, 0x44ff44, 0x4444ff, 0xff44ff] // Red, Green, Blue, Magenta
```

#### Skin Palettes (3 Skins) — `skins.ts:17-81`

| Skin | Paddle Body | Paddle Trim | Paddle Stripes | Ball Base | Ball Pattern |
|------|-------------|-------------|----------------|-----------|--------------|
| Classic Vaus | 0xe8b04a (gold) | 0xf8f8f8 (white) | 0 | 0xf8f8f8 (white) | plain |
| Neon Runner | 0x282838 (dark) | 0x00fcfc (cyan) | 3× 0x00fcfc | 0xf0f0f0 (off-white) | panel |
| Retro Arcade | 0xd82800 (red) | 0xfcbcd0 (pink) | 2× 0xfcbcd0 | 0xf8f8f8 (white) | core |

#### Theme Brick Palettes (6 Tiers + Silver + Gold) — `themes.ts:17-55`

| Theme | Tier 1 | Tier 2 | Tier 3 | Tier 4 | Tier 5 | Tier 6 | Silver | Gold |
|-------|--------|--------|--------|--------|--------|--------|--------|------|
| Arcade Classic | 0xd82800 | 0xfc9838 | 0xfcbcd0 | 0x58f898 | 0x00fcfc | 0x00b8fc | 0xbcbcbc | 0xdca850 |
| Deep Space | 0xc84838 | 0xe88848 | 0xf8c890 | 0x78c878 | 0x48c8e8 | 0x4878e8 | 0xa8a8b8 | 0xd8a840 |
| Sunset Drive | 0xf85838 | 0xf88848 | 0xf8b878 | 0xc87858 | 0xe878b8 | 0xb85898 | 0xc0c0c0 | 0xe8b850 |

#### Capsule Colors (10 Types) — `capsulePills.ts:22-32`

| Letter | Effect | Pill Color | Letter Color |
|--------|--------|------------|--------------|
| B | Break | 0x3cbcfc | 0x101018 |
| C | Catch | 0x58d858 | 0x101018 |
| D | Disruption | 0xf878f8 | 0x101018 |
| E | Expand | 0xf84828 | 0xf8f8f8 |
| L | Laser | 0xf8b838 | 0x101018 |
| M | Multiball | 0x00fcfc | 0x101018 |
| P | Player (life) | 0xe8b04a | 0x101018 |
| S | Slow | 0x8878f8 | 0xf8f8f8 |
| R | Reduce | 0x883828 | 0xf8f8f8 |
| ? | Mystery | 0xd8d8e8 | 0x101018 |

### Pixel Art Constraints (Implicit from Asset Dimensions)

| Asset Type | Logical Size | Pixel Dimensions | Constraint |
|------------|--------------|------------------|------------|
| Paddle | Variable (w×h) | 64×28 px | 64px wide source, scaled to logical w |
| Ball | Radius 3 | 16×16 px | 16px square, centered |
| Background | 224×224 field | 1344×1344 px | 6× field size (tileable) |
| Capsule | 12×6 logical | Procedural (no PNG) | Glyph: 3×5 pixels @ 1 unit/px |
| Boss (Doh) | 48×32 logical | Procedural (no PNG) | Moai silhouette |

**No animation frames exist** — all current sprites are single-frame static images.

### Readability Gate Enforcement (Automated Tests)

```typescript
// readabilityGate.ts:70-78
function skinPassesGate(skin, theme) {
  return ballSkinTintable(skin.ball)      // luminance ≥ 0.7
    && paddleTrimVisible(skin.paddle, theme)  // contrast ≥ 3.0
    && PLAYER_COLORS.every(c => glowPassesTheme(c, theme)); // contrast ≥ 3.0
}
```

**Source:** `src/content/readabilityGate.ts:37-78`

---

## 5. Atlas Packing Efficiency & Runtime Texture Memory

### Current Texture Memory (Estimated)

| Asset | Count | Dimensions | Format | Est. GPU Memory |
|-------|-------|------------|--------|-----------------|
| Paddle sprites | 3 | 64×28 | RGBA8888 | 3 × 64×28×4 = **21.5 KB** |
| Ball sprites | 3 | 16×16 | RGBA8888 | 3 × 16×16×4 = **3 KB** |
| Background | 1 | 1344×1344 | RGBA8888 | 1344×1344×4 = **7.2 MB** |
| **Total (current)** | 7 | — | — | **~7.2 MB** |

**Note:** Background dominates at 99% of texture memory. Paddle/ball sprites are negligible.

### Projected Atlas (Post-AssetPack)

Per ADR 0004 and PixiJS v8 best practices (`pixijs-v8-best-practices.md:350-351`):

> **Texture atlas all sprites (paddle, ball, bricks, powerups) → single texture = max batching**

**Recommended Atlas Layout:**

| Atlas Region | Content | Est. Size |
|--------------|---------|-----------|
| Paddles | 3 × 64×28 | 192×28 = 5,376 px |
| Balls | 3 × 16×16 | 48×16 = 768 px |
| Particles | ~8 variants × 8×8 | 64×64 = 4,096 px |
| Flash quad | 1×1 white | 1×1 = 1 px |
| UI elements | Buttons, icons, HUD | ~128×128 = 16,384 px |
| **Total atlas** | — | **~256×256 or 512×512** |
| **GPU Memory** | 512×512×4 | **1 MB** |

**Background tile** should remain separate (1344×1344 = 7.2 MB) or be downsampled/replaced with procedural starfield for memory savings.

### Packing Efficiency Metrics

| Metric | Current | Projected (Atlas) |
|--------|---------|-------------------|
| Texture binds per frame | 7 (one per sprite) | 1 (atlas) + 1 (background) |
| Draw calls (sprites) | 7+ (no batching) | 1-2 (batched via atlas) |
| Texture memory | ~7.2 MB | ~8.2 MB (atlas + background) |
| Cache efficiency | Poor (7 requests) | Excellent (2 requests + manifest) |

**Source:** `pixijs-v8-best-practices.md:350-351,364-367`

---

## Summary of Gaps & Required Work

### Critical (Blocking Visual Effects Implementation)

| Gap | Required Action | Effort |
|-----|-----------------|--------|
| **No AssetPack manifest/bundles** | Add `@pixi/assetpack`, create config, generate manifest | Medium |
| **No cache-busting** | Add `assetFileNames: 'assets/[name]-[hash][extname]'` to Vite | Low |
| **No particle textures** | Create/source CC0 particle sprites (spark, debris, burst, splat) | Medium |
| **No white flash texture** | Add 1×1 white pixel to atlas | Trivial |
| **No MSDF font atlas** | Generate via AssetPack font config (per `pixijs-v8-best-practices.md:253-274`) | Medium |

### High Priority (Style Bible & Consistency)

| Gap | Required Action | Effort |
|-----|-----------------|--------|
| **No style bible document** | Create `docs/STYLE_BIBLE.md` documenting: color palette, pixel grid (1 unit = 1px?), animation frame counts, naming conventions, CC0 sourcing rules | Medium |
| **Background memory heavy** | Evaluate procedural starfield replacement or downsample `pixel-space.png` | Low |
| **Animation frames undefined** | Specify frame counts for: paddle idle/active, ball spin, capsule pulse, boss phases | Medium |

### Medium Priority (Pipeline Polish)

| Gap | Required Action | Effort |
|-----|-----------------|--------|
| **Sequential loading** | Replace `loadSkinSprites()` with `Assets.loadBundle('boot')` | Low (after manifest) |
| **No versioning** | Manifest provides implicit versioning via content hashes | Included in manifest work |
| **No progressive loading** | Define `gameplay` bundle for boss/level-specific assets | Low |

---

## File References

| File | Purpose |
|------|---------|
| `src/render/assetUrl.ts:1-22` | Deploy-base-aware asset URL resolution |
| `src/render/spriteSheet.ts:1-59` | Sprite path descriptors, loading, caching, fallback |
| `src/content/skins.ts:1-98` | 3 player skin definitions with sprite paths |
| `src/content/themes.ts:1-96` | 3 field theme definitions with background sprite |
| `src/content/skinTypes.ts:1-120` | Type definitions for all asset descriptors |
| `src/content/readabilityGate.ts:1-79` | Automated contrast/visibility validation |
| `src/content/capsulePills.ts:1-38` | 10 capsule type color codings |
| `src/content/bosses.ts:1-27` | Doh boss procedural descriptor |
| `docs/adr/0004-asset-pipeline-manifest-bundles.md:1-71` | Accepted ADR for AssetPack migration |
| `docs/pixijs-v8-best-practices.md:1-438` | PixiJS v8 optimization research (asset pipeline §2) |
| `docs/game-feel-audit.md:1-529` | Visual effects requirements (particles, flash, squash, pops) |
| `vite.config.ts:1-37` | Current Vite config (no asset hashing) |
| `public/assets/paddles/*.png` | 3 paddle sprites (64×28) |
| `public/assets/balls/*.png` | 3 ball sprites (16×16) |
| `public/assets/backgrounds/pixel-space.png` | 1 background (1344×1344) |

---

## Conclusion

The asset pipeline is **functional but pre-production**: it loads 7 individual PNGs sequentially with no manifest, no cache-busting, and no atlas. The ADR 0004 decision charts a clear path to PixiJS v8 AssetPack manifests + bundles. The **style bible does not exist** as a document — design constraints are encoded in TypeScript types and the automated readability gate.

**Critical blockers for visual effects (ticket #79 scope):**
1. Particle textures (8+ variants) must be created/sourced and added to atlas
2. AssetPack manifest + atlas generation must be implemented first
3. MSDF font atlas needed for score pops (BitmapText)

**Recommended order:**
1. Implement AssetPack manifest + bundles (ADR 0004)
2. Create particle texture atlas (source CC0 or author procedural → bake)
3. Generate MSDF font atlas
4. Document style bible (palette, grid, animation specs)
5. Implement visual effects orchestrator consuming new assets