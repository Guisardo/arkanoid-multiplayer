import { describe, expect, it } from "vitest";
import { decodeSignal, encodeSignal } from "signaling/copyPaste";

const sampleOffer: RTCSessionDescriptionInit = {
  type: "offer",
  sdp: "v=0\r\no=- 123456 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\na=ice-ufrag:abcd\r\na=ice-pwd:efgh\r\na=fingerprint:sha-256 00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 0.0.0.0\r\na=ice-option:trickle\r\n",
};

describe("copy-paste signal encoding", () => {
  it("round-trips type and sdp through gzip path", async () => {
    const encoded = await encodeSignal(sampleOffer);
    expect(encoded.startsWith("G1:")).toBe(true);
    const decoded = await decodeSignal(encoded);
    expect(decoded.type).toBe(sampleOffer.type);
    expect(decoded.sdp).toBe(sampleOffer.sdp);
  });

  it("round-trips answer type", async () => {
    const answer: RTCSessionDescriptionInit = { type: "answer", sdp: "v=0\r\no=- 789 2 IN IP4 127.0.0.1\r\n" };
    const encoded = await encodeSignal(answer);
    const decoded = await decodeSignal(encoded);
    expect(decoded.type).toBe("answer");
    expect(decoded.sdp).toBe(answer.sdp);
  });

  it("decode strips whitespace and newlines from pasted text", async () => {
    const encoded = await encodeSignal(sampleOffer);
    const mangled = encoded.slice(0, 3) + "\n" + encoded.slice(3, 20) + "  " + encoded.slice(20);
    const decoded = await decodeSignal(mangled);
    expect(decoded.type).toBe(sampleOffer.type);
    expect(decoded.sdp).toBe(sampleOffer.sdp);
  });

  it("falls back to R1: raw base64 when CompressionStream unavailable", async () => {
    const globalScope = globalThis as unknown as Record<string, unknown>;
    const saved = globalScope.CompressionStream;
    delete globalScope.CompressionStream;
    try {
      const encoded = await encodeSignal(sampleOffer);
      expect(encoded.startsWith("R1:")).toBe(true);
      const decoded = await decodeSignal(encoded);
      expect(decoded.type).toBe(sampleOffer.type);
      expect(decoded.sdp).toBe(sampleOffer.sdp);
    } finally {
      globalScope.CompressionStream = saved;
    }
  });

  it("rejects unrecognized input with error", async () => {
    await expect(decodeSignal("garbage")).rejects.toThrow("unrecognized signal format");
  });
});
