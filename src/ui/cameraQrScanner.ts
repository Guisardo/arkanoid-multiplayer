// Camera-backed QrScanner (#159). This adapter opens the camera itself
// rather than letting qr-scanner do it: qr-scanner folds every getUserMedia
// failure into one "Camera not found." string, and the join screen must tell
// denied / no camera / busy apart. qr-scanner then plays and decodes the
// video it is handed. The library loads through a dynamic import on first
// start, so it never lands in the boot chunk (ADR 0007).
import { CameraError, cameraErrorFrom, type CameraMedia, type QrScanner } from "ui/qrScan";

/** The slice of a started decoder this adapter drives. */
export interface QrDecoder {
  start(): Promise<void>;
  destroy(): void;
}

/** Constructor shape of qr-scanner's default export, as used here. */
export type QrDecoderClass = new (
  video: HTMLVideoElement,
  onDecode: (result: { data: string }) => void,
  options: { returnDetailedScanResult: true; preferredCamera: "environment" },
) => QrDecoder;

export type QrDecoderLoader = () => Promise<QrDecoderClass>;

const loadQrScannerLib: QrDecoderLoader = async () => (await import("qr-scanner")).default;

/** Rear camera on phones; desktop browsers fall back to their default webcam. */
const CAMERA_CONSTRAINTS: MediaStreamConstraints = { video: { facingMode: "environment" }, audio: false };

function releaseStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

export class CameraQrScanner implements QrScanner {
  private readonly media: CameraMedia | undefined;
  private readonly load: QrDecoderLoader;
  /** Bumped by every start and stop; a start that sees a newer value was cancelled. */
  private session = 0;
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private decoder: QrDecoder | null = null;

  constructor(media: CameraMedia | undefined, load: QrDecoderLoader = loadQrScannerLib) {
    this.media = media;
    this.load = load;
  }

  async start(video: HTMLVideoElement, onText: (text: string) => void): Promise<void> {
    this.stop();
    const session = ++this.session;
    if (this.media === undefined) {
      throw new CameraError("noCamera", "CameraQrScanner.start: navigator.mediaDevices is unavailable");
    }

    let stream: MediaStream;
    try {
      stream = await this.media.getUserMedia(CAMERA_CONSTRAINTS);
    } catch (err) {
      throw cameraErrorFrom(err) ?? err;
    }
    if (session !== this.session) {
      releaseStream(stream);
      return;
    }
    this.stream = stream;
    this.video = video;
    video.srcObject = stream;

    const Decoder = await this.load();
    if (session !== this.session) return;
    // qr-scanner reuses a video that already has a srcObject instead of
    // opening its own stream, so it only plays and decodes here.
    const decoder = new Decoder(video, (result) => { onText(result.data); }, {
      returnDetailedScanResult: true,
      preferredCamera: "environment",
    });
    this.decoder = decoder;
    await decoder.start();
  }

  stop(): void {
    this.session++;
    this.decoder?.destroy();
    this.decoder = null;
    if (this.stream !== null) {
      releaseStream(this.stream);
      this.stream = null;
    }
    if (this.video !== null) {
      this.video.srcObject = null;
      this.video = null;
    }
  }
}
