// E2E (ticket 53): touch overlay presence — mobile-emulated viewport shows
// the virtual stick + cluster (solo session), desktop doesn't. Spec §11/§12.
import { expect, test } from "@playwright/test";

test("touch overlay: present in mobile-emulated solo, absent on desktop", async ({ browser }) => {
  const errors: string[] = [];

  // Mobile emulation: coarse pointer + mobile UA (device class detection).
  const mobile = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    viewport: { width: 360, height: 640 },
    hasTouch: true,
    isMobile: true,
  });
  const mobilePage = await mobile.newPage();
  mobilePage.on("pageerror", (err) => errors.push(`mobile: ${String(err)}`));
  await mobilePage.goto("/");
  await mobilePage.locator("button", { hasText: "Solo" }).click();
  await mobilePage.waitForFunction(() => globalThis.__arkanoid !== undefined, null, { timeout: 15_000 });

  // The overlay renders inside the Pixi stage: probe the adapter state via
  // the session — the touch overlay exists (device.touch was true).
  const mobileHasOverlay = await mobilePage.evaluate(() => {
    const s = globalThis.__arkanoid!;
    // The overlay is a Pixi child of the stage; count stage children > 1
    // (field view + overlay) and the canvas is up.
    return s.app.stage.children.length > 1;
  });
  expect(mobileHasOverlay).toBe(true);
  // Close the mobile context first — its live WebGL context blocks a
  // second context in the same browser process (one per device, spec §3).
  await mobile.close();

  // Desktop: no overlay (pointer fine, desktop UA) — stage holds only the
  // field view.
  const desktop = await browser.newContext();
  const desktopPage = await desktop.newPage();
  desktopPage.on("pageerror", (err) => errors.push(`desktop: ${String(err)}`));
  await desktopPage.goto("/");
  await desktopPage.locator("button", { hasText: "Solo" }).click();
  await desktopPage.waitForFunction(() => globalThis.__arkanoid !== undefined, null, { timeout: 15_000 });
  const desktopHasOverlay = await desktopPage.evaluate(() => {
    const s = globalThis.__arkanoid!;
    return s.app.stage.children.length > 1;
  });
  expect(desktopHasOverlay).toBe(false);

  expect(errors).toEqual([]);
  await desktop.close();
});
