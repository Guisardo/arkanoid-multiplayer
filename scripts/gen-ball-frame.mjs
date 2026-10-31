// Generates the white-base ball frame (issue #152) into the AssetPack atlas
// source folder. Every Skin's ball draws this one frame; owner colors are a
// render-time tint (spec §13), and a tint multiplies, so the body must be
// light or the owner color drowns in the CC0 art's dark gray.
//
// Source: scripts/sources/ball-yellow.png (OGA "Tiny Break-em Pack", CC0), a
// grayscale shaded sphere at 4 texels per field unit. Its gray levels are
// remapped linearly onto [LIFTED_FLOOR, 255]: the brightest texel stays white,
// the darkest lands on the readability gate's luminance floor, and the shading
// in between keeps its order and relative spacing.
//
// Run: node scripts/gen-ball-frame.mjs
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "scripts", "sources", "ball-yellow.png");
const OUT_DIR = join(ROOT, "raw-assets", "gameplay{m}", "gameplay-atlas{tps}");
const OUT_NAME = "ball-base.png";

/** `ballSkinTintable` in src/content/readabilityGate.ts: body luminance floor. */
const MIN_LUMINANCE = 0.7;

/** WCAG relative luminance of an 8-bit gray level (matches readabilityGate). */
function grayLuminance(v) {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** Smallest 8-bit gray whose luminance clears the gate. */
const LIFTED_FLOOR = (() => {
  for (let v = 0; v <= 255; v++) if (grayLuminance(v) >= MIN_LUMINANCE) return v;
  throw new Error(`gen-ball-frame: no 8-bit gray reaches luminance ${String(MIN_LUMINANCE)}`);
})();

const { data, info } = await sharp(SOURCE).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
if (info.channels !== 4) {
  throw new Error(`gen-ball-frame: expected RGBA source, got ${String(info.channels)} channels (${SOURCE})`);
}

let darkest = 255;
let brightest = 0;
for (let i = 0; i < data.length; i += 4) {
  if (data[i + 3] === 0) continue;
  if (data[i] !== data[i + 1] || data[i] !== data[i + 2]) {
    throw new Error(`gen-ball-frame: source must be grayscale; texel ${String(i / 4)} is colored (${SOURCE})`);
  }
  darkest = Math.min(darkest, data[i]);
  brightest = Math.max(brightest, data[i]);
}
if (brightest <= darkest) {
  throw new Error(`gen-ball-frame: source has no shading to keep (gray ${String(darkest)}..${String(brightest)})`);
}

const out = Buffer.from(data);
for (let i = 0; i < out.length; i += 4) {
  if (out[i + 3] === 0) continue;
  const t = (out[i] - darkest) / (brightest - darkest);
  const v = Math.round(LIFTED_FLOOR + t * (255 - LIFTED_FLOOR));
  out[i] = v;
  out[i + 1] = v;
  out[i + 2] = v;
}

// Output dir is overridable so tests can generate into a scratch directory
// instead of mutating the real raw-assets folder.
const outDir = process.env["BALL_FRAME_OUT"] ?? OUT_DIR;
mkdirSync(outDir, { recursive: true });
const file = join(outDir, OUT_NAME);
await sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toFile(file);
console.log(`wrote ${file} (gray ${String(darkest)}..${String(brightest)} -> ${String(LIFTED_FLOOR)}..255)`);
