const GZIP_PREFIX = "G1:";
const RAW_PREFIX = "R1:";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function gzipCompress(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new CompressionStream("gzip");
  const writer = stream.writable.getWriter();
  void writer.write(data);
  void writer.close();
  return drainReader(stream.readable.getReader());
}

async function gzipDecompress(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new DecompressionStream("gzip");
  const writer = stream.writable.getWriter();
  void writer.write(data);
  void writer.close();
  return drainReader(stream.readable.getReader());
}

async function drainReader(
  reader: ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>>,
): Promise<Uint8Array<ArrayBuffer>> {
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function hasCompressionStream(): boolean {
  return typeof CompressionStream !== "undefined";
}

export async function encodeSignal(description: RTCSessionDescriptionInit): Promise<string> {
  const json = JSON.stringify(description);
  const textBytes = new TextEncoder().encode(json);
  if (hasCompressionStream()) {
    const gz = await gzipCompress(textBytes);
    return GZIP_PREFIX + bytesToBase64(gz);
  }
  return RAW_PREFIX + bytesToBase64(textBytes);
}

export async function decodeSignal(code: string): Promise<RTCSessionDescriptionInit> {
  const stripped = code.replace(/\s+/g, "");
  if (stripped.startsWith(GZIP_PREFIX)) {
    const bytes = base64ToBytes(stripped.slice(GZIP_PREFIX.length));
    const plain = await gzipDecompress(bytes);
    const json = new TextDecoder().decode(plain);
    return JSON.parse(json) as RTCSessionDescriptionInit;
  }
  if (stripped.startsWith(RAW_PREFIX)) {
    const bytes = base64ToBytes(stripped.slice(RAW_PREFIX.length));
    const json = new TextDecoder().decode(bytes);
    return JSON.parse(json) as RTCSessionDescriptionInit;
  }
  throw new Error("unrecognized signal format");
}
