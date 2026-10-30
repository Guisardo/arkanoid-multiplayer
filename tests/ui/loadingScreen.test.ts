// @vitest-environment jsdom
// Gameplay-bundle loading screen (ticket 87): a progress bar shown while the
// deferred bundle is fetched at match start. Behaviour only — what a player and
// a screen reader can observe — not the markup around it.
import { describe, expect, it } from "vitest";
import { LoadingScreen } from "ui/loadingScreen";

function mount(locale: "en-US" | "es-419" = "en-US"): { host: HTMLElement; screen: LoadingScreen } {
  document.body.innerHTML = "";
  const host = document.createElement("div");
  document.body.appendChild(host);
  return { host, screen: new LoadingScreen({ host, locale }) };
}

function bar(host: HTMLElement): HTMLElement {
  const el = host.querySelector<HTMLElement>("[role='progressbar']");
  if (el === null) throw new Error("no progressbar rendered");
  return el;
}

describe("LoadingScreen (ticket 87)", () => {
  it("mounts over the host as an accessible progress bar starting at 0", () => {
    const { host } = mount();
    expect(bar(host).getAttribute("aria-valuemin")).toBe("0");
    expect(bar(host).getAttribute("aria-valuemax")).toBe("100");
    expect(bar(host).getAttribute("aria-valuenow")).toBe("0");
  });

  it("reflects progress as a whole percent, in the bar and in the text", () => {
    const { host, screen } = mount();
    screen.setProgress(0.426);
    expect(bar(host).getAttribute("aria-valuenow")).toBe("43");
    expect(host.textContent).toContain("43%");
  });

  it("clamps progress into 0..100", () => {
    const { host, screen } = mount();
    screen.setProgress(1.7);
    expect(bar(host).getAttribute("aria-valuenow")).toBe("100");
    screen.setProgress(-3);
    expect(bar(host).getAttribute("aria-valuenow")).toBe("0");
  });

  it("treats a non-finite progress as 0 rather than rendering NaN%", () => {
    const { host, screen } = mount();
    screen.setProgress(Number.NaN);
    expect(bar(host).getAttribute("aria-valuenow")).toBe("0");
    expect(host.textContent).not.toContain("NaN");
  });

  it("names what is loading, in the requested locale", () => {
    expect(mount("en-US").host.textContent).toContain("Loading game assets");
    expect(mount("es-419").host.textContent).toContain("Cargando recursos del juego");
  });

  it("labels the bar so assistive tech announces what it measures", () => {
    const { host } = mount();
    expect(bar(host).getAttribute("aria-label")).toContain("Loading game assets");
  });

  it("removes itself on close, and closing twice is harmless", () => {
    const { host, screen } = mount();
    screen.close();
    expect(host.querySelector("[role='progressbar']")).toBeNull();
    expect(() => {
      screen.close();
    }).not.toThrow();
  });

  it("ignores progress after close instead of throwing", () => {
    const { screen } = mount();
    screen.close();
    expect(() => {
      screen.setProgress(0.5);
    }).not.toThrow();
  });
});
