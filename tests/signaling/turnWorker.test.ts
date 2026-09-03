import { describe, expect, it } from "vitest";
import {
  CREDENTIAL_TTL_SECONDS,
  issueTurnCredentials,
  meteredCredentialUrl,
  meteredIceServersUrl,
  originAllowed,
  parseCredentialResponse,
  parseIceServersResponse,
  type FetchLike,
  type RequestInit_Like,
  type ResponseLike,
} from "../../workers/turn/src/credentialLogic";

function jsonResponse(body: unknown, status = 200): ResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  };
}

const VALID_CREDENTIAL = {
  username: "5e7dbfbe19c6c158515907a6",
  password: "wQX5Ze0EExayWJk9",
  apiKey: "56c193debb416385ade8d9a77e277ea33c0f",
};

const VALID_ICE_SERVERS = [
  { urls: "turn:standard.relay.metered.ca:80", username: "u", credential: "p" },
  { urls: "turn:standard.relay.metered.ca:80?transport=tcp", username: "u", credential: "p" },
];

interface RecordedCall {
  input: string;
  init?: RequestInit_Like;
}

function fakeFetch(
  responses: Array<{ match: (input: string) => boolean; respond: (call: RecordedCall) => ResponseLike }>,
): { fetchLike: FetchLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchLike: FetchLike = (input, init) => {
    const call: RecordedCall = init === undefined ? { input } : { input, init };
    calls.push(call);
    for (const entry of responses) {
      if (entry.match(input)) return Promise.resolve(entry.respond(call));
    }
    return Promise.resolve(jsonResponse({ error: "unexpected url" }, 500));
  };
  return { fetchLike, calls };
}

describe("origin allowlist", () => {
  it("allows listed origins", () => {
    expect(originAllowed("https://arkanoid-multiplayer.pages.dev", "http://localhost:5173,https://arkanoid-multiplayer.pages.dev")).toBe(true);
    expect(originAllowed("http://localhost:5173", "http://localhost:5173")).toBe(true);
  });

  it("rejects unlisted and null origins", () => {
    expect(originAllowed("https://evil.example", "http://localhost:5173")).toBe(false);
    expect(originAllowed(null, "http://localhost:5173")).toBe(false);
    expect(originAllowed("", "http://localhost:5173")).toBe(false);
  });

  it("tolerates whitespace in the allowlist", () => {
    expect(originAllowed("https://a.example", " https://a.example , https://b.example ")).toBe(true);
  });
});

describe("metered url building", () => {
  it("puts the secret key in the credential url (server-side only)", () => {
    expect(meteredCredentialUrl("demo.metered.live", "SECRET/KEY")).toBe(
      "https://demo.metered.live/api/v1/turn/credential?secretKey=SECRET%2FKEY",
    );
  });

  it("puts the credential-scoped api key in the ice servers url", () => {
    expect(meteredIceServersUrl("demo.metered.live", "abc123")).toBe(
      "https://demo.metered.live/api/v1/turn/credentials?apiKey=abc123",
    );
  });
});

describe("credential response parsing", () => {
  it("parses a valid credential", () => {
    expect(parseCredentialResponse(VALID_CREDENTIAL)).toEqual({
      username: "5e7dbfbe19c6c158515907a6",
      password: "wQX5Ze0EExayWJk9",
      apiKey: "56c193debb416385ade8d9a77e277ea33c0f",
    });
  });

  it("rejects malformed payloads", () => {
    expect(parseCredentialResponse(null)).toBeNull();
    expect(parseCredentialResponse("nope")).toBeNull();
    expect(parseCredentialResponse({})).toBeNull();
    expect(parseCredentialResponse({ username: "", password: "p", apiKey: "k" })).toBeNull();
    expect(parseCredentialResponse({ username: "u", password: 42, apiKey: "k" })).toBeNull();
    expect(parseCredentialResponse({ username: "u", password: "p" })).toBeNull();
  });
});

describe("ice servers response parsing", () => {
  it("parses valid ice servers with optional auth fields", () => {
    expect(parseIceServersResponse(VALID_ICE_SERVERS)).toEqual(VALID_ICE_SERVERS);
    expect(parseIceServersResponse([{ urls: "turn:x:80" }])).toEqual([{ urls: "turn:x:80" }]);
  });

  it("rejects non-array or malformed entries", () => {
    expect(parseIceServersResponse(null)).toBeNull();
    expect(parseIceServersResponse({})).toBeNull();
    expect(parseIceServersResponse([{ username: "u" }])).toBeNull();
    expect(parseIceServersResponse([{ urls: "" }])).toBeNull();
    expect(parseIceServersResponse([{ urls: 3 }])).toBeNull();
    expect(parseIceServersResponse([{ urls: "turn:x:80" }, "bad"])).toBeNull();
  });
});

