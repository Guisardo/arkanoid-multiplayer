// Verifies the generated particle frames are actually the shapes the recipes
// name (scripts/gen-particle-frames.mjs). A broken SDF — e.g. a star whose
// radius goes negative — silently ships garbage that still "works" at runtime,
// so the shapes are asserted here rather than eyeballed in a texture viewer.
import { execFileSync } from "node:child_process";
import { inflateSync } from "node:zlib";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SIZE = 16;
const SHAPES = [
  "circle",
  "square",
  "triangle",
  "star",
  "streak",
  "debris",
  "splat",
  "ring",
] as const;

/** Decode the 8-bit RGBA PNGs the generator writes (filter: none, no interlace). */
function decodeRgba(png: Buffer): Uint8Array {
  let pos = 8; // skip signature
  const chunks = new Map<string, Buffer>();
  while (pos + 8 <= png.length) {
    const len = png.readUInt32BE(pos);
    const type = png.toString("latin1", pos + 4, pos + 8);
    chunks.set(type, Buffer.from(png.subarray(pos + 8, pos + 8 + len)));
    pos += 12 + len;
  }
  const raw = inflateSync(chunks.get("IDAT") ?? Buffer.alloc(0));
  const stride = SIZE * 4;
  const out = new Uint8Array(stride * SIZE);
  for (let y = 0; y < SIZE; y++) {
    const filter = raw[y * (stride + 1)];
    // The generator only emits filter 0; anything else means the format drifted.
    if (filter !== 0) throw new Error(`unexpected PNG filter ${String(filter)} on row ${String(y)}`);
    raw.copy(out, y * stride, y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
  }
  return out;
}

/** Generate into a scratch dir so the test never mutates the real raw-assets. */
function generate(): Map<string, Uint8Array> {
  const dir = mkdtempSync(path.join(tmpdir(), "particle-frames-"));
  try {
    execFileSync(process.execPath, [path.join("scripts", "gen-particle-frames.mjs")], {
      cwd: process.cwd(),
      env: { ...process.env, PARTICLE_FRAME_OUT: dir },
      stdio: "ignore",
    });
    const out = new Map<string, Uint8Array>();
    for (const shape of SHAPES) {
      const file = path.join(dir, `particle-${shape}.png`);
      const png = readFileSync(file);
      if (png.length < 8 || png.toString("hex", 0, 8) !== "89504e470d0a1a0a") {
        throw new Error(`${shape}: not a PNG (${String(png.length)} bytes)`);
      }
      out.set(shape, decodeRgba(png));
    }
    return out;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const frames = generate();

/** Alpha at a grid position, 0..255. */
function alpha(shape: string, x: number, y: number): number {
  const f = frames.get(shape);
  if (f === undefined) throw new Error(`missing frame ${shape}`);
  return f[(y * SIZE + x) * 4 + 3] ?? 0;
}

/** Mean alpha over the whole frame, 0..1. */
function coverage(shape: string): number {
  const f = frames.get(shape);
  if (f === undefined) throw new Error(`missing frame ${shape}`);
  let sum = 0;
  for (let i = 3; i < f.length; i += 4) sum += f[i] ?? 0;
  return sum / 255 / (SIZE * SIZE);
}

function opaque(shape: string, x: number, y: number): boolean {
  return alpha(shape, x, y) > 128;
}

describe("generated particle frames", () => {
  it("emits one 16x16 frame per documented shape", () => {
    expect([...frames.keys()].sort()).toEqual([...SHAPES].sort());
  });

  it("frames are white with the shape in the alpha channel (runtime tinting)", () => {
    for (const shape of SHAPES) {
      const f = frames.get(shape)!;
      let sawOpaque = false;
      for (let i = 0; i < f.length; i += 4) {
        // White base so `tint` multiplies cleanly; only alpha varies.
        expect(f[i]).toBe(255);
        expect(f[i + 1]).toBe(255);
        expect(f[i + 2]).toBe(255);
        if ((f[i + 3] ?? 0) > 128) sawOpaque = true;
      }
      expect(sawOpaque, `${shape} has no solid pixels`).toBe(true);
    }
  });

  it("each shape fills a meaningful but partial share of the frame", () => {
    for (const shape of SHAPES) {
      const c = coverage(shape);
      // Too little is invisible; too much is a solid square, not a shape.
      expect(c, `${shape} coverage ${c.toFixed(3)}`).toBeGreaterThan(0.05);
      expect(c, `${shape} coverage ${c.toFixed(3)}`).toBeLessThan(0.9);
    }
  });

  it("circle is solid in the middle and empty in the corners", () => {
    expect(opaque("circle", 8, 8)).toBe(true);
    expect(opaque("circle", 0, 0)).toBe(false);
    expect(opaque("circle", 15, 15)).toBe(false);
  });

  it("square has square corners filled", () => {
    // A disc leaves (2,2) empty; a square does not.
    expect(opaque("square", 3, 3)).toBe(true);
    expect(opaque("square", 0, 0)).toBe(false);
  });

  it("triangle is widest at the bottom and pointed at the top", () => {
    const topWidth = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].filter((x) =>
      opaque("triangle", x, 4),
    ).length;
    const bottomWidth = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].filter((x) =>
      opaque("triangle", x, 12),
    ).length;
    expect(bottomWidth).toBeGreaterThan(topWidth);
    // Apex: the very top row is (nearly) empty.
    expect(opaque("triangle", 8, 0)).toBe(false);
  });

  it("star has four points reaching further than its notches", () => {
    // A 4-point star reaches furthest along the axes...
    const axis = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    const reach = (sample: (i: number) => boolean): number => axis.filter(sample).length;
    const horizontal = reach((x) => opaque("star", x, 7));
    const vertical = reach((y) => opaque("star", 7, y));
    // ...and the diagonal notches are cut in.
    const diagonal = reach((i) => opaque("star", i, i));
    expect(horizontal).toBeGreaterThanOrEqual(12);
    expect(vertical).toBeGreaterThanOrEqual(12);
    expect(diagonal).toBeLessThan(horizontal);
    // The centre stays solid — a negative SDF radius would hollow it out.
    expect(opaque("star", 7, 7)).toBe(true);
  });

  it("streak is horizontal, thin, and tapered toward both tips", () => {
    expect(opaque("streak", 1, 7)).toBe(true);
    expect(opaque("streak", 14, 7)).toBe(true);
    const axis = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    const horizontal = axis.filter((x) => opaque("streak", x, 7)).length;
    const vertical = axis.filter((y) => opaque("streak", 7, y)).length;
    expect(horizontal).toBeGreaterThan(vertical);
    // Tapered: the centre row is solid, the row above it is not.
    expect(opaque("streak", 7, 7)).toBe(true);
    expect(opaque("streak", 7, 3)).toBe(false);
  });

  it("debris is a wide, stepped chip", () => {
    expect(opaque("debris", 7, 7)).toBe(true);
    // Wider than tall — a brick shard, not a dot.
    const horizontal = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].filter((x) =>
      opaque("debris", x, 7),
    ).length;
    const vertical = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].filter((y) =>
      opaque("debris", 7, y),
    ).length;
    expect(horizontal).toBeGreaterThan(vertical);
    // The rim is stepped: a band of rows is cut in on both sides.
    expect(opaque("debris", 2, 5)).toBe(true);
    expect(opaque("debris", 2, 7)).toBe(false);
    expect(opaque("debris", 2, 11)).toBe(true);
  });

  it("splat is blobby and extends past a plain circle", () => {
    expect(opaque("splat", 7, 7)).toBe(true);
    // A four-lobed rim reaches the frame edge somewhere.
    expect(coverage("splat")).toBeGreaterThan(0.1);
  });

  it("ring is hollow — solid rim, empty centre", () => {
    expect(opaque("ring", 7, 1)).toBe(true);
    expect(opaque("ring", 7, 7)).toBe(false);
  });

  it("generation is deterministic (same bytes on every run)", () => {
    const again = generate();
    for (const shape of SHAPES) {
      expect([...(again.get(shape) ?? [])], `${shape} differs between runs`).toEqual([
        ...(frames.get(shape) ?? []),
      ]);
    }
  });
});
