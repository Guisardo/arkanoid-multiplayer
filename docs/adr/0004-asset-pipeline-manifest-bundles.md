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

## As built (ticket 87)

The `boot`/`gameplay` split above is real, but the contents differ from the sketch:

- **Two atlases, one per bundle.** `raw-assets/boot{m}/boot-atlas{tps}` holds the
  background frame; `raw-assets/gameplay{m}/gameplay-atlas{tps}` holds paddles, balls
  and all eight particle frames. Aliases are `boot-atlas` and `gameplay-atlas`.
- **Particles stay in one atlas.** Frames cut from one image share a `TextureSource`,
  which is what keeps the `ParticleContainer` effect layer at one draw call. Splitting
  particle frames across bundles would break that; paddles and balls are plain sprites
  outside the particle layer, so the background having its own source costs nothing.
- **No level- or mode-specific assets yet.** None exist (art production is out of scope).
  The bundle is the seam they will be added to, not a place they already live.
- **Match start waits, with progress.** `startWithGameplayAssets` (`src/app/gameplayLoad.ts`)
  shows `LoadingScreen` while a cold `gameplay` load is in flight and starts the match
  without one when the bundle is cached. A failed load still starts the match on
  procedural geometry and logs the cause.
- **Not wired: multiplayer.** `MpFlow.mountRender` builds its fields synchronously
  mid-handshake, so it still requests the bundle without waiting
  (`void ensureGameplayAssets()`) and upgrades from procedural geometry when it lands.
- **Rebuilding assets.** `npm run assetpack` regenerates `public/assets`; delete stale
  `atlas-*` outputs first, since AssetPack does not remove files for removed sources.

