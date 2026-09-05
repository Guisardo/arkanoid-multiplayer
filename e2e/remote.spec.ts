// E2E (ticket 45): two browser contexts connect over real WebRTC via the
// copy-paste fallback (dev connector). The offer/answer codes are exchanged
// between contexts by the test itself — the same bytes a human would paste.
// No signaling Worker needed (that lands with 53/55).
import { expect, test } from "@playwright/test";

/** Loose shape of the in-page imported rtc module (vite dev transforms). */
interface Channels {
  gameChannel: RTCDataChannel;
  controlChannel: RTCDataChannel;
}
interface HostFlow {
  offerCode: string;
  connection: Promise<Channels>;
}
interface HostRtc {
  connectViaCopyPasteHost(receive: Promise<string>): Promise<HostFlow>;
}
interface GuestFlow {
  answerCode: string;
  connection: Promise<Channels>;
}
interface GuestRtc {
  connectViaCopyPasteGuest(offerCode: string): Promise<GuestFlow>;
}

test("two contexts connect via copy-paste WebRTC and open both channels", async ({ browser }) => {
  const errors: string[] = [];
  const host = await browser.newContext();
  const guest = await browser.newContext();
  const hostPage = await host.newPage();
  const guestPage = await guest.newPage();
  hostPage.on("pageerror", (err) => errors.push(`host: ${String(err)}`));
  guestPage.on("pageerror", (err) => errors.push(`guest: ${String(err)}`));
  await hostPage.goto("/");
  await guestPage.goto("/");

  // Host starts the copy-paste flow (page-side module import + handshake).
  await hostPage.evaluate(() => {
    const w = globalThis as unknown as {
      __submitAnswer?: (code: string) => void;
      __hostFlow?: HostFlow;
    };
    // Dev-only dynamic module load: the vite dev server transforms it; the
    // Function constructor keeps the path out of the bundler's graph.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const load = new Function("return import('/src/signaling/rtc.ts')") as () => Promise<HostRtc>;
    void load().then(async (rtc) => {
      w.__hostFlow = await rtc.connectViaCopyPasteHost(
        new Promise<string>((resolve) => {
          w.__submitAnswer = resolve;
        }),
      );
    });
  });
  const offerCode = await hostPage
    .evaluate(
      (key: string) =>
        new Promise<HostFlow>((resolve) => {
          const check = (): void => {
            const w = globalThis as unknown as Record<string, unknown>;
            if (w[key] !== undefined) resolve(w[key] as HostFlow);
            else globalThis.setTimeout(check, 50);
          };
          check();
        }),
      "__hostFlow",
    )
    .then((flow) => flow.offerCode);

  // Guest decodes the offer, produces an answer code; the test pastes it back.
  await guestPage.evaluate((offer: string) => {
    const w = globalThis as unknown as { __guestFlow?: GuestFlow };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const load = new Function("return import('/src/signaling/rtc.ts')") as () => Promise<GuestRtc>;
    void load().then(async (rtc) => {
      w.__guestFlow = await rtc.connectViaCopyPasteGuest(offer);
    });
  }, offerCode);
  const answerCode = await guestPage
    .evaluate(
      (key: string) =>
        new Promise<GuestFlow>((resolve) => {
          const check = (): void => {
            const w = globalThis as unknown as Record<string, unknown>;
            if (w[key] !== undefined) resolve(w[key] as GuestFlow);
            else globalThis.setTimeout(check, 50);
          };
          check();
        }),
      "__guestFlow",
    )
    .then((flow) => flow.answerCode);

  await hostPage.evaluate((answer: string) => {
    const w = globalThis as unknown as { __submitAnswer?: (code: string) => void };
    w.__submitAnswer?.(answer);
  }, answerCode);

  const hostReady = await hostPage.evaluate(async () => {
    const w = globalThis as unknown as { __hostFlow?: HostFlow };
    for (let i = 0; i < 600; i++) {
      const flow = w.__hostFlow;
      if (flow !== undefined) {
        try {
          const conn = await Promise.race([
            flow.connection,
            new Promise<Channels | undefined>((resolve) => { globalThis.setTimeout(() => { resolve(undefined); }, 100); }),
          ]);
          if (conn !== undefined && conn.gameChannel.readyState === "open" && conn.controlChannel.readyState === "open") {
            return true;
          }
        } catch {
          // Connection failed this poll — retry until timeout.
        }
      }
      await new Promise((r) => globalThis.setTimeout(r, 100));
    }
    return false;
  });
  const guestReady = await guestPage.evaluate(async () => {
    const w = globalThis as unknown as { __guestFlow?: GuestFlow };
    for (let i = 0; i < 600; i++) {
      const flow = w.__guestFlow;
      if (flow !== undefined) {
        try {
          const conn = await Promise.race([
            flow.connection,
            new Promise<Channels | undefined>((resolve) => { globalThis.setTimeout(() => { resolve(undefined); }, 100); }),
          ]);
          if (conn !== undefined && conn.gameChannel.readyState === "open" && conn.controlChannel.readyState === "open") {
            return true;
          }
        } catch {
          // retry
        }
      }
      await new Promise((r) => globalThis.setTimeout(r, 100));
    }
    return false;
  });
  expect(hostReady).toBe(true);
  expect(guestReady).toBe(true);

  // Echo: binary host → guest → host round-trips over the game channel.
  // Arm listeners on both pages first (unreliable channel has no server
  // buffering — a late listener misses the message), then send, then poll.
  await hostPage.evaluate(async () => {
    const w = globalThis as unknown as { __hostFlow?: HostFlow; __echoGot?: number[] };
    const ch = (await w.__hostFlow!.connection).gameChannel;
    ch.addEventListener("message", (ev: MessageEvent) => {
      w.__echoGot = Array.from(new Uint8Array(ev.data as ArrayBuffer));
    }, { once: true });
  });
  await guestPage.evaluate(async () => {
    const w = globalThis as unknown as { __guestFlow?: GuestFlow; __echoGot?: number[] };
    const ch = (await w.__guestFlow!.connection).gameChannel;
    ch.addEventListener("message", (ev: MessageEvent) => {
      w.__echoGot = Array.from(new Uint8Array(ev.data as ArrayBuffer));
      ch.send(ev.data as ArrayBuffer);
    }, { once: true });
  });
  await hostPage.evaluate(async () => {
    const w = globalThis as unknown as { __hostFlow?: HostFlow };
    const ch = (await w.__hostFlow!.connection).gameChannel;
    ch.send(new Uint8Array([1, 2, 3, 4]).buffer);
  });
  const guestGot = await guestPage.evaluate(() =>
    new Promise<number[]>((resolve) => {
      const check = (): void => {
        const w = globalThis as unknown as { __echoGot?: number[] };
        if (w.__echoGot !== undefined) resolve(w.__echoGot);
        else globalThis.setTimeout(check, 50);
      };
      check();
    }),
  );
  const hostGot = await hostPage.evaluate(() =>
    new Promise<number[]>((resolve) => {
      const check = (): void => {
        const w = globalThis as unknown as { __echoGot?: number[] };
        if (w.__echoGot !== undefined) resolve(w.__echoGot);
        else globalThis.setTimeout(check, 50);
      };
      check();
    }),
  );
  expect(guestGot).toEqual([1, 2, 3, 4]);
  expect(hostGot).toEqual([1, 2, 3, 4]);

  expect(errors).toEqual([]);
  await host.close();
  await guest.close();
});
