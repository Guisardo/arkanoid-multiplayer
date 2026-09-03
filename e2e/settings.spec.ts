import { expect, test } from "@playwright/test";

test("settings: Esc opens overlay, audio persists across reload", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.goto("/");
  await page.waitForFunction(() => globalThis.__arkanoid !== undefined, null, { timeout: 15_000 });

  // Esc opens the settings overlay
  await page.keyboard.press("Escape");
  const overlay = page.locator("div", { hasText: "Settings" }).first();
  await expect(overlay).toBeVisible({ timeout: 5_000 });

  // Move the music slider to a distinct value
  const slider = overlay.locator('input[type="range"]').first();
  await slider.fill("42");

  // Close and reload — persisted value survives
  await page.keyboard.press("Escape"); // no-op if closed already
  const back = overlay.locator("button", { hasText: "Back" }).first();
  await back.click();
  await page.reload();
  await page.waitForFunction(() => globalThis.__arkanoid !== undefined, null, { timeout: 15_000 });
  await page.keyboard.press("Escape");
  const overlay2 = page.locator("div", { hasText: "Settings" }).first();
  await expect(overlay2).toBeVisible({ timeout: 5_000 });
  const slider2 = overlay2.locator('input[type="range"]').first();
  await expect(slider2).toHaveValue("42");

  expect(errors).toEqual([]);
});
