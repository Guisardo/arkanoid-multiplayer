// E2E (ticket #148): the touch launch button swaps to the Laser glyph and its
// LASER badge stays legible on a small phone. 320×568 CSS px (iPhone SE class)
// is the smallest viewport the touch layout targets; the badge must render at
// a readable size, fit over its button, and stay on-canvas, or the overlay's
// glyph-only fallback has to take over.
import { expect, test } from "@playwright/test";

/** Smallest rendered badge text height (CSS px) we accept as legible. */
const MIN_BADGE_TEXT_PX = 6;

test("touch Laser badge: glyph swaps on arming and the LASER text is legible on a 320×568 phone", async ({ browser }, testInfo) => {
  const errors: string[] = [];
  const phone = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    viewport: { width: 320, height: 568 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await phone.newPage();
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.goto("/");
  await page.locator("button", { hasText: "Solo" }).click();
  await page.waitForFunction(() => globalThis.__arkanoid !== undefined, null, { timeout: 15_000 });

  // Serve: the ball is stuck, so the button is the launch triangle.
  await page.waitForFunction(() => globalThis.__arkanoid!.touchLaserBadge !== null, null, { timeout: 10_000 });
  expect(await page.evaluate(() => globalThis.__arkanoid!.touchLaserBadge?.glyph)).toBe("launch");

  // Launch with a real tap on the drawn button (bottom-right slot, 36 px in).
  const tap = await page.evaluate(() => {
    const s = globalThis.__arkanoid!;
    const rect = s.app.canvas.getBoundingClientRect();
    return { x: rect.left + s.app.renderer.width - 36, y: rect.top + s.app.renderer.height - 36 };
  });
  await page.touchscreen.tap(tap.x, tap.y);
  await page.waitForFunction(() => globalThis.__arkanoid!.latestSnapshot().phase === "play", null, { timeout: 10_000 });

  // Arm: drop an L Capsule just above the Paddle so it is caught at once.
  await page.evaluate(() => {
    const s = globalThis.__arkanoid!;
    const paddle = s.latestSnapshot().players[0]!.paddle;
    s.debugDropCapsule(paddle.x, paddle.y - paddle.h, "L");
  });
  await page.waitForFunction(() => globalThis.__arkanoid!.touchLaserBadge?.glyph === "laser", null, { timeout: 10_000 });

  const probe = await page.evaluate(() => {
    const s = globalThis.__arkanoid!;
    return { badge: s.touchLaserBadge, canvasW: s.app.renderer.width, canvasH: s.app.renderer.height };
  });
  // Kept on disk for a human legibility look alongside the measured bounds.
  const shot = testInfo.outputPath("laser-badge-320x568.png");
  await page.screenshot({ path: shot });
  await testInfo.attach("laser-badge-320x568", { path: shot, contentType: "image/png" });

  expect(probe.badge?.badge).toBe("text");
  const text = probe.badge?.text;
  if (text === null || text === undefined) throw new Error("laser badge text bounds missing");
  expect(text.height).toBeGreaterThanOrEqual(MIN_BADGE_TEXT_PX);
  expect(text.width).toBeLessThanOrEqual(probe.badge!.buttonPx);
  expect(text.x).toBeGreaterThanOrEqual(0);
  expect(text.y).toBeGreaterThanOrEqual(0);
  expect(text.x + text.width).toBeLessThanOrEqual(probe.canvasW);
  expect(text.y + text.height).toBeLessThanOrEqual(probe.canvasH);

  expect(errors).toEqual([]);
  await phone.close();
});
