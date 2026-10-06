// E2E (ticket 89): mid-episode persistence. The unit tests drive the record and
// the prompt through jsdom; this drives them through the *real* boot path,
// because the bug this feature could plausibly ship is a record that never
// survives an actual page reload — the one thing jsdom cannot tell you.
import { expect, test } from "@playwright/test";

test("solo episode: an interrupted run is offered as Continue, and Continue resumes that round", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.goto("/");

  // Fresh context: no record, so the landing comes up untouched.
  await expect(page.locator("button", { hasText: "Solo" })).toBeVisible();

  await page.locator("button", { hasText: "Solo" }).click();
  await page.waitForFunction(() => globalThis.__arkanoid !== undefined, null, { timeout: 15_000 });

  // Pause writes the record (ticket 89) — this is the "crash" stand-in.
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-pause-menu]")).toBeVisible({ timeout: 5_000 });

  // Reload: the boot path offers the run back before the landing.
  await page.reload();
  const prompt = page.locator("[data-continue-episode]");
  await expect(prompt).toBeVisible({ timeout: 10_000 });
  await expect(prompt.locator("[data-continue-summary]")).toContainText("Round 1");
  // The landing must NOT be behind the prompt — it is an opaque overlay, so a
  // visible-behind assertion would pass either way.
  await expect(page.locator("button", { hasText: "Solo" })).toHaveCount(0);

  // Continue boots the solo session again.
  await page.locator("[data-continue-choice='continue']").click();
  await page.waitForFunction(() => globalThis.__arkanoid !== undefined, null, { timeout: 15_000 });
  await expect(page.locator("#app canvas")).toBeVisible();
  await expect(prompt).toHaveCount(0);

  // Quitting to the landing abandons the record: a second reload must go
  // straight to the landing, not re-prompt for the run just quit (regression —
  // this looped once, offering to Continue the run the player abandoned).
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-pause-menu]")).toBeVisible({ timeout: 5_000 });
  await page.locator("[data-pause-menu]").locator("button", { hasText: "Quit" }).click();
  await page.reload();
  await expect(page.locator("button", { hasText: "Solo" })).toBeVisible({ timeout: 10_000 });
  await expect(prompt).toHaveCount(0);

  expect(errors).toEqual([]);
});