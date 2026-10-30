// E2E (ticket 105): a corrupt save document never takes the app down — it
// boots to the landing screen with defaults. Settings persistence across a
// reload is covered by settings.spec.ts and episodeResume.spec.ts.
import { expect, test } from "@playwright/test";

const SAVE_KEY = "arkanoid.save.v1";

test("save: a corrupt composite save boots to the landing screen with defaults", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  // Runs before any app script, on every navigation in this page.
  await page.addInitScript((key: string) => {
    if (globalThis.localStorage.getItem(key) === null) globalThis.localStorage.setItem(key, "{not valid json");
  }, SAVE_KEY);
  await page.goto("/");
  await expect(page.locator("button", { hasText: "Solo" })).toBeVisible({ timeout: 15_000 });
  expect(errors).toEqual([]);
});
