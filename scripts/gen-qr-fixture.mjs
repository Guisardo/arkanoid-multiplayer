// Generates the fake-camera video for the QR scanner e2e (#159): one Y4M
// frame (4:2:0, grayscale) showing a Room link QR, centred inside the
// scanner's default scan region. Chromium plays it as the camera through
// --use-file-for-fake-video-capture and loops it.
//
// Run: node scripts/gen-qr-fixture.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import qrcode from "qrcode-generator";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "e2e", "fixtures", "room-link-qr.y4m");

/** Must match e2e/qrScan.camera.spec.ts. */
const FIXTURE_ROOM_CODE = "SCAN2";
const PAYLOAD = `http://localhost:5173/?code=${FIXTURE_ROOM_CODE}`;

const WIDTH = 480;
const HEIGHT = 360;
const MODULE_PX = 6;
const QUIET_MODULES = 4;
const WHITE = 235;
const BLACK = 16;
const CHROMA_NEUTRAL = 128;

const qr = qrcode(0, "M");
qr.addData(PAYLOAD);
qr.make();
const modules = qr.getModuleCount();
const sidePx = (modules + 2 * QUIET_MODULES) * MODULE_PX;
if (sidePx > Math.min(WIDTH, HEIGHT)) throw new Error(`gen-qr-fixture: QR (${sidePx}px) does not fit ${WIDTH}x${HEIGHT}`);

const luma = Buffer.alloc(WIDTH * HEIGHT, WHITE);
const left = Math.floor((WIDTH - sidePx) / 2) + QUIET_MODULES * MODULE_PX;
const top = Math.floor((HEIGHT - sidePx) / 2) + QUIET_MODULES * MODULE_PX;
for (let row = 0; row < modules; row++) {
  for (let col = 0; col < modules; col++) {
    if (!qr.isDark(row, col)) continue;
    for (let y = 0; y < MODULE_PX; y++) {
      const offset = (top + row * MODULE_PX + y) * WIDTH + left + col * MODULE_PX;
      luma.fill(BLACK, offset, offset + MODULE_PX);
    }
  }
}
const chroma = Buffer.alloc((WIDTH / 2) * (HEIGHT / 2), CHROMA_NEUTRAL);

const header = Buffer.from(`YUV4MPEG2 W${WIDTH} H${HEIGHT} F10:1 Ip A1:1 C420jpeg\n`, "ascii");
const frame = Buffer.concat([Buffer.from("FRAME\n", "ascii"), luma, chroma, chroma]);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, Buffer.concat([header, frame]));
console.log(`gen-qr-fixture: wrote ${OUT} (${PAYLOAD}, ${modules} modules)`);
