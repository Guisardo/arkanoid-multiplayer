import { expect, test } from "@playwright/test";

test("app boots with a canvas and zero console errors", async ({ page, baseURL }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.goto(baseURL ?? "http://localhost:5173");
  await expect(page.locator("#app canvas")).toBeVisible();
  await expect.poll(() => errors.length, { timeout: 10_000 }).toBe(0);
});
