// Mobile layout rules tests (ticket 42): device class, local-player caps,
// portrait/landscape plans, side-by-side regions (never stacked), lock
// attempt outcomes.
import { describe, expect, it } from "vitest";
import {
  detectDeviceClass,
  maxLocalPlayers,
  layoutPlan,
  mobileRegions,
  attemptLandscapeLock,
  type FullscreenElementLike,
  type ScreenOrientationLike,
} from "app/mobileLayout";

describe("device class detection", () => {
  it("Android phone UA + coarse pointer = mobile touch", () => {
    const d = detectDeviceClass(true, "Mozilla/5.0 (Linux; Android 13; Pixel 7)");
    expect(d.touch).toBe(true);
    expect(d.mobile).toBe(true);
  });

  it("desktop UA + fine pointer = not touch, not mobile", () => {
    const d = detectDeviceClass(false, "Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
    expect(d.touch).toBe(false);
    expect(d.mobile).toBe(false);
  });

  it("iPadOS masquerade: Mac UA + coarse pointer = mobile", () => {
    const d = detectDeviceClass(true, "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
    expect(d.mobile).toBe(true);
  });
});

describe("local-player caps", () => {
  it("desktop 4, mobile 2", () => {
    expect(maxLocalPlayers({ touch: false, mobile: false })).toBe(4);
    expect(maxLocalPlayers({ touch: true, mobile: true })).toBe(2);
  });
});

describe("layout plans", () => {
  it("desktop: N-across split, no lock, no fullscreen", () => {
    const p = layoutPlan({ touch: false, mobile: false }, 2);
    expect(p.plan).toBe("desktop");
    expect(p.attemptLock).toBe(false);
    expect(p.attemptFullscreen).toBe(false);
  });

  it("mobile 1-local: portrait, no lock", () => {
    const p = layoutPlan({ touch: true, mobile: true }, 1);
    expect(p.plan).toBe("portrait");
    expect(p.attemptLock).toBe(false);
  });

  it("mobile 2-local: landscape, lock + fullscreen attempted", () => {
    const p = layoutPlan({ touch: true, mobile: true }, 2);
    expect(p.plan).toBe("landscape");
    expect(p.attemptLock).toBe(true);
    expect(p.attemptFullscreen).toBe(true);
  });
});

describe("regions", () => {
  it("1-local: single full-viewport region", () => {
    const r = mobileRegions({ w: 400, h: 800 }, 1);
    expect(r).toEqual([{ x: 0, y: 0, w: 400, h: 800 }]);
  });

  it("2-local: side-by-side halves in ANY orientation (never stacked)", () => {
    // Landscape result.
    const wide = mobileRegions({ w: 800, h: 400 }, 2);
    expect(wide).toEqual([
      { x: 0, y: 0, w: 400, h: 400 },
      { x: 400, y: 0, w: 400, h: 400 },
    ]);
    // Lock failed → portrait results: still side-by-side, not stacked.
    const tall = mobileRegions({ w: 400, h: 800 }, 2);
    expect(tall).toEqual([
      { x: 0, y: 0, w: 200, h: 800 },
      { x: 200, y: 0, w: 200, h: 800 },
    ]);
  });
});

describe("fullscreen + orientation lock attempt", () => {
  const okOrientation: ScreenOrientationLike = {
    lock: async () => {
      await Promise.resolve();
    },
    unlock: () => {},
    type: "landscape-primary",
  };
  const failingOrientation: ScreenOrientationLike = {
    lock: () => Promise.reject(new Error("not allowed")),
    unlock: () => {},
    type: "portrait-primary",
  };
  const okElement: FullscreenElementLike = {
    requestFullscreen: async () => {
      await Promise.resolve();
    },
  };

  it("both succeed when supported", async () => {
    const r = await attemptLandscapeLock(okElement, okOrientation);
    expect(r.fullscreen).toBe(true);
    expect(r.locked).toBe(true);
  });

  it("lock failure degrades to side-by-side fallback (locked=false, no throw)", async () => {
    const r = await attemptLandscapeLock(okElement, failingOrientation);
    expect(r.locked).toBe(false);
  });

  it("missing APIs degrade cleanly", async () => {
    const r = await attemptLandscapeLock(null, null);
    expect(r.fullscreen).toBe(false);
    expect(r.locked).toBe(false);
  });
});
