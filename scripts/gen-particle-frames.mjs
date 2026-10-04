// Generates the 8 grayscale 16x16 particle frames (ADR 0009) into the AssetPack
// atlas source folder. Shapes are procedural placeholders — runtime tinting is
// what gives each effect preset its color, so the frames themselves stay
// grayscale (see src/render/particles.ts).
//
// Run: node scripts/gen-particle-frames.mjs
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "raw-assets", "atlas{tps}");
const SIZE = 16;

/** Signed-distance helpers on a 16x16 grid, origin top-left. */
const shapes = {
  circle: (x, y) => Math.hypot(x - 7.5, y - 7.5) - 6.5,
  square: (x, y) => Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)) - 6,
  triangle: (x, y) => {
    // Upward-pointing isoceles: base at the bottom, apex at the top.
    const halfWidth = (y / 15) * 7 + 0.5;
    return Math.max(Math.abs(x - 7.5) - halfWidth, y - 15.5);
  },
  star: (x, y) => {
    const dx = x - 7.5;
    const dy = y - 7.5;
    const a = Math.atan2(dy, dx) + Math.PI / 2;
    // 4-point star: the rim alternates between 7.0 (points, on the axes) and
    // 1.8 (notches, on the diagonals) as cos(4a) swings. Always positive, so
    // the SDF never inverts and hollow the centre out.
    return Math.hypot(dx, dy) - (4.4 + 2.6 * Math.cos(4 * a));
  },
  streak: (x, y) => {
    // Horizontal lens: full height (3 units) at the centre, tapering to points
    // at both ends. Dividing dy by (1 - 0.85*dx) narrows the profile toward
    // the tips, which is what makes it read as a motion streak not a bar.
    const dx = Math.abs(x - 7.5) / 7.5;
    const dy = Math.abs(y - 7.5) / (3.2 * (1 - 0.85 * dx));
    return Math.max(dx, dy) - 1;
  },
  debris: (x, y) => {
    // Chunky shard: wider than tall, with a staircase rim on alternating row
    // pairs so it reads as a broken brick rather than a plain rectangle.
    const band = Math.floor(y / 3) % 2 === 0 ? 0.5 : 2.5;
    const taper = Math.abs(x - 7.5) - (4.5 + band);
    const height = Math.abs(y - 7.5) - 4;
    return Math.max(taper, height);
  },
  splat: (x, y) => {
    // Four-lobed blob with a ragged rim.
    const dx = x - 7.5;
    const dy = y - 7.5;
    const a = Math.atan2(dy, dx);
    const rim = 5 + 1.6 * Math.cos(4 * a + 0.6);
    return Math.hypot(dx, dy) - rim;
  },
  ring: (x, y) => Math.abs(Math.hypot(x - 7.5, y - 7.5) - 5.5) - 1.6,
};

/** Grayscale coverage 0..255 from a signed distance (1.0px feather). */
function coverage(dist) {
  return Math.round(255 * Math.min(1, Math.max(0, 0.5 - dist)));
}

/** Minimal RGBA8 PNG encoder (no dependency). */
function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

// Output dir is overridable so tests can generate into a scratch directory
// instead of mutating the real raw-assets folder.
const outDir = process.env["PARTICLE_FRAME_OUT"] ?? OUT_DIR;

mkdirSync(outDir, { recursive: true });
for (const [name, sdf] of Object.entries(shapes)) {
  const rgba = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      // White so `tint` multiplies cleanly; alpha carries the shape.
      const v = coverage(sdf(x, y));
      const i = (y * SIZE + x) * 4;
      rgba[i] = 255;
      rgba[i + 1] = 255;
      rgba[i + 2] = 255;
      rgba[i + 3] = v;
    }
  }
  const file = join(outDir, `particle-${name}.png`);
  writeFileSync(file, encodePng(SIZE, SIZE, rgba));
  console.log(`wrote ${file}`);
}
