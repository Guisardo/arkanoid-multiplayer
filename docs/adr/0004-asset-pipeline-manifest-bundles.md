# ADR 0004: Asset Pipeline — PixiJS v8 Manifest + Bundles

**Status**: Accepted  
**Date**: 2026-09-30  
**Related**: #65, #79, #83, #84

## Context

Current asset loading (`src/render/spriteSheet.ts:43-59`):
- Sequential `Assets.load()` calls in a `for` loop (not parallelized)
- No manifest.json, no `Assets.init({ manifest })`, no `Assets.loadBundle()`
- No cache-busting (no content-hash filenames in Vite config)
- No versioning strategy
- 7 separate PNGs loaded individually → batch breaks on skin/theme change
- Procedural fallback degrades gracefully but is not a loading strategy

PixiJS v8 recommends AssetPack CLI for manifest generation and bundle loading (§2 of `pixijs-v8-best-practices.md`).

## Decision

Adopt **PixiJS v8 AssetPack manifest + bundles** as the asset loading strategy.

### Implementation

1. **Add `@pixi/assetpack` CLI** to dev dependencies
2. **Create `assetpack.config.js`** packing all boot assets:
   - Sprite atlas (paddles, balls, particles, flash, UI)
   - MSDF font atlas
   - Background tile
3. **Generate `manifest.json`** with content-hash filenames
4. **Configure Vite** with `assetFileNames: 'assets/[name]-[hash][extname]'` for cache-busting
5. **Replace `loadSkinSprites()`** with:
   ```typescript
   await Assets.init({ manifest: assetUrl('manifest.json') });
   await Assets.loadBundle('boot');
   ```
6. **Load bundles progressively** — `boot` bundle first, `gameplay` bundle on demand

### Bundle Structure

```json
{
  "bundles": [
    { "name": "boot", "assets": ["atlas.png", "font.fnt", "background.png"] },
    { "name": "gameplay", "assets": [] }
  ]
}
```

All current assets fit in `boot` bundle (~1.6 MB projected texture memory << 64 MB budget).

## Consequences

**Positive:**
- Parallel loading via `Assets.loadBundle()`
- Cache-busting via content hashes
- Single texture bind for all sprites (atlas)
- MSDF font pre-baked → no runtime atlas generation
- Versioning via manifest
- Foundation for code-splitting (future bundles)

**Negative:**
- Build step added (AssetPack CLI)
- Manifest must be regenerated on asset changes
- Learning curve for AssetPack config

## Alternatives Considered

- **Keep current sequential loading** — rejected: no parallel fetch, no cache-busting, batch breaks
- **Custom manifest without AssetPack** — rejected: reinventing PixiJS v8 standard
- **Lazy-load per sprite** — rejected: waterfall requests, worse UX