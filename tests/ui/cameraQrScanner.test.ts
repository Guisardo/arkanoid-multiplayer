// Camera QR scanner adapter (#159): owns the camera stream (rear camera,
// classified failures), hands the live video to the lazily loaded decoder,
// and releases the camera on stop — even when stop races a pending start.
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { CameraQrScanner, type QrDecoderClass } from "ui/cameraQrScanner";
import { CameraError, type CameraMedia } from "ui/qrScan";

interface FakeTrack {
  stop: ReturnType<typeof vi.fn>;
}

function fakeStream(): { stream: MediaStream; tracks: FakeTrack[] } {
  const tracks: FakeTrack[] = [{ stop: vi.fn() }, { stop: vi.fn() }];
  return { stream: { getTracks: () => tracks } as unknown as MediaStream, tracks };
}

/** Decoder double: records the instance so a test can emit decodes. */
function fakeDecoder(): {
  Decoder: QrDecoderClass;
  instances: Array<{ video: HTMLVideoElement; emit: (data: string) => void; start: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }>;
} {
  const instances: Array<{ video: HTMLVideoElement; emit: (data: string) => void; start: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }> = [];
  class Decoder {
    start = vi.fn(() => Promise.resolve());
    destroy = vi.fn();
    constructor(video: HTMLVideoElement, onDecode: (r: { data: string }) => void) {
      instances.push({ video, emit: (data) => { onDecode({ data }); }, start: this.start, destroy: this.destroy });
    }
  }
  return { Decoder, instances };
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function mediaWith(getUserMedia: CameraMedia["getUserMedia"]): CameraMedia {
  return { getUserMedia, enumerateDevices: () => Promise.resolve([]) };
}

describe("CameraQrScanner", () => {
  it("opens the rear camera, feeds the video to the decoder and forwards decoded text", async () => {
    const { stream } = fakeStream();
    const gum = vi.fn(() => Promise.resolve(stream));
    const { Decoder, instances } = fakeDecoder();
    const scanner = new CameraQrScanner(mediaWith(gum), () => Promise.resolve(Decoder));
    const video = document.createElement("video");
    const texts: string[] = [];

    await scanner.start(video, (t) => texts.push(t));

    expect(gum).toHaveBeenCalledWith({ video: { facingMode: "environment" }, audio: false });
    expect(video.srcObject).toBe(stream);
    expect(instances).toHaveLength(1);
    expect(instances[0]!.video).toBe(video);
    expect(instances[0]!.start).toHaveBeenCalledTimes(1);
    instances[0]!.emit("https://example.com/?code=ABC23");
    expect(texts).toEqual(["https://example.com/?code=ABC23"]);
  });

  it("stop releases every camera track, detaches the video and destroys the decoder", async () => {
    const { stream, tracks } = fakeStream();
    const { Decoder, instances } = fakeDecoder();
    const scanner = new CameraQrScanner(mediaWith(() => Promise.resolve(stream)), () => Promise.resolve(Decoder));
    const video = document.createElement("video");
    await scanner.start(video, () => {});

    scanner.stop();

    for (const track of tracks) expect(track.stop).toHaveBeenCalledTimes(1);
    expect(video.srcObject).toBeNull();
    expect(instances[0]!.destroy).toHaveBeenCalledTimes(1);
    // Idempotent: a second stop is a no-op.
    scanner.stop();
    for (const track of tracks) expect(track.stop).toHaveBeenCalledTimes(1);
  });

  it("a denied camera rejects with a classified CameraError and never loads the decoder", async () => {
    const load = vi.fn();
    const scanner = new CameraQrScanner(
      mediaWith(() => Promise.reject(new DOMException("no", "NotAllowedError"))),
      load,
    );
    const err = await scanner.start(document.createElement("video"), () => {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CameraError);
    expect((err as CameraError).kind).toBe("denied");
    expect(load).not.toHaveBeenCalled();
  });

  it("an unclassified camera failure rejects with the original error", async () => {
    const boom = new Error("driver exploded");
    const scanner = new CameraQrScanner(mediaWith(() => Promise.reject(boom)), vi.fn());
    await expect(scanner.start(document.createElement("video"), () => {})).rejects.toBe(boom);
  });

  it("no media devices at all (insecure context) rejects as noCamera", async () => {
    const scanner = new CameraQrScanner(undefined, vi.fn());
    await expect(scanner.start(document.createElement("video"), () => {})).rejects.toMatchObject({
      name: "CameraError",
      kind: "noCamera",
    });
  });

  it("stop while the camera prompt is pending releases the stream as soon as it arrives", async () => {
    const { stream, tracks } = fakeStream();
    const pending = deferred<MediaStream>();
    const load = vi.fn();
    const scanner = new CameraQrScanner(mediaWith(() => pending.promise), load);
    const video = document.createElement("video");
    const started = scanner.start(video, () => {});

    scanner.stop();
    pending.resolve(stream);
    await started;

    for (const track of tracks) expect(track.stop).toHaveBeenCalledTimes(1);
    expect(video.srcObject ?? null).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it("stop while the decoder is loading never starts the decoder", async () => {
    const { stream, tracks } = fakeStream();
    const { Decoder, instances } = fakeDecoder();
    const loading = deferred<QrDecoderClass>();
    const scanner = new CameraQrScanner(mediaWith(() => Promise.resolve(stream)), () => loading.promise);
    const started = scanner.start(document.createElement("video"), () => {});
    // Let getUserMedia settle so the stream is live and the load is pending.
    await new Promise((r) => globalThis.setTimeout(r, 0));

    scanner.stop();
    loading.resolve(Decoder);
    await started;

    expect(instances).toHaveLength(0);
    for (const track of tracks) expect(track.stop).toHaveBeenCalledTimes(1);
  });
});
