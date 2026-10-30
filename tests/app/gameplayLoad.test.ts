// @vitest-environment jsdom
// Match-start wiring for the deferred gameplay bundle (ticket 87).
//
// A match creator must (a) request the bundle, (b) show progress while a cold
// load is in flight, and (c) start the match regardless of how the load ended —
// a missing gameplay bundle degrades to procedural art, it never blocks play.
// The loader is injected, so these tests drive timing without touching Pixi.
import { describe, expect, it, vi } from "vitest";
import { startWithGameplayAssets, type GameplayLoader } from "app/gameplayLoad";

function host(): HTMLElement {
  document.body.innerHTML = "";
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

function loader(overrides: Partial<GameplayLoader> = {}): GameplayLoader {
  return {
    isLoaded: () => false,
    ensure: () => Promise.resolve(),
    ...overrides,
  };
}

const progressbar = (el: HTMLElement): HTMLElement | null =>
  el.querySelector<HTMLElement>("[role='progressbar']");

describe("startWithGameplayAssets (ticket 87)", () => {
  it("starts the match straight away, with no loading screen, when the bundle is already loaded", async () => {
    const el = host();
    const ensure = vi.fn(() => Promise.resolve());
    const start = vi.fn(() => "session");
    const result = await startWithGameplayAssets({
      host: el,
      locale: "en-US",
      loader: loader({ isLoaded: () => true, ensure }),
      start,
    });
    expect(result).toBe("session");
    expect(ensure).not.toHaveBeenCalled();
    expect(progressbar(el)).toBeNull();
  });

  it("shows the loading screen while a cold load is in flight, then removes it", async () => {
    const el = host();
    let release: () => void = () => undefined;
    const ensure = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const start = vi.fn(() => "session");
    const pending = startWithGameplayAssets({
      host: el,
      locale: "en-US",
      loader: loader({ ensure }),
      start,
    });
    await Promise.resolve();
    expect(progressbar(el)).not.toBeNull();
    expect(start).not.toHaveBeenCalled();
    release();
    await pending;
    expect(progressbar(el)).toBeNull();
    expect(start).toHaveBeenCalledOnce();
  });

  it("feeds the loader's progress into the bar", async () => {
    const el = host();
    let seen = "";
    const ensure = (onProgress: (p: number) => void): Promise<void> => {
      onProgress(0.5);
      seen = progressbar(el)?.getAttribute("aria-valuenow") ?? "";
      return Promise.resolve();
    };
    await startWithGameplayAssets({
      host: el,
      locale: "en-US",
      loader: loader({ ensure }),
      start: () => "session",
    });
    expect(seen).toBe("50");
  });

  it("starts the match only after the load has finished", async () => {
    const order: string[] = [];
    await startWithGameplayAssets({
      host: host(),
      locale: "en-US",
      loader: loader({
        ensure: () => {
          order.push("loaded");
          return Promise.resolve();
        },
      }),
      start: () => {
        order.push("started");
        return "session";
      },
    });
    expect(order).toEqual(["loaded", "started"]);
  });

  it("still starts the match, and reports why, when the load throws", async () => {
    const el = host();
    const cause = new Error("network down");
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const start = vi.fn(() => "session");
    const result = await startWithGameplayAssets({
      host: el,
      locale: "en-US",
      loader: loader({ ensure: () => Promise.reject(cause) }),
      start,
    });
    expect(result).toBe("session");
    expect(progressbar(el)).toBeNull();
    expect(error).toHaveBeenCalledWith(expect.stringContaining("gameplay assets"), cause);
    error.mockRestore();
  });

  it("removes the loading screen before the match starts, so a throwing start cannot strand it", async () => {
    const el = host();
    await expect(
      startWithGameplayAssets({
        host: el,
        locale: "en-US",
        loader: loader(),
        start: () => {
          throw new Error("session failed");
        },
      }),
    ).rejects.toThrow("session failed");
    expect(progressbar(el)).toBeNull();
  });

  it("waits for an async match creator and returns its session", async () => {
    const result = await startWithGameplayAssets({
      host: host(),
      locale: "en-US",
      loader: loader({ isLoaded: () => true }),
      start: () => Promise.resolve({ id: 7 }),
    });
    expect(result).toEqual({ id: 7 });
  });

  it("shows the loading text in the requested locale", async () => {
    const el = host();
    let text = "";
    await startWithGameplayAssets({
      host: el,
      locale: "es-419",
      loader: loader({
        ensure: () => {
          text = el.textContent ?? "";
          return Promise.resolve();
        },
      }),
      start: () => "session",
    });
    expect(text).toContain("Cargando");
  });
});
