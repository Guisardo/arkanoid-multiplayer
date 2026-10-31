// Verifies the white-base ball frame (issue #152, scripts/gen-ball-frame.mjs).
// Owner tint multiplies the texture, so the CC0 sphere's dark gray body made a
// tinted ball read as near-black. The generated frame must be light enough to
// carry a tint and must keep the source's shading.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { ballSkinTintable } from "content/readabilityGate";
import { DEFAULT_SKIN } from "content/skins";

/** Does a gray level pass the readability gate's tintable-ball check? */
function tintable(gray: number): boolean {
  return ballSkinTintable({ ...DEFAULT_SKIN.ball, baseColor: gray * 0x010101 });
}

interface Rgba {
  data: Buffer;
  width: number;
  height: number;
}

async function readRgba(file: string): Promise<Rgba> {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** Gray level of each opaque texel, keyed by texel index. */
function opaqueGrays(img: Rgba): Map<number, number> {
  const grays = new Map<number, number>();
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] === 0) continue;
    expect(img.data[i], `texel ${String(i / 4)} is gray`).toBe(img.data[i + 1]);
    expect(img.data[i], `texel ${String(i / 4)} is gray`).toBe(img.data[i + 2]);
    grays.set(i / 4, img.data[i]!);
  }
  return grays;
}

async function generate(): Promise<{ out: Rgba; source: Rgba }> {
  const dir = mkdtempSync(path.join(tmpdir(), "ball-frame-"));
  try {
    execFileSync(process.execPath, ["scripts/gen-ball-frame.mjs"], {
      env: { ...process.env, BALL_FRAME_OUT: dir },
      stdio: "pipe",
    });
    const out = await readRgba(path.join(dir, "ball-base.png"));
    const source = await readRgba(path.join("scripts", "sources", "ball-yellow.png"));
    return { out, source };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("white-base ball frame (issue #152)", () => {
  it("keeps the source silhouette and size", async () => {
    const { out, source } = await generate();
    expect(out.width).toBe(source.width);
    expect(out.height).toBe(source.height);
    for (let i = 3; i < out.data.length; i += 4) expect(out.data[i]).toBe(source.data[i]);
  });

  it("lifts every body texel to tintable luminance, peak stays white", async () => {
    const { out } = await generate();
    const grays = [...opaqueGrays(out).values()];
    expect(grays.length).toBeGreaterThan(0);
    // Checked against the gate itself, so the script's copy of the floor
    // cannot drift from it unnoticed.
    const darkest = Math.min(...grays);
    expect(tintable(darkest), `darkest body gray ${String(darkest)}`).toBe(true);
    // ...and lifted no further than needed, so the shading keeps its range.
    expect(tintable(darkest - 1)).toBe(false);
    expect(Math.max(...grays)).toBe(255);
  });

  it("keeps the shading: brighter source texels stay brighter", async () => {
    const { out, source } = await generate();
    const before = opaqueGrays(source);
    const after = opaqueGrays(out);
    const pairs = [...before.entries()].map(([texel, g]) => [g, after.get(texel)!] as const);
    pairs.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < pairs.length; i++) {
      expect(pairs[i]![1]).toBeGreaterThanOrEqual(pairs[i - 1]![1]);
    }
    // More than a flat disc: several distinct shading levels survive the lift.
    expect(new Set(after.values()).size).toBeGreaterThan(4);
  });
});
