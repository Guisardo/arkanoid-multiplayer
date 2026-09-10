// Asset URL resolution (ticket 55): runtime-loaded sprites (Pixi
// Assets.load) bypass Vite's build-time base rewriting — hardcoded
// "/assets/..." strings resolve against the site root and 404 on GH Pages
// project sites (served under /<repo>/). Pure join fed by the injected base;
// the module wrapper reads import.meta.env once at the edge (deployEnv
// pattern — everything else stays unit-testable with plain strings).
export const ASSET_BASE: string = import.meta.env.BASE_URL;

/** Join a deploy base with a root-relative asset path (pure). */
export function joinAssetUrl(base: string, path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://") || path.startsWith("data:")) {
    return path; // absolute URLs pass through untouched
  }
  const b = base.endsWith("/") ? base.slice(0, -1) : base;
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}${p}`;
}

/** Resolve an asset path against the deploy base (import.meta.env.BASE_URL). */
export function assetUrl(path: string): string {
  return joinAssetUrl(ASSET_BASE, path);
}
