// E2E (#159): a guest who cannot open the Room link joins by typing the
// room code — landing → Multiplayer → Join room → code → lobby. Connects
// over the copy-paste fallback like lobby.spec.
import { expect, test } from "@playwright/test";
import { abortSignaling, createRoom, exchangeCodes, hostOffer, lobbyOf } from "./support/multiplayer";

test("join room by typing the code reaches the lobby", async ({ browser }) => {
  // Real ICE + DTLS handshake on a loaded box (see lobby.spec budgets).
  test.setTimeout(120_000);
  const errors: string[] = [];
  const host = await browser.newContext();
  const guest = await browser.newContext();
  const hostPage = await host.newPage();
  const guestPage = await guest.newPage();
  hostPage.on("pageerror", (err) => errors.push(`host: ${String(err)}`));
  guestPage.on("pageerror", (err) => errors.push(`guest: ${String(err)}`));
  await abortSignaling(hostPage);
  await abortSignaling(guestPage);

  const roomCode = await createRoom(hostPage);
  const { hostCp, offerCode } = await hostOffer(hostPage);

  // Guest: no Room link — the plain landing page.
  await guestPage.goto("/");
  await guestPage.locator("button", { hasText: "Multiplayer" }).click();
  await guestPage.locator("button", { hasText: "Join room" }).click();
  const boxes = guestPage.locator(".ld-input");
  await expect(boxes).toHaveCount(5);
  await expect(boxes.first()).toHaveValue("");
  // Boxes auto-advance, so typing the whole code from the first box fills all five.
  await boxes.first().click();
  await guestPage.keyboard.type(roomCode);
  for (let i = 0; i < 5; i++) await expect(boxes.nth(i)).toHaveValue(roomCode[i] ?? "");
  await guestPage.getByRole("button", { name: "Join", exact: true }).click();

  await exchangeCodes(guestPage, hostCp, offerCode);
  await expect(lobbyOf(hostPage)).toBeVisible({ timeout: 15_000 });
  await expect(lobbyOf(guestPage)).toBeVisible({ timeout: 15_000 });
  await expect(lobbyOf(hostPage).locator("button", { hasText: "Ready" })).toHaveCount(2, { timeout: 10_000 });

  expect(errors).toEqual([]);
  await host.close();
  await guest.close();
});
