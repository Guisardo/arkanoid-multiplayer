import { expect, test } from "@playwright/test";

test("settings: pause menu → Settings (Audio/Display), audio persists across reload", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.goto("/");
  // Landing (ticket 45): Solo entry boots the solo session.
  await page.locator("button", { hasText: "Solo" }).click();
  await page.waitForFunction(() => globalThis.__arkanoid !== undefined, null, { timeout: 15_000 });

  // Esc opens the pause menu (ticket 36: pause freely, coop semantics).
  await page.keyboard.press("Escape");
  const pauseMenu = page.locator("[data-pause-menu]");
  await expect(pauseMenu).toBeVisible({ timeout: 5_000 });

  // Settings from the pause menu — in-session = Audio/Display only (§14).
  await pauseMenu.locator("button", { hasText: "Settings" }).click();
  const overlay = page.locator("div", { hasText: "Settings" }).first();
  await expect(overlay).toBeVisible({ timeout: 5_000 });
  // Controls/Appearance sections are NOT offered mid-session.
  const overlayText = await overlay.textContent();
  expect(overlayText).not.toContain("Controls");
  expect(overlayText).toContain("Audio");
  expect(overlayText).toContain("Display");

  // Move the music slider to a distinct value
  const slider = overlay.locator('input[type="range"]').first();
  await slider.fill("42");

  // Close (Back) returns to the pause menu; Resume continues the session.
  await overlay.locator("button", { hasText: "Back" }).first().click();
  await expect(pauseMenu).toBeVisible({ timeout: 5_000 });
  await pauseMenu.locator("button", { hasText: "Resume" }).click();

  // Reload — persisted value survives
  await page.reload();
  await page.locator("button", { hasText: "Solo" }).click();
  await page.waitForFunction(() => globalThis.__arkanoid !== undefined, null, { timeout: 15_000 });
  await page.keyboard.press("Escape");
  await expect(pauseMenu).toBeVisible({ timeout: 5_000 });
  await pauseMenu.locator("button", { hasText: "Settings" }).click();
  const overlay2 = page.locator("div", { hasText: "Settings" }).first();
  await expect(overlay2).toBeVisible({ timeout: 5_000 });
  const slider2 = overlay2.locator('input[type="range"]').first();
  await expect(slider2).toHaveValue("42");

  expect(errors).toEqual([]);
});
