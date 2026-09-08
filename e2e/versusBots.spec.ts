// E2E (ticket 53): versus-bots trimmed config screen — variant picker,
// Duel clamps bots to 1, difficulty selector, Start boots a session.
import { expect, test } from "@playwright/test";

test("versus bots: config screen validates counts, Duel clamps bots, Start boots", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.goto("/");

  await page.locator("button", { hasText: "Versus bots" }).click();
  const screen = page.locator(".vb-root");
  await expect(screen).toBeVisible();

  // Variant picker: 5 variants.
  await expect(screen.locator("button", { hasText: "Race" })).toBeVisible();
  await expect(screen.locator("button", { hasText: "Duel" })).toBeVisible();

  // Bots picker: 1-3 available on Race; pick 3.
  const botsRow = screen.locator("div", { hasText: "Bots" }).first();
  await botsRow.locator("button", { hasText: "3" }).click();

  // Switch to Duel → bots 2/3 disable, count clamps to 1.
  await screen.locator("button", { hasText: "Duel" }).click();
  await expect(botsRow.locator("button", { hasText: "2" })).toBeDisabled();
  await expect(botsRow.locator("button", { hasText: "3" })).toBeDisabled();
  await expect(botsRow.locator("button", { hasText: "1" })).toBeEnabled();

  // Difficulty: Normal default; Hard selectable.
  const diffRow = screen.locator("div", { hasText: "Difficulty" }).first();
  await expect(diffRow.locator("button", { hasText: "Normal" })).toBeVisible();
  await diffRow.locator("button", { hasText: "Hard" }).click();

  // Start boots a session (canvas + probes live).
  await screen.locator("button", { hasText: "Start" }).click();
  await page.waitForFunction(() => globalThis.__arkanoid !== undefined, null, { timeout: 15_000 });
  await expect(page.locator("#app canvas")).toBeVisible();

  expect(errors).toEqual([]);
});
