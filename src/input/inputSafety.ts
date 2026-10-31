// Held-fire safety (ticket #143, spec #140): held input must never stick.
// Browsers drop the matching keyup / pointerup whenever focus leaves mid-hold
// (window blur, tab hidden, a context menu), so a held arrow drifts the Paddle
// and held fire keeps shooting. The fix is root-cause, not a sim watchdog:
// release every device's held state on those events, and derive the mouse's
// held button from `PointerEvent.buttons` on every pointer event.
//
// Each session binds this once (solo, versus-bots, multiplayer) and calls
// `release()` when it opens pause / settings / an end screen.

/** A device whose held state can be dropped (every input adapter). */
export interface HeldReleasable {
  releaseHeld(): void;
}

/** The mouse surface `bindMouseHeld` drives. */
export interface MouseHeldTarget extends HeldReleasable {
  feedButtons(buttons: number): void;
}

export interface InputSafety {
  /** Release every device now (pause / settings / end screen open). */
  readonly release: () => void;
  /** Release once more and remove every listener (session teardown). */
  readonly unbind: () => void;
}

/** Event sources `bindInputSafety` listens on; defaults to the page. */
export interface InputSafetyTargets {
  window: Pick<EventTarget, "addEventListener" | "removeEventListener">;
  document: Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState">;
}

/**
 * Release `devices()` on window blur, tab hidden and any context menu.
 * `devices` is read at release time, so lazily created adapters (multiplayer
 * creates gamepads/mice/touch per player on first use) are covered.
 */
export function bindInputSafety(
  devices: () => Iterable<HeldReleasable>,
  targets: InputSafetyTargets = { window: globalThis, document },
): InputSafety {
  const release = (): void => {
    for (const d of devices()) d.releaseHeld();
  };
  const onVisibility = (): void => {
    if (targets.document.visibilityState === "hidden") release();
  };
  targets.window.addEventListener("blur", release);
  targets.window.addEventListener("contextmenu", release);
  targets.document.addEventListener("visibilitychange", onVisibility);
  return {
    release,
    unbind: () => {
      targets.window.removeEventListener("blur", release);
      targets.window.removeEventListener("contextmenu", release);
      targets.document.removeEventListener("visibilitychange", onVisibility);
      release();
    },
  };
}

/**
 * Keep a mouse adapter's held button in step with the game canvas: re-derive
 * it from `buttons` on every mouse pointer event (self-healing), capture the
 * pointer on a button-0 press so a release outside the canvas still arrives,
 * drop it on cancel / lost capture, and suppress the canvas context menu (a
 * right click must not open a menu that swallows the release). Touch pointers
 * are ignored: touch fires from its own button cluster.
 * @returns unbind.
 */
export function bindMouseHeld(canvas: HTMLElement, mouse: MouseHeldTarget): () => void {
  const isMouse = (e: PointerEvent): boolean => e.pointerType !== "touch";
  const onDown = (e: PointerEvent): void => {
    if (!isMouse(e)) return;
    mouse.feedButtons(e.buttons);
    if (e.button === 0) canvas.setPointerCapture(e.pointerId);
  };
  const onSample = (e: PointerEvent): void => {
    if (isMouse(e)) mouse.feedButtons(e.buttons);
  };
  const onLost = (e: PointerEvent): void => {
    if (isMouse(e)) mouse.releaseHeld();
  };
  const onContextMenu = (e: Event): void => {
    e.preventDefault();
  };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onSample);
  canvas.addEventListener("pointerup", onSample);
  canvas.addEventListener("pointercancel", onLost);
  canvas.addEventListener("lostpointercapture", onLost);
  canvas.addEventListener("contextmenu", onContextMenu);
  return () => {
    canvas.removeEventListener("pointerdown", onDown);
    canvas.removeEventListener("pointermove", onSample);
    canvas.removeEventListener("pointerup", onSample);
    canvas.removeEventListener("pointercancel", onLost);
    canvas.removeEventListener("lostpointercapture", onLost);
    canvas.removeEventListener("contextmenu", onContextMenu);
  };
}
