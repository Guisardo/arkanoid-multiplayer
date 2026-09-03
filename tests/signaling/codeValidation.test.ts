import { describe, expect, it } from "vitest";
import { ROOM_CODE_REGEX, validateRoomCode } from "signaling/code";

describe("room code validation", () => {
  it("accepts valid codes from the unambiguous charset", () => {
    expect(validateRoomCode("ABCDE")).toBe(true);
    expect(validateRoomCode("XYZ23")).toBe(true);
    expect(validateRoomCode("7KMNP")).toBe(true);
    expect(validateRoomCode("GHJKM")).toBe(true);
    expect(validateRoomCode("23456")).toBe(true);
    expect(validateRoomCode("NPQRS")).toBe(true);
  });

  it("rejects lookalike characters I, L, O, 0, 1", () => {
    expect(validateRoomCode("ABCDe")).toBe(false);
    expect(validateRoomCode("ABCDI")).toBe(false);
    expect(validateRoomCode("ABCDL")).toBe(false);
    expect(validateRoomCode("ABCDO")).toBe(false);
    expect(validateRoomCode("ABCD0")).toBe(false);
    expect(validateRoomCode("ABCD1")).toBe(false);
  });

  it("rejects wrong lengths", () => {
    expect(validateRoomCode("ABCD")).toBe(false);
    expect(validateRoomCode("ABCDEF")).toBe(false);
    expect(validateRoomCode("")).toBe(false);
  });

  it("rejects lowercase and non-alphanumeric", () => {
    expect(validateRoomCode("abcde")).toBe(false);
    expect(validateRoomCode("AB D!")).toBe(false);
    expect(validateRoomCode("A-C_D")).toBe(false);
  });

  it("regex matches full charset exactly", () => {
    expect(ROOM_CODE_REGEX.source).toBe("^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$");
  });
});
