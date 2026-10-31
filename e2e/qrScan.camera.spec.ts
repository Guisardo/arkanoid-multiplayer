// E2E (#159): join by scanning the host's QR. Runs only in the
// "chromium-camera" project, where Chromium's fake camera plays
// e2e/fixtures/room-link-qr.y4m — a Room link QR for room SCAN2 (regenerate
// with scripts/gen-qr-fixture.mjs).
import { expect, test } from "@playwright/test";
import { abortSignaling } from "./support/multiplayer";

/** Room code inside the fixture QR (scripts/gen-qr-fixture.mjs). */
const FIXTURE_ROOM_CODE = "SCAN2";

test.use({ permissions: ["camera"] });

test("Scan QR reads a Room link from the camera and joins that room", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  const roomUrls: string[] = [];
  // No host here: the guest's room WS proves which room it joined, and its
  // close sends the guest to the copy-paste screen.
  await abortSignaling(page, (url) => roomUrls.push(url));

  // The decoder must not ship in the boot chunk (ADR 0007): nothing named
  // qr-scanner loads before Scan QR.
  const scriptUrls: string[] = [];
  page.on("request", (req) => { scriptUrls.push(req.url()); });

  await page.goto("/");
  await page.locator("button", { hasText: "Multiplayer" }).click();
  await page.locator("button", { hasText: "Join room" }).click();
  const scan = page.getByRole("button", { name: "Scan QR" });
  await expect(scan).toBeVisible();
  expect(scriptUrls.filter((u) => u.includes("qr-scanner"))).toEqual([]);

  await scan.click();

  // The QR fills the boxes and joins; the guest flow takes over the screen.
  await expect(page.locator(".cp-root")).toBeVisible({ timeout: 20_000 });
  expect(roomUrls.some((u) => u.includes(`/room/${FIXTURE_ROOM_CODE}/`))).toBe(true);
  expect(scriptUrls.some((u) => u.includes("qr-scanner"))).toBe(true);
  // The join screen and its camera are gone.
  await expect(page.locator('[data-screen="roomcode"]')).toHaveCount(0);
  await expect(page.locator("video")).toHaveCount(0);

  expect(errors).toEqual([]);
});

test("Back from the camera view ends the camera and returns to manual entry", async ({ page }) => {
  // Hold the decoder download so the fixture QR cannot join first: the
  // camera still goes live, because the stream opens before the decoder loads.
  await page.route(/qr-scanner/, () => undefined);
  await page.goto("/");
  await page.locator("button", { hasText: "Multiplayer" }).click();
  await page.locator("button", { hasText: "Join room" }).click();
  // Record the camera tracks: Back must end them, not just hide the video.
  await page.evaluate(() => {
    const md = navigator.mediaDevices;
    const original = md.getUserMedia.bind(md);
    const w = window as unknown as { __cameraTracks: MediaStreamTrack[] };
    w.__cameraTracks = [];
    md.getUserMedia = async (constraints) => {
      const stream = await original(constraints);
      w.__cameraTracks.push(...stream.getTracks());
      return stream;
    };
  });
  const trackStates = (): Promise<string[]> =>
    page.evaluate(() =>
      (window as unknown as { __cameraTracks: MediaStreamTrack[] }).__cameraTracks.map((t) => t.readyState),
    );

  await page.getByRole("button", { name: "Scan QR" }).click();
  await expect(page.locator("video")).toBeVisible();
  await expect.poll(trackStates).toEqual(["live"]);

  await page.locator("button:visible", { hasText: "Back" }).click();

  await expect(page.locator("video")).toBeHidden();
  await expect(page.locator(".ld-input").first()).toBeVisible();
  expect(await trackStates()).toEqual(["ended"]);
});
