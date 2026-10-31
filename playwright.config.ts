import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";

// SwiftShader headless WebGL: software rasterizer keeps e2e functional-only
// (perf budgets stay manual on reference device — spec §17).
const CHROMIUM_ARGS = [
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
  "--disable-gpu-sandbox",
  // WebRTC loopback e2e (ticket 45): expose raw host IPs instead of
  // mDNS .local names — two contexts on one CI box resolve real IPs.
  "--disable-features=WebRtcHideLocalIpsWithMdns,msForceBrowserSignInEnabled",
];

/** #159: fake camera playing a Room link QR (scripts/gen-qr-fixture.mjs). */
const QR_CAMERA_FIXTURE = fileURLToPath(new URL("./e2e/fixtures/room-link-qr.y4m", import.meta.url));
const CAMERA_SPECS = /\.camera\.spec\.ts$/;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
    launchOptions: { args: CHROMIUM_ARGS },
  },
  projects: [
    { name: "chromium", testIgnore: CAMERA_SPECS, use: { ...devices["Desktop Chrome"] } },
    // Own project so the fake-camera flags never touch the other specs.
    {
      name: "chromium-camera",
      testMatch: CAMERA_SPECS,
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: [
            ...CHROMIUM_ARGS,
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
            `--use-file-for-fake-video-capture=${QR_CAMERA_FIXTURE}`,
          ],
        },
      },
    },
  ],
  webServer: {
    command: "npm run dev -- --port 5173 --strictPort",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
