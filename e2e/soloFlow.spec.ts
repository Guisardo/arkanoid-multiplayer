// E2E (ticket 53): Solo start → pause menu → resume → forced game over →
// Continue (score −60%, same round) → Restart (round 1, score 0). Uses the
// session probes only — sim behavior itself is covered in Vitest.
import { expect, test } from "@playwright/test";

test("solo: pause menu freezes/resumes; game over Continue keeps round, Restart resets", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.goto("/");
  await page.locator("button", { hasText: "Solo" }).click();
  await page.waitForFunction(() => globalThis.__arkanoid !== undefined, null, { timeout: 15_000 });

  // Launch, then let the ball bounce for a moment.
  await page.keyboard.press("Space");
  await page.waitForTimeout(300);

  // Esc → pause menu (Resume / Settings / Quit), sim frozen.
  await page.keyboard.press("Escape");
  const pauseMenu = page.locator("[data-pause-menu]");
  await expect(pauseMenu).toBeVisible({ timeout: 5_000 });
  expect(await page.evaluate(() => globalThis.__arkanoid!.paused)).toBe(true);
  const frozenTick = await page.evaluate(() => globalThis.__arkanoid!.latestSnapshot().tick);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => globalThis.__arkanoid!.latestSnapshot().tick)).toBe(frozenTick);

  // Resume → sim advances again.
  await pauseMenu.locator("button", { hasText: "Resume" }).click();
  await expect(pauseMenu).toBeHidden();
  expect(await page.evaluate(() => globalThis.__arkanoid!.paused)).toBe(false);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => globalThis.__arkanoid!.latestSnapshot().tick)).toBeGreaterThan(frozenTick);

  /** Drain one life: place the ball low + fast, wait for the loss event. */
  const loseLife = async (): Promise<void> => {
    const livesBefore = await page.evaluate(
      () => globalThis.__arkanoid!.latestSnapshot().players[0]?.lives ?? 0,
    );
    await page.evaluate(() => {
      globalThis.__arkanoid!.debugSetBall(20, 240, 0, 120);
    });
    await page.waitForFunction(
      (before: number) =>
        (globalThis.__arkanoid!.latestSnapshot().players[0]?.lives ?? 0) < before,
      livesBefore,
      { timeout: 10_000 },
    );
  };

  // Force game over deterministically: 3 lives → the end screen at 0.
  for (let life = 0; life < 3; life++) await loseLife();
  await page.waitForFunction(
    () => globalThis.__arkanoid!.soloPhase === "gameOver",
    null,
    { timeout: 10_000 },
  );

  // End screen: Game over + Continue/Restart/Quit.
  const endScreen = page.locator(".end-root");
  await expect(endScreen).toBeVisible({ timeout: 5_000 });
  await expect(endScreen.locator("h2", { hasText: "Game over" })).toBeVisible();

  // Continue: same round (1), score −60% (score is 0 here — stays 0).
  const scoreBefore = await page.evaluate(() => globalThis.__arkanoid!.soloScore);
  await endScreen.locator("button", { hasText: "Continue" }).click();
  await expect(endScreen).toBeHidden();
  await page.waitForFunction(() => globalThis.__arkanoid!.soloPhase === "playing", null, { timeout: 5_000 });
  expect(await page.evaluate(() => globalThis.__arkanoid!.soloRound)).toBe(1);
  expect(await page.evaluate(() => globalThis.__arkanoid!.soloScore)).toBe(Math.floor(scoreBefore * 0.4));

  // Drain again (3 fresh lives) → Restart: round 1, score 0, playing.
  for (let life = 0; life < 3; life++) await loseLife();
  await page.waitForFunction(
    () => globalThis.__arkanoid!.soloPhase === "gameOver",
    null,
    { timeout: 10_000 },
  );
  await expect(endScreen).toBeVisible({ timeout: 5_000 });
  await endScreen.locator("button", { hasText: "Restart" }).click();
  await page.waitForFunction(() => globalThis.__arkanoid!.soloPhase === "playing", null, { timeout: 5_000 });
  expect(await page.evaluate(() => globalThis.__arkanoid!.soloRound)).toBe(1);
  expect(await page.evaluate(() => globalThis.__arkanoid!.soloScore)).toBe(0);

  expect(errors).toEqual([]);
});
