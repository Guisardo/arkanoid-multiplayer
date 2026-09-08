// E2E (ticket 53): lobby create/join over the copy-paste fallback (spec §9
// — auto-offered when the signaling WS is unavailable; doubles as the dev
// connector, spec §17). Two browser contexts exchange offer/answer codes
// through the UI itself — the same bytes a human would paste. Then: lobby
// syncs both sides, ready gate, 3-2-1 countdown, match starts.
import { expect, test } from "@playwright/test";

test("lobby: two contexts connect via copy-paste, ready gate, countdown, match starts", async ({ browser }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  const host = await browser.newContext();
  const guest = await browser.newContext();
  const hostPage = await host.newPage();
  const guestPage = await guest.newPage();
  hostPage.on("pageerror", (err) => errors.push(`host: ${String(err)}`));
  guestPage.on("pageerror", (err) => errors.push(`guest: ${String(err)}`));
  // Deterministic signaling-down: abort the room WS on both sides so the
  // copy-paste fallback engages immediately (the dev server would
  // otherwise accept the upgrade and stall the relay handshake).
  const abortSignaling = async (page: typeof hostPage): Promise<void> => {
    await page.routeWebSocket(/\/room\/.+\/ws/, (ws) => {
      void ws.close();
    });
  };
  await abortSignaling(hostPage);
  await abortSignaling(guestPage);

  // Host: landing → Multiplayer → create screen shows the room code.
  await hostPage.goto("/");
  await hostPage.locator("button", { hasText: "Multiplayer" }).click();
  const roomCode = (await hostPage.locator(".ld-code").textContent()) ?? "";
  expect(roomCode).toBeTruthy();
  await hostPage.locator("button", { hasText: "Continue" }).first().click();
  const hostCp = hostPage.locator(".cp-root");
  await expect(hostCp).toBeVisible({ timeout: 15_000 });
  const offerCode = await hostCp.locator("[data-copy-code]").textContent();
  expect(offerCode).toBeTruthy();

  // Guest: QR-share path — open the room link (?code= prefills join).
  await guestPage.goto(`/?code=${roomCode}`);
  const boxes = guestPage.locator(".ld-input");
  await expect(boxes.first()).toBeVisible({ timeout: 10_000 });
  await expect(guestPage.locator("button", { hasText: "Join" })).toBeVisible();
  await guestPage.locator("button", { hasText: "Join" }).click();
  const guestCp = guestPage.locator(".cp-root");
  await expect(guestCp).toBeVisible({ timeout: 15_000 });
  await guestCp.locator("[data-copy-paste-input]").fill(offerCode!);
  await guestCp.locator("[data-copy-submit]").click();

  // Guest screen now shows the answer code — paste it back on the host.
  // The screen mounts with an empty answer first; connectViaCopyPasteGuest
  // (decode + ICE, up to 5 s) re-renders it with the real code — poll for
  // the non-empty value instead of racing the replacement.
  await expect
    .poll(async () => (await guestCp.locator("[data-copy-code]").textContent()) ?? "", {
      timeout: 15_000,
    })
    .toBeTruthy();
  const answerCode = await guestCp.locator("[data-copy-code]").textContent();
  expect(answerCode).toBeTruthy();
  await hostCp.locator("[data-copy-paste-input]").fill(answerCode!);
  await hostCp.locator("[data-copy-submit]").click();

  // Both sides land in the lobby, synced (guest visible on host).
  const hostLobby = hostPage.locator(".ld-root", { hasText: "Lobby" });
  await expect(hostLobby).toBeVisible({ timeout: 15_000 });
  const guestLobby = guestPage.locator(".ld-root", { hasText: "Lobby" });
  await expect(guestLobby).toBeVisible({ timeout: 15_000 });
  // Host sees 2 players (itself + the guest).
  await expect(hostLobby.locator("button", { hasText: "Ready" })).toHaveCount(2, { timeout: 10_000 });

  // Ready gate: both toggle ready, host Start → countdown → match.
  const hostReady = hostLobby.locator("button", { hasText: "Not ready" }).first();
  await hostReady.click();
  const guestReady = guestLobby.locator("button", { hasText: "Not ready" }).first();
  await guestReady.click();
  await expect(hostLobby.locator("button", { hasText: "Ready" })).toHaveCount(2, { timeout: 10_000 });

  await hostLobby.locator("button", { hasText: "Start" }).click();
  // Countdown 3-2-1 shows on both sides, then the match (canvas).
  await expect(hostPage.locator("#app canvas")).toBeVisible({ timeout: 20_000 });
  await expect(guestPage.locator("#app canvas")).toBeVisible({ timeout: 20_000 });

  expect(errors).toEqual([]);
  await host.close();
  await guest.close();
});
