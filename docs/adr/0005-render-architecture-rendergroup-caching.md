# ADR 0005: Render Architecture — RenderGroup + cacheAsTexture for Static Layers

**Status**: Accepted  
**Date**: 2026-09-30  
**Related**: #65, #78, #85, #88

## Context

Current render architecture (`src/render/fieldView.ts`):
- Each `FieldView` owns 6 `Graphics` objects + 3 `Sprite` + 2 `BitmapText`
- Bricks redrawn via incremental diff (`diffBricks()` from `sceneSync.ts`) — only changed cells
- **No `RenderGroup` usage** — each `Graphics` is separate draw call
- **No `cacheAsTexture`** — static brick wall re-rendered every frame
- Split-screen: all fields render every frame, no frustum culling
- ~15 draw calls/field (measured), 4 fields = ~60 draw calls

PixiJS v8 `RenderGroup` + `cacheAsTexture` recommended for static layers (§3 of `pixijs-v8-best-practices.md`).

## Decision

Introduce **`RenderGroup` + `cacheAsTexture` for the static brick layer** and **shared `GraphicsContext` for brick variants**.

### Implementation

1. **Brick layer as `RenderGroup` with `cacheAsTexture = true`**:
   ```typescript
   const brickGroup = new RenderGroup();
   brickGroup.cacheAsTexture = true;
   brickGroup.begin(); // draw all bricks once
   brickGroup.end();
   ```
   - Only invalidated when bricks actually change (break, silver hit, capsule drop)
   - Single draw call for entire brick wall per field

2. **Shared `GraphicsContext` per brick tier + crack style**:
   - Pre-record 6 tiers × 3 crack styles = 18 `GraphicsContext` objects
   - `brickGfx.drawContext(context)` instead of redrawing paths
   - Eliminates per-frame path construction overhead

3. **Capsule/ball/paddle remain dynamic** — re-rendered each frame (low object count)

4. **Split-screen culling** (separate ADR 0007): skip `FieldView.sync()` for off-screen fields

## Consequences

**Positive:**
- Brick wall: 1 draw call/field (vs ~6 `Graphics` + incremental redraw)
- `GraphicsContext` eliminates path rebuild cost
- Texture memory: brick texture cached once per field (~208×256 × 4 bytes = ~200 KB/field)
- Scales to 4-player split-screen: 4 draw calls vs 60+

**Negative:**
- `cacheAsTexture` allocates render texture (VRAM)
- Must manually invalidate on brick changes (already have `diffBricks()`)
- `RenderGroup` API is v8-specific (migration cost if switching engines)

## Alternatives Considered

- **Keep incremental `Graphics` redraw** — rejected: still multiple draw calls, path rebuild overhead
- **Single `Graphics` for all bricks** — rejected: no culling, no texture caching, harder to invalidate
- **Sprite-based bricks from atlas** — rejected: atlas space, more complex hit testing

## Validation

Per `pixijs-v8-best-practices.md` §3: "RenderGroup + cacheAsTexture for static layers is the single highest-impact render optimization for tile-based games."