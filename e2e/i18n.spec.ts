// E2E (ticket 53): i18n switch — Settings Display Language row → Español
// → reload applies it end-to-end (landing strings, html lang, document
// title), persists, and switches back. Locale tables are boot-resolved
// (spec §14) — apply = reload is the contract.
import { expect, test } from "@playwright/test";

test("i18n: switch to es-419 via Settings, reload applies everywhere, persists, back to en", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.goto("/");

  // Landing is English by default (fresh context, no stored language).
  await expect(page.locator("button", { hasText: "Solo" })).toBeVisible();

  // Settings from landing (spec §14: always reachable).
  await page.locator("button", { hasText: "Settings" }).click();
  const overlay = page.locator("div", { hasText: "Settings" }).first();
  await expect(overlay).toBeVisible();

  // Language row (Display section) → Español.
  const langSelect = overlay.locator("[data-language-select]");
  await expect(langSelect).toBeVisible();
  await langSelect.selectOption("es-419");
  // Apply = reload (boot-resolved locale).
  await page.waitForTimeout(200);
  await page.reload();

  // Spanish landing: html lang, title, and the Solo button now "Solo"
  // (same word) — use the Multiplayer button ("Multijugador") as the tell.
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expect(page).toHaveTitle("Arkanoid Multijugador");
  await expect(page.locator("button", { hasText: "Multijugador" })).toBeVisible();
  // Settings entry itself localized.
  await expect(page.locator("button", { hasText: "Ajustes" })).toBeVisible();

  // Persisted: a second reload keeps Spanish.
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "es");

  // Back to English via Settings.
  await page.locator("button", { hasText: "Ajustes" }).click();
  const overlay2 = page.locator("div", { hasText: "Ajustes" }).first();
  await expect(overlay2).toBeVisible();
  await overlay2.locator("[data-language-select]").selectOption("en-US");
  await page.waitForTimeout(200);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("button", { hasText: "Multiplayer" })).toBeVisible();

  expect(errors).toEqual([]);
});
