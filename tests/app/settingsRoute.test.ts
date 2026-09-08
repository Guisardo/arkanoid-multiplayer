// Settings overlay route (spec §14, ticket 53): showSettings mounts the
// real SettingsScreen and passes the sections option through — in-session
// settings = Audio/Display only.
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { showSettings } from "app/settingsRoute";
import { Storage } from "persistence/storage";

describe("settingsRoute (ticket 53)", () => {
  afterEach(() => {
    document.body.replaceChildren();
    globalThis.localStorage.clear();
  });

  it("default: all four sections render", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const screen = showSettings(host, "en-US", new Storage());
    const text = screen.root.textContent ?? "";
    expect(text).toContain("Controls");
    expect(text).toContain("Audio");
    expect(text).toContain("Display");
    expect(text).toContain("Appearance");
    screen.close();
  });

  it("sections option passes through: in-session = Audio/Display only", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const screen = showSettings(host, "en-US", new Storage(), {
      sections: ["audio", "display"],
    });
    const text = screen.root.textContent ?? "";
    expect(text).toContain("Audio");
    expect(text).toContain("Display");
    expect(text).not.toContain("Controls");
    expect(text).not.toContain("Appearance");
    screen.close();
  });

  it("onClose fires when the screen closes", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    let closed = 0;
    const screen = showSettings(host, "en-US", new Storage(), {
      onClose: () => { closed++; },
    });
    screen.close();
    expect(closed).toBe(1);
  });
});
