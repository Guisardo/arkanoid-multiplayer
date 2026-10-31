// Join by QR (#159): what a scanned payload may carry, the scanner seam the
// join screen depends on, camera detection by capability (never by user
// agent) and camera failure kinds. No decoder here — the qr-scanner library
// sits behind `QrScanner` in ui/cameraQrScanner and loads on demand.
import { ROOM_CODE_REGEX } from "signaling/code";

/** Read ?code= from a Room link (any host); null when absent/invalid. */
export function codeFromUrl(url: string): string | null {
  // The lookahead rejects a longer value instead of reading its first 5 chars.
  const m = /[?&]code=([A-Za-z0-9]{5})(?![A-Za-z0-9])/.exec(url);
  const code = m?.[1];
  if (code === undefined || !ROOM_CODE_REGEX.test(code)) return null;
  return code;
}

/** The slice of `navigator.mediaDevices` camera access needs (fakeable in tests). */
export type CameraMedia = Pick<MediaDevices, "getUserMedia" | "enumerateDevices">;

/**
 * Camera QR scanner seam. `start` resolves once the camera is live and
 * rejects when it cannot start (a `CameraError` when the cause is known);
 * every decoded payload goes to `onText`. `stop` releases the camera and is
 * safe to call at any time, including while `start` is still pending.
 */
export interface QrScanner {
  start(video: HTMLVideoElement, onText: (text: string) => void): Promise<void>;
  stop(): void;
}

/** Why the camera could not start; each kind has its own message. */
export type CameraErrorKind = "denied" | "noCamera" | "busy";

export class CameraError extends Error {
  readonly kind: CameraErrorKind;

  constructor(kind: CameraErrorKind, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CameraError";
    this.kind = kind;
  }
}

/** getUserMedia failure names → kind. Anything else is unclassified. */
const CAMERA_ERROR_KINDS: Readonly<Record<string, CameraErrorKind>> = {
  NotAllowedError: "denied",
  SecurityError: "denied",
  NotFoundError: "noCamera",
  OverconstrainedError: "noCamera",
  NotReadableError: "busy",
  AbortError: "busy",
};

/** Classify a getUserMedia rejection; null when the cause is not a known camera failure. */
export function cameraErrorFrom(err: unknown): CameraError | null {
  // OverconstrainedError is not a DOMException in every browser, so read `name`.
  const name = typeof err === "object" && err !== null ? (err as { name?: unknown }).name : undefined;
  if (typeof name !== "string") return null;
  const kind = CAMERA_ERROR_KINDS[name];
  if (kind === undefined) return null;
  return new CameraError(kind, `cameraErrorFrom: camera unavailable (name=${name}, kind=${kind})`, { cause: err });
}

/**
 * True when this device can scan: getUserMedia exists (absent in insecure
 * contexts) and a video input is listed. Capability only, no UA sniffing.
 */
export async function detectCamera(media: CameraMedia | undefined): Promise<boolean> {
  if (media === undefined || typeof media.getUserMedia !== "function") return false;
  const devices = await media.enumerateDevices();
  return devices.some((d) => d.kind === "videoinput");
}

/** Room code carried by a scanned QR: a Room link or a bare code; null otherwise. */
export function roomCodeFromScan(text: string): string | null {
  const trimmed = text.trim();
  if (ROOM_CODE_REGEX.test(trimmed)) return trimmed;
  return codeFromUrl(trimmed);
}
