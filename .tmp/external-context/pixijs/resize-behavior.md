# PixiJS v8 — resizeTo / renderer.resize / runtime resolution

Fetched: 2026-09-08. Source: pixijs/pixijs `dev` (v8 line) raw source.

## ResizePlugin (src/app/ResizePlugin.ts)

- `app.init({ resizeTo: window | HTMLElement | null })`; reassignable at runtime (`app.resizeTo = ...`).
- Listens `globalThis` `resize` event → `queueResize()` → rAF-throttled `resize()`.
- `resize()` measures target in CSS px:
  - window → `globalThis.innerWidth/innerHeight`
  - element → `clientWidth/clientHeight`
- Then `this.renderer.resize(width, height); this.render();`
- Manual: `app.resize()` immediate, `app.queueResize()` next frame, `app.cancelResize()`.

## Renderer resize chain

`AbstractRenderer.resize(desiredScreenWidth, desiredScreenHeight, resolution?)`:
```ts
public resize(desiredScreenWidth: number, desiredScreenHeight: number, resolution?: number): void
{
    this.view.resize(desiredScreenWidth, desiredScreenHeight, resolution);
    this.emit('resize', this.view.screen.width, this.view.screen.height, this.view.resolution);
}
```
`ViewSystem.resize` → `texture.source.resize(w, h, resolution)`; `screen.width/height = texture.frame.width/height` (logical).

## Runtime resolution setter

`AbstractRenderer`:
```ts
set resolution(value: number)
{
    this.view.resolution = value;
    this.runners.resolutionChange.emit(value);
}
```
`ViewSystem.resolution` setter → `texture.source.resize(source.width, source.height, value)` → CanvasSource.resizeCanvas → CSS style re-applied when autoDensity (see resolution-auto-density.md). Emits `resolutionChange` runner for dependent systems (text, events, canvas).

## Application options (skills/pixijs-application/references/application-options.md)

- `width`/`height`: initial size in CSS px. Defaults 800/600.
- `resolution`: device pixel ratio, default 1. Use `window.devicePixelRatio` for HiDPI.
- `autoDensity`: scale CSS dimensions so width/height stay CSS px while backing store matches resolution. HTMLCanvasElement only. Default false.
- `resizeTo`: window | HTMLElement | null (null = disable auto-resize).

## URLs
- https://github.com/pixijs/pixijs/blob/dev/src/app/ResizePlugin.ts
- https://github.com/pixijs/pixijs/blob/dev/src/rendering/renderers/shared/system/AbstractRenderer.ts
- https://github.com/pixijs/pixijs/blob/dev/src/rendering/renderers/shared/view/ViewSystem.ts
- https://pixijs.com/8.x/guides/components/application/resize-plugin
