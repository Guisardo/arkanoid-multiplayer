// The shipped AssetPack manifest (ADR 0004, ticket 87).
//
// `public/assets/manifest.json` is build output, and the loader only knows
// bundle and alias NAMES — if a rebuild renames a bundle or drops a frame, the
// game silently falls back to procedural art. So this reads the committed
// output, not a mock, and checks the contract the loader relies on: which
// bundle holds which frames, and that the particle frames stay together.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SPRITE_PATHS } from "render/spriteSheet";

const ASSETS_DIR = join(process.cwd(), "public", "assets");

interface ManifestAsset {
  alias: string[];
  src: Array<{ src: string }>;
}
interface Manifest {
  bundles: Array<{ name: string; assets: ManifestAsset[] }>;
}
interface FrameTable {
  frames: Record<string, unknown>;
  meta: { image: string };
}

const manifest = JSON.parse(readFileSync(join(ASSETS_DIR, "manifest.json"), "utf8")) as Manifest;

function bundle(name: string): Manifest["bundles"][number] {
  const found = manifest.bundles.find((b) => b.name === name);
  if (found === undefined) throw new Error(`manifest declares no "${name}" bundle`);
  return found;
}

/** Every frame table (PNG and WebP variants) a bundle's `<name>-atlas` asset ships. */
function frameTables(name: string): FrameTable[] {
  const atlas = bundle(name).assets.find((a) => a.alias.includes(`${name}-atlas`));
  if (atlas === undefined) throw new Error(`"${name}" bundle has no ${name}-atlas asset`);
  return atlas.src.map((s) => JSON.parse(readFileSync(join(ASSETS_DIR, s.src), "utf8")) as FrameTable);
}

const BOOT_FRAMES = Object.values(SPRITE_PATHS.backgrounds);
const GAMEPLAY_FRAMES = [
  ...Object.values(SPRITE_PATHS.paddles),
  ...Object.values(SPRITE_PATHS.balls),
  ...Object.values(SPRITE_PATHS.particles),
];

describe("shipped asset manifest (ticket 87)", () => {
  it("declares a boot bundle and a gameplay bundle", () => {
    const names = manifest.bundles.map((b) => b.name);
    expect(names).toContain("boot");
    expect(names).toContain("gameplay");
  });

  it("packs the boot frames into the boot atlas", () => {
    for (const table of frameTables("boot")) {
      for (const name of BOOT_FRAMES) expect(Object.keys(table.frames), name).toContain(name);
    }
  });

  it("packs every paddle, ball and particle frame into the gameplay atlas", () => {
    for (const table of frameTables("gameplay")) {
      for (const name of GAMEPLAY_FRAMES) expect(Object.keys(table.frames), name).toContain(name);
    }
  });

  it("keeps boot and gameplay frames out of each other's atlas", () => {
    const boot = frameTables("boot").flatMap((t) => Object.keys(t.frames));
    const gameplay = frameTables("gameplay").flatMap((t) => Object.keys(t.frames));
    for (const name of GAMEPLAY_FRAMES) expect(boot, `${name} leaked into boot`).not.toContain(name);
    for (const name of BOOT_FRAMES) expect(gameplay, `${name} leaked into gameplay`).not.toContain(name);
  });

  it("keeps all particle frames in ONE atlas image, so the effect layer batches into one draw call", () => {
    for (const table of frameTables("gameplay")) {
      const particles = Object.values(SPRITE_PATHS.particles);
      expect(particles.every((name) => name in table.frames)).toBe(true);
      expect(typeof table.meta.image).toBe("string");
    }
  });

  it("references only files that exist, so a bundle cannot 404 at match start", () => {
    for (const name of ["boot", "gameplay"]) {
      for (const table of frameTables(name)) {
        expect(() => readFileSync(join(ASSETS_DIR, name, table.meta.image))).not.toThrow();
      }
    }
  });
});
