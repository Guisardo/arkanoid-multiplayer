// Mobile layout rules (ticket 42, spec §12): 1-local = portrait, no lock;
// 2-local = landscape, fullscreen + orientation-lock attempt at match start,
// lock failure → side-by-side in whatever orientation results. No stacked
// mode. Pure decision logic — the app performs the actual Fullscreen/
// screen.orientation calls and reports outcomes back.
import type { Region } from "render/layout";

/** Device class (app detects once per session). */
export interface DeviceClass {
  /** Primary input includes touch (coarse pointer). */
  touch: boolean;
  /** Mobile UA (phone/tablet). */
  mobile: boolean;
}

export function detectDeviceClass(
  coarsePointer: boolean,
  userAgent: string,
): DeviceClass {
  const mobile =
    /android|iphone|ipad|ipod|mobile|silk|kindle/i.test(userAgent) ||
    (/macintosh/i.test(userAgent) && coarsePointer); // iPadOS 13+ masquerades
  return { touch: coarsePointer, mobile };
}

/** Local-player cap per device (spec §12): desktop 4, mobile 2. */
export function maxLocalPlayers(device: DeviceClass): number {
  return device.mobile ? 2 : 4;
}

export type LocalLayoutPlan = "portrait" | "landscape";

/**
 * Layout plan for N local players on this device. 1-local = portrait, no
 * lock; 2-local = landscape (lock attempted). Desktop (non-mobile) keeps
 * the default N-across split — no orientation rules apply.
 */
export function layoutPlan(device: DeviceClass, localPlayers: number): {
  plan: LocalLayoutPlan | "desktop";
  attemptLock: boolean;
  attemptFullscreen: boolean;
} {
  if (!device.mobile) return { plan: "desktop", attemptLock: false, attemptFullscreen: false };
  if (localPlayers <= 1) return { plan: "portrait", attemptLock: false, attemptFullscreen: false };
  return { plan: "landscape", attemptLock: true, attemptFullscreen: true };
}

/** Orientation outcome → effective regions. Lock failure → side-by-side fallback. */
export function mobileRegions(
  viewport: { w: number; h: number },
  localPlayers: number,
): Region[] {
  if (localPlayers <= 1) return [{ x: 0, y: 0, w: viewport.w, h: viewport.h }];
  // 2-local: side-by-side in whatever orientation results — never stacked.
  const half = viewport.w / 2;
  return [
    { x: 0, y: 0, w: half, h: viewport.h },
    { x: half, y: 0, w: viewport.w - half, h: viewport.h },
  ];
}

/** Attempt fullscreen + orientation lock; returns what actually held. */
export async function attemptLandscapeLock(
  element: FullscreenElementLike | null,
  orientationLike: ScreenOrientationLike | null,
): Promise<{ fullscreen: boolean; locked: boolean }> {
  let fullscreen = false;
  if (element !== null && typeof element.requestFullscreen === "function") {
    try {
      await element.requestFullscreen();
      fullscreen = true;
    } catch {
      fullscreen = false;
    }
  }
  let locked = false;
  if (orientationLike !== null && typeof orientationLike.lock === "function") {
    try {
      await orientationLike.lock("landscape");
      locked = true;
    } catch {
      locked = false;
    }
  }
  return { fullscreen, locked };
}

/** Minimal element surface for fullscreen (injectable for tests). */
export interface FullscreenElementLike {
  requestFullscreen(): Promise<void>;
}

/** Minimal screen.orientation surface (injectable for tests). */
export interface ScreenOrientationLike {
  lock(orientation: "landscape" | "portrait"): Promise<void>;
  unlock(): void;
  readonly type: string;
}
