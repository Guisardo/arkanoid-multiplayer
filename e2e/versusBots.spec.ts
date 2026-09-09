// E2E (ticket 53 + 56): versus-bots trimmed config screen — variant
// picker, Duel clamps bots, difficulty selector, Start boots a REAL versus
// match: split-screen fields for parallel variants, single field for
// duel/sharedField, bot paddles move, pause menu works.
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

  // Start boots a real versus session (ticket 56).
  await screen.locator("button", { hasText: "Start" }).click();
  await page.waitForFunction(() => globalThis.__arkanoidBots !== undefined, null, { timeout: 15_000 });
  await expect(page.locator("#app canvas")).toBeVisible();

  expect(errors).toEqual([]);
});

test("versus bots (56): race with 3 bots renders 4 fields; bot paddles move", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.goto("/");

  await page.locator("button", { hasText: "Versus bots" }).click();
  const screen = page.locator(".vb-root");
  await screen.locator("div", { hasText: "Bots" }).first().locator("button", { hasText: "3" }).click();
  await screen.locator("button", { hasText: "Start" }).click();
  await page.waitForFunction(() => globalThis.__arkanoidBots !== undefined, null, { timeout: 15_000 });

  // Split-screen: 4 fields (human + 3 bots).
  const fields = await page.evaluate(() => globalThis.__arkanoidBots!.fieldCount);
  expect(fields).toBe(4);

  // Bot paddles move: sample a bot field's paddle over ~5 s (bots launch
  // within 1–4 s, then track the ball).
  const before = await page.evaluate(() => {
    const snaps = globalThis.__arkanoidBots!.snapshots();
    return snaps.map((s) => s.players[0]?.paddle.x ?? -1);
  });
  await page.waitForTimeout(5000);
  const after = await page.evaluate(() => {
    const snaps = globalThis.__arkanoidBots!.snapshots();
    return snaps.map((s) => s.players[0]?.paddle.x ?? -1);
  });
  const moved = after.some((x, i) => x !== before[i]);
  expect(moved).toBe(true);

  expect(errors).toEqual([]);
});

test("versus bots (56): duel renders a single field; pause menu works", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.goto("/");

  await page.locator("button", { hasText: "Versus bots" }).click();
  const screen = page.locator(".vb-root");
  await screen.locator("button", { hasText: "Duel" }).click();
  await screen.locator("button", { hasText: "Start" }).click();
  await page.waitForFunction(() => globalThis.__arkanoidBots !== undefined, null, { timeout: 15_000 });

  // Single field (shared duel arena).
  const fields = await page.evaluate(() => globalThis.__arkanoidBots!.fieldCount);
  expect(fields).toBe(1);

  // Esc opens the pause menu (coop semantics — pause freely).
  await page.keyboard.press("Escape");
  const pauseMenu = page.locator("[data-pause-menu]");
  await expect(pauseMenu).toBeVisible({ timeout: 5_000 });
  const paused = await page.evaluate(() => globalThis.__arkanoidBots!.paused);
  expect(paused).toBe(true);

  // Resume closes it and unpauses.
  await pauseMenu.locator("button", { hasText: "Resume" }).click();
  await expect(pauseMenu).toBeHidden({ timeout: 5_000 });
  const resumed = await page.evaluate(() => globalThis.__arkanoidBots!.paused);
  expect(resumed).toBe(false);

  expect(errors).toEqual([]);
});
