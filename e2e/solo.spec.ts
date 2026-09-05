import { expect, test } from "@playwright/test";

test("solo round playable: paddle moves with keyboard, launch serves the ball", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.goto("/");
  // Landing (ticket 45): Solo entry boots the session.
  await page.locator("button", { hasText: "Solo" }).click();
  await page.waitForFunction(() => globalThis.__arkanoid !== undefined, null, { timeout: 15_000 });

  const initial = await page.evaluate(() => {
    const s = globalThis.__arkanoid!.latestSnapshot();
    return { paddleX: s.players[0]!.paddle.x, phase: s.phase, tick: s.tick };
  });
  expect(initial.phase).toBe("serve");

  // Hold right arrow for ~500 ms → paddle moves right.
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(500);
  await page.keyboard.up("ArrowRight");
  const moved = await page.evaluate(() => globalThis.__arkanoid!.latestSnapshot().players[0]!.paddle.x);
  expect(moved).toBeGreaterThan(initial.paddleX);

  // Space launches the ball.
  await page.keyboard.press("Space");
  await page.waitForTimeout(100);
  const launched = await page.evaluate(() => {
    const s = globalThis.__arkanoid!.latestSnapshot();
    return { phase: s.phase, attached: s.balls[0]!.attachedTo };
  });
  expect(launched.phase).toBe("play");
  expect(launched.attached).toBeNull();

  expect(errors).toEqual([]);
});
