// QR scan helpers (#159): what a scanned QR may carry (Room link from any
// host, or a bare room code), camera detection by capability, and camera
// error classification.
import { describe, expect, it } from "vitest";
import { CameraError, cameraErrorFrom, detectCamera, roomCodeFromScan, type CameraMedia } from "ui/qrScan";

function media(devices: Array<{ kind: string }>): CameraMedia {
  return {
    getUserMedia: () => Promise.reject(new Error("unused")),
    enumerateDevices: () => Promise.resolve(devices as MediaDeviceInfo[]),
  };
}

describe("detectCamera", () => {
  it("true when getUserMedia exists and a videoinput is listed", async () => {
    await expect(detectCamera(media([{ kind: "audioinput" }, { kind: "videoinput" }]))).resolves.toBe(true);
  });

  it("false with no videoinput", async () => {
    await expect(detectCamera(media([{ kind: "audioinput" }]))).resolves.toBe(false);
  });

  it("false without mediaDevices (insecure context) or without getUserMedia", async () => {
    await expect(detectCamera(undefined)).resolves.toBe(false);
    const noGum = { enumerateDevices: media([{ kind: "videoinput" }]).enumerateDevices } as unknown as CameraMedia;
    await expect(detectCamera(noGum)).resolves.toBe(false);
  });
});

describe("cameraErrorFrom", () => {
  const dom = (name: string): DOMException => new DOMException("x", name);

  it("maps getUserMedia DOMException names to a failure kind", () => {
    expect(cameraErrorFrom(dom("NotAllowedError"))?.kind).toBe("denied");
    expect(cameraErrorFrom(dom("SecurityError"))?.kind).toBe("denied");
    expect(cameraErrorFrom(dom("NotFoundError"))?.kind).toBe("noCamera");
    expect(cameraErrorFrom(dom("OverconstrainedError"))?.kind).toBe("noCamera");
    expect(cameraErrorFrom(dom("NotReadableError"))?.kind).toBe("busy");
    expect(cameraErrorFrom(dom("AbortError"))?.kind).toBe("busy");
  });

  it("keeps the original error as cause and names it in the message", () => {
    const original = dom("NotAllowedError");
    const err = cameraErrorFrom(original);
    expect(err).toBeInstanceOf(CameraError);
    expect(err?.cause).toBe(original);
    expect(err?.message).toMatch(/NotAllowedError/);
  });

  it("an unrecognised failure stays unclassified (null) for the caller to surface", () => {
    expect(cameraErrorFrom(dom("TypeError"))).toBeNull();
    expect(cameraErrorFrom(new Error("boom"))).toBeNull();
  });
});

describe("roomCodeFromScan", () => {
  it("reads the code from a Room link on any host", () => {
    expect(roomCodeFromScan("https://guisardo.github.io/arkanoid-multiplayer/?code=ABC23")).toBe("ABC23");
    expect(roomCodeFromScan("http://localhost:5173/?code=XYZ45")).toBe("XYZ45");
    expect(roomCodeFromScan("https://other.example/play?lang=es&code=HJK78")).toBe("HJK78");
  });

  it("accepts a bare room code", () => {
    expect(roomCodeFromScan("ABC23")).toBe("ABC23");
  });

  it("rejects lowercase, junk, lookalikes and too-long payloads", () => {
    expect(roomCodeFromScan("abc23")).toBeNull();
    expect(roomCodeFromScan("hello world")).toBeNull();
    expect(roomCodeFromScan("")).toBeNull();
    expect(roomCodeFromScan("AB0IL")).toBeNull();
    expect(roomCodeFromScan("ABC234")).toBeNull();
    expect(roomCodeFromScan("https://example.com/?code=ABC234")).toBeNull();
    expect(roomCodeFromScan("https://example.com/?code=abc23")).toBeNull();
    expect(roomCodeFromScan("https://example.com/")).toBeNull();
    // A Room link is a URL: free text that merely contains "code=" is not.
    expect(roomCodeFromScan("foo &code=ABC23")).toBeNull();
  });
});