describe("issueTurnCredentials flow", () => {
  it("mints a ~1h credential then resolves ice servers, secret never in output", async () => {
    const { fetchLike, calls } = fakeFetch([
      {
        match: (input) => input.includes("/api/v1/turn/credential?"),
        respond: (call) => {
          expect(call.init?.method).toBe("POST");
          const body = JSON.parse(call.init?.body ?? "{}") as { expiryInSeconds?: number; label?: string };
          expect(body.expiryInSeconds).toBe(CREDENTIAL_TTL_SECONDS);
          expect(body.label).toBe("test-label");
          return jsonResponse(VALID_CREDENTIAL);
        },
      },
      {
        match: (input) => input.includes("/api/v1/turn/credentials?"),
        respond: (call) => {
          expect(call.init?.method).toBe("GET");
          expect(call.input).toContain(`apiKey=${VALID_CREDENTIAL.apiKey}`);
          return jsonResponse(VALID_ICE_SERVERS);
        },
      },
    ]);
    const result = await issueTurnCredentials("demo.metered.live", "SECRET", "test-label", fetchLike);
    expect(result.status).toBe(200);
    const body = JSON.parse(result.body) as {
      iceServers: typeof VALID_ICE_SERVERS;
      username: string;
      password: string;
      ttlSeconds: number;
    };
    expect(body.iceServers).toEqual(VALID_ICE_SERVERS);
    expect(body.username).toBe(VALID_CREDENTIAL.username);
    expect(body.password).toBe(VALID_CREDENTIAL.password);
    expect(body.ttlSeconds).toBe(CREDENTIAL_TTL_SECONDS);
    // The long-lived secret must never appear in the client-facing response.
    expect(result.body).not.toContain("SECRET");
    expect(calls).toHaveLength(2);
  });

  it("honors a custom ttl", async () => {
    const { fetchLike } = fakeFetch([
      {
        match: (input) => input.includes("/api/v1/turn/credential?"),
        respond: (call) => {
          const body = JSON.parse(call.init?.body ?? "{}") as { expiryInSeconds?: number };
          expect(body.expiryInSeconds).toBe(7200);
          return jsonResponse(VALID_CREDENTIAL);
        },
      },
      { match: (input) => input.includes("/api/v1/turn/credentials?"), respond: () => jsonResponse(VALID_ICE_SERVERS) },
    ]);
    const result = await issueTurnCredentials("demo.metered.live", "SECRET", "l", fetchLike, 7200);
    expect(result.status).toBe(200);
  });

  it("returns 502 when the mint call fails", async () => {
    const { fetchLike } = fakeFetch([
      { match: (input) => input.includes("/api/v1/turn/credential?"), respond: () => jsonResponse({ error: "quota" }, 429) },
    ]);
    const result = await issueTurnCredentials("demo.metered.live", "SECRET", "l", fetchLike);
    expect(result.status).toBe(502);
    expect(JSON.parse(result.body) as { error: string }).toEqual({ error: "credential mint failed" });
  });

  it("returns 502 when the mint response is malformed", async () => {
    const { fetchLike } = fakeFetch([
      { match: (input) => input.includes("/api/v1/turn/credential?"), respond: () => jsonResponse({ nope: true }) },
    ]);
    const result = await issueTurnCredentials("demo.metered.live", "SECRET", "l", fetchLike);
    expect(result.status).toBe(502);
    expect(JSON.parse(result.body) as { error: string }).toEqual({ error: "malformed credential response" });
  });

  it("returns 502 when the ice servers fetch fails", async () => {
    const { fetchLike } = fakeFetch([
      { match: (input) => input.includes("/api/v1/turn/credential?"), respond: () => jsonResponse(VALID_CREDENTIAL) },
      { match: (input) => input.includes("/api/v1/turn/credentials?"), respond: () => jsonResponse({}, 500) },
    ]);
    const result = await issueTurnCredentials("demo.metered.live", "SECRET", "l", fetchLike);
    expect(result.status).toBe(502);
    expect(JSON.parse(result.body) as { error: string }).toEqual({ error: "ice servers fetch failed" });
  });

  it("returns 502 when the ice servers payload is malformed", async () => {
    const { fetchLike } = fakeFetch([
      { match: (input) => input.includes("/api/v1/turn/credential?"), respond: () => jsonResponse(VALID_CREDENTIAL) },
      { match: (input) => input.includes("/api/v1/turn/credentials?"), respond: () => jsonResponse({ not: "array" }) },
    ]);
    const result = await issueTurnCredentials("demo.metered.live", "SECRET", "l", fetchLike);
    expect(result.status).toBe(502);
    expect(JSON.parse(result.body) as { error: string }).toEqual({ error: "malformed ice servers response" });
  });

  it("returns 502 when the mint response body is not JSON", async () => {
    const fetchLike: FetchLike = () =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.reject(new Error("invalid json")),
      });
    const result = await issueTurnCredentials("demo.metered.live", "SECRET", "l", fetchLike);
    expect(result.status).toBe(502);
    expect(JSON.parse(result.body) as { error: string }).toEqual({ error: "malformed credential response" });
  });

  it("returns 502 when the ice servers body is not JSON", async () => {
    const fetchLike: FetchLike = (input) => {
      if (input.includes("/api/v1/turn/credential?")) return Promise.resolve(jsonResponse(VALID_CREDENTIAL));
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.reject(new Error("invalid json")),
      });
    };
    const result = await issueTurnCredentials("demo.metered.live", "SECRET", "l", fetchLike);
    expect(result.status).toBe(502);
    expect(JSON.parse(result.body) as { error: string }).toEqual({ error: "malformed ice servers response" });
  });

  it("propagates fetch rejection as a mint failure (caller maps to degradation)", async () => {
    const fetchLike: FetchLike = () => Promise.reject(new Error("network down"));
    const result = await issueTurnCredentials("demo.metered.live", "SECRET", "l", fetchLike);
    expect(result.status).toBe(502);
  });
});
