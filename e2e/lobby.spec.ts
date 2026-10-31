// E2E (ticket 53): lobby create/join over the copy-paste fallback (spec §9
// — auto-offered when the signaling WS is unavailable; doubles as the dev
// connector, spec §17). Two browser contexts exchange offer/answer codes
// through the UI itself — the same bytes a human would paste. Then: lobby
// syncs both sides, ready gate, 3-2-1 countdown, match starts.
import { expect, test } from "@playwright/test";
import { abortSignaling, createRoom, exchangeCodes, hostOffer, lobbyOf } from "./support/multiplayer";

test("lobby: two contexts connect via copy-paste, ready gate, countdown, match starts", async ({ browser }) => {
  // Budget: ~30 s for the real ICE + DTLS handshake on a loaded box, a countdown
  // that stretches under timer throttling, then two SwiftShader WebGL inits
  // waited on sequentially (hence the headroom over the per-assertion budgets).
  test.setTimeout(300_000);
  const errors: string[] = [];
  const host = await browser.newContext();
  const guest = await browser.newContext();
  const hostPage = await host.newPage();
  const guestPage = await guest.newPage();
  hostPage.on("pageerror", (err) => errors.push(`host: ${String(err)}`));
  guestPage.on("pageerror", (err) => errors.push(`guest: ${String(err)}`));
  // Deterministic signaling-down: the copy-paste fallback engages at once.
  await abortSignaling(hostPage);
  await abortSignaling(guestPage);

  // Host: landing → Multiplayer → Create room shows the room code.
  const roomCode = await createRoom(hostPage);
  const { hostCp, offerCode } = await hostOffer(hostPage);

  // Guest: QR-share path — open the room link (?code= prefills join).
  await guestPage.goto(`/?code=${roomCode}`);
  const boxes = guestPage.locator(".ld-input");
  await expect(boxes.first()).toBeVisible({ timeout: 10_000 });
  await expect(guestPage.locator("button", { hasText: "Join" })).toBeVisible();
  await guestPage.locator("button", { hasText: "Join" }).click();
  await exchangeCodes(guestPage, hostCp, offerCode);

  // Both sides land in the lobby, synced (guest visible on host).
  const hostLobby = lobbyOf(hostPage);
  await expect(hostLobby).toBeVisible({ timeout: 15_000 });
  const guestLobby = lobbyOf(guestPage);
  await expect(guestLobby).toBeVisible({ timeout: 15_000 });
  // Host sees 2 players (itself + the guest).
  await expect(hostLobby.locator("button", { hasText: "Ready" })).toHaveCount(2, { timeout: 10_000 });

  // Ticket 101: the host lobby re-shows the join QR; the guest has no QR.
  await expect(hostLobby.locator("canvas")).toHaveCount(1);
  await expect(guestLobby.locator("canvas")).toHaveCount(0);
  // Start stays gated until everyone is ready.
  await expect(hostLobby.locator("button", { hasText: "Start" })).toBeDisabled();

  // Ready gate: both toggle ready, host Start → countdown → match.
  const hostReady = hostLobby.locator("button", { hasText: "Not ready" }).first();
  await hostReady.click();
  const guestReady = guestLobby.locator("button", { hasText: "Not ready" }).first();
  await guestReady.click();
  await expect(hostLobby.locator("button", { hasText: "Ready" })).toHaveCount(2, { timeout: 10_000 });

  await hostLobby.locator("button", { hasText: "Start" }).click();

  // Phase probe first, canvas second. Order matters for diagnosability, and
  // both steps need a budget that survives a contended box:
  //   - The countdown is 3 × setInterval(1000). A throttled interval stretches
  //     it, so 3 s nominal can be well over 15 s when the machine is busy —
  //     measured up to ~6.5 s here with two workers. 45 s leaves room without
  //     hiding a genuine desync, which would never leave the lobby at all.
  //   - Mounting the canvas then waits on Pixi's WebGL init, which runs on
  //     SwiftShader in CI and took 2.5 s unloaded but ~17.5 s while three
  //     browsers contended for the box.
  // So a failure here is the handshake (a side never left the lobby); a failure
  // at the next assertion is only a slow renderer.
  await expect(hostPage.locator('[data-screen="lobby"]')).toBeHidden({ timeout: 45_000 });
  await expect(guestPage.locator('[data-screen="lobby"]')).toBeHidden({ timeout: 45_000 });

  // The opaque lobby overlay must be gone — a canvas behind it would still
  // count as "visible" to Playwright, which is why the probe above is needed
  // at all.
  await expect(hostPage.locator("#app canvas")).toBeVisible({ timeout: 45_000 });
  await expect(guestPage.locator("#app canvas")).toBeVisible({ timeout: 45_000 });

  // A guest that stalls past the blind banner shows "Connection lost…", which
  // is correct signal on a slow host and is why the probe above is scoped to the
  // lobby screen. A *fatal* overlay is not correct signal under any timing, so
  // assert neither side reached it.
  await expect(hostPage.locator('[data-screen="fatal"]')).toHaveCount(0);
  await expect(guestPage.locator('[data-screen="fatal"]')).toHaveCount(0);

  expect(errors).toEqual([]);
  await host.close();
  await guest.close();
});
