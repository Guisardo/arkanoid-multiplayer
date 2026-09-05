import { expect, test } from "@playwright/test";

test("app boots with a canvas and zero console errors", async ({ page, baseURL }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.goto(baseURL ?? "http://localhost:5173");
  // Landing screen shows first (ticket 45); Solo boots the session.
  await expect(page.locator("button", { hasText: "Solo" })).toBeVisible();
  await page.locator("button", { hasText: "Solo" }).click();
  await expect(page.locator("#app canvas")).toBeVisible();
  await expect.poll(() => errors.length, { timeout: 10_000 }).toBe(0);
});
