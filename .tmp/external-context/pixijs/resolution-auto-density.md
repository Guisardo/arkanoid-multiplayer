# PixiJS v8 — resolution / autoDensity / Canvas Sizing

Fetched: 2026-09-08. Sources: pixijs/pixijs `dev` branch (v8 line, latest v8.16.x) raw source + Context7.

## Core mechanism (CanvasSource.resizeCanvas)

`src/rendering/renderers/shared/texture/sources/CanvasSource.ts`:

```ts
public resizeCanvas()
{
    if (this.autoDensity && 'style' in this.resource)
    {
        this.resource.style.width = `${this.width}px`;
        this.resource.style.height = `${this.height}px`;
    }

    // only resize if wee need to, as this clears the canvas (even if values are set to the same)
    if (this.resource.width !== this.pixelWidth || this.resource.height !== this.pixelHeight)
    {
        this.resource.width = this.pixelWidth;
        this.resource.height = this.pixelHeight;
    }
}
```

Semantics (TextureSource, `src/rendering/renderers/shared/texture/sources/TextureSource.ts`):
- `width`/`height` = logical size (CSS px). `pixelWidth = Math.round(width * resolution)` = backing store.
- `resize(width, height, resolution)`: `newPixelWidth = Math.round(width * resolution)`; sets `this.width = newPixelWidth / resolution`; updates `pixelWidth/pixelHeight`; returns `didResize`.
- `CanvasSource.resize()` calls `super.resize()` then `resizeCanvas()` **only if didResize**.

## Answers

### 1. `autoDensity: true`
YES — sets `canvas.style.width/height` to logical size (`this.width` px = CSS px) while canvas backing store (`canvas.width/height` attributes) = `pixelWidth/pixelHeight` = logical × resolution. Guarded by `'style' in this.resource` → ignored for OffscreenCanvas. ViewSystemOptions doc: "Resizes renderer view in CSS pixels to allow for resolutions other than 1. This is only supported for HTMLCanvasElement and will be ignored if the canvas is an OffscreenCanvas."

### 2. `autoDensity: false` + `resolution: 2`
YES — `resizeCanvas()` skips the style block entirely → canvas element gets NO CSS width/height from Pixi → browser default CSS size of a canvas = its attribute size in px = backing store = 2× logical. Canvas renders 2× larger than intended on screen (unless external CSS constrains it). Backing store itself is still `width × 2`.

Also constructor note (CanvasSource): when no `width` option passed and `!autoDensity`, existing `resource.width` is divided by resolution to derive logical width (existing canvas treated as backing store); with autoDensity, `resource.width` is taken as logical directly.

### 3. `resizeTo` interaction
`src/app/ResizePlugin.ts`: on window `resize` event (rAF-throttled via `queueResize`), reads target size in **CSS px** (`window.innerWidth/innerHeight` or element `clientWidth/clientHeight`), then calls `renderer.resize(width, height)`.

`AbstractRenderer.resize(desiredScreenWidth, desiredScreenHeight, resolution?)` → `view.resize(...)` → `texture.source.resize(width, height, resolution)` → `CanvasSource.resizeCanvas()`. So:
- `resizeTo` supplies **logical/CSS px** dimensions.
- resolution multiplies backing store only.
- `autoDensity: true` → CSS size stays = resizeTo target size; `autoDensity: false` → CSS size = backing store (2× if resolution 2).
- `app.screen` (ViewSystem.screen) updated to logical size (`screen.width = texture.frame.width`).
- ResizePlugin doc: "For high-DPI output, combine it with `autoDensity: true` and `resolution: window.devicePixelRatio`."

### 4. Runtime `renderer.resolution` setter
YES — respects autoDensity. `AbstractRenderer`:
```ts
set resolution(value: number)
{
    this.view.resolution = value;
    this.runners.resolutionChange.emit(value);
}
```
`ViewSystem.resolution` setter → `this.texture.source.resize(this.texture.source.width, this.texture.source.height, value)` → `CanvasSource.resize()` → `resizeCanvas()` → re-applies CSS style (if autoDensity) + backing store with new resolution. Caveat: `TextureSource.resize` returns `didResize=false` if `pixelWidth/pixelHeight` unchanged (e.g. resolution change compensated by size) → `resizeCanvas()` skipped.

## Source URLs
- https://github.com/pixijs/pixijs/blob/dev/src/rendering/renderers/shared/texture/sources/CanvasSource.ts
- https://github.com/pixijs/pixijs/blob/dev/src/rendering/renderers/shared/texture/sources/TextureSource.ts
- https://github.com/pixijs/pixijs/blob/dev/src/rendering/renderers/shared/view/ViewSystem.ts
- https://github.com/pixijs/pixijs/blob/dev/src/rendering/renderers/shared/system/AbstractRenderer.ts
- https://github.com/pixijs/pixijs/blob/dev/src/app/ResizePlugin.ts
- https://github.com/pixijs/pixijs/blob/dev/skills/pixijs-application/references/application-options.md
- https://pixijs.com/8.x/guides/components/application (resize-plugin guide: https://pixijs.com/8.x/guides/components/application/resize-plugin)
