// Capsule script + level validation rules (ticket 113). Two halves:
// the rules themselves (pure functions, exhaustive valid/invalid cases) and
// the fail-fast guarantee that they actually run at level load time.
import { describe, expect, it } from "vitest";
import {
  CAPSULE_SCRIPT_MAX,
  CAPSULE_SCRIPT_MIN,
  CAPSULE_TYPES,
  assertValidLevel,
  countDestructibleChars,
  validateCapsuleScript,
  validateLevel,
  type CapsuleScriptEntry,
  type LevelData,
} from "content/levelFormat";
import { availableRounds, getLevel } from "content/levels";
import type { CapsuleTypeId } from "shared/protocol";

function scriptOf(count: number, type: CapsuleTypeId = "E"): CapsuleScriptEntry[] {
  return Array.from({ length: count }, (_, i) => ({ brickBreakCount: i + 1, capsule: type }));
}

/** A level that satisfies every rule; each test breaks exactly one of them. */
function validLevel(): LevelData {
  const grid: string[] = [];
  for (let r = 0; r < 18; r++) grid.push(r < 4 ? "OOOOOOOOOOOOO" : ".............");
  return {
    version: 1,
    round: 1,
    grid,
    baseBallSpeed: 110,
    silverHitOverride: null,
    capsuleScript: scriptOf(CAPSULE_SCRIPT_MIN),
    scoreOverrides: {},
  };
}

describe("validateCapsuleScript — length", () => {
  it(`accepts exactly ${String(CAPSULE_SCRIPT_MIN)} and ${String(CAPSULE_SCRIPT_MAX)} entries`, () => {
    expect(validateCapsuleScript(scriptOf(CAPSULE_SCRIPT_MIN), 100)).toEqual([]);
    expect(validateCapsuleScript(scriptOf(CAPSULE_SCRIPT_MAX), 100)).toEqual([]);
  });

  it("rejects a script that is too short to pay out", () => {
    const errors = validateCapsuleScript(scriptOf(CAPSULE_SCRIPT_MIN - 1), 100);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain(`${String(CAPSULE_SCRIPT_MIN)}–${String(CAPSULE_SCRIPT_MAX)} entries`);
  });

  it("rejects a script longer than a round's worth of drops", () => {
    const errors = validateCapsuleScript(scriptOf(CAPSULE_SCRIPT_MAX + 1), 100);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain("entries");
  });

  it("rejects a missing script with a clear message instead of a crash", () => {
    expect(validateCapsuleScript(null, 100)[0]?.message).toContain("must be an array");
    expect(validateCapsuleScript(undefined, 100)[0]?.message).toContain("must be an array");
  });
});

describe("validateCapsuleScript — strictly increasing break counts", () => {
  it("accepts a strictly increasing sequence", () => {
    const script: CapsuleScriptEntry[] = [
      { brickBreakCount: 1, capsule: "E" },
      { brickBreakCount: 5, capsule: "P" },
      { brickBreakCount: 9, capsule: "L" },
      { brickBreakCount: 10, capsule: "S" },
      { brickBreakCount: 20, capsule: "M" },
      { brickBreakCount: 21, capsule: "C" },
    ];
    expect(validateCapsuleScript(script, 100)).toEqual([]);
  });

  it("rejects a repeated break count (the second entry could never fire)", () => {
    const script = scriptOf(CAPSULE_SCRIPT_MIN);
    script[3] = { brickBreakCount: 3, capsule: "E" };
    const errors = validateCapsuleScript(script, 100);
    expect(errors.some((e) => e.message.includes("strictly increasing"))).toBe(true);
  });

  it("rejects a descending break count", () => {
    const script = scriptOf(CAPSULE_SCRIPT_MIN);
    script[2] = { brickBreakCount: 1, capsule: "E" };
    expect(validateCapsuleScript(script, 100).some((e) => e.message.includes("strictly increasing"))).toBe(true);
  });

  it("rejects a zero or negative break count", () => {
    const script = scriptOf(CAPSULE_SCRIPT_MIN);
    script[0] = { brickBreakCount: 0, capsule: "E" };
    expect(validateCapsuleScript(script, 100).some((e) => e.message.includes("strictly increasing"))).toBe(true);
  });

  it("rejects a non-numeric break count", () => {
    const script: unknown[] = scriptOf(CAPSULE_SCRIPT_MIN);
    script[1] = { brickBreakCount: Number.NaN, capsule: "E" };
    expect(
      validateCapsuleScript(script as CapsuleScriptEntry[], 100).some((e) =>
        e.message.includes("whole number"),
      ),
    ).toBe(true);
  });

  it("rejects a fractional break count — no brick break lands between", () => {
    const script = scriptOf(CAPSULE_SCRIPT_MIN);
    script[1] = { brickBreakCount: 1.5, capsule: "E" };
    expect(validateCapsuleScript(script, 100).some((e) => e.message.includes("whole number"))).toBe(true);
  });

  it("a corrupt early entry does not mask violations after it", () => {
    // A NaN watermark would make every later `count <= prev` comparison false,
    // hiding the rest of the script's ordering bugs behind one error.
    const script: unknown[] = scriptOf(CAPSULE_SCRIPT_MIN);
    script[1] = { brickBreakCount: Number.NaN, capsule: "E" };
    script[4] = { brickBreakCount: 1, capsule: "E" };
    const errors = validateCapsuleScript(script as CapsuleScriptEntry[], 100);
    // index 1 is the NaN; index 4 is out of order against the last *good* count.
    expect(errors.filter((e) => e.message.includes("capsuleScript[1]"))).toHaveLength(1);
    expect(errors.filter((e) => e.message.includes("capsuleScript[4]"))).toHaveLength(1);
    // …and nothing after the corruption goes unreported.
    expect(errors.filter((e) => e.message.includes("capsuleScript[5]"))).toHaveLength(0);
  });
});

describe("validateCapsuleScript — capsule types", () => {
  it(`accepts every declared type: ${CAPSULE_TYPES.join(" ")}`, () => {
    for (const type of CAPSULE_TYPES) {
      expect(validateCapsuleScript(scriptOf(CAPSULE_SCRIPT_MIN, type), 100), type).toEqual([]);
    }
  });

  it("accepts the mystery `?` — it resolves at drop time", () => {
    expect(validateCapsuleScript(scriptOf(CAPSULE_SCRIPT_MIN, "?"), 100)).toEqual([]);
  });

  it("rejects an unknown type by name", () => {
    const script = scriptOf(CAPSULE_SCRIPT_MIN);
    script[1] = { brickBreakCount: 2, capsule: "Z" as CapsuleTypeId };
    const errors = validateCapsuleScript(script, 100);
    expect(errors.some((e) => e.message.includes("invalid capsule type 'Z'"))).toBe(true);
  });
});

describe("validateCapsuleScript — reachability", () => {
  it("rejects a trigger past the round's destructible brick count", () => {
    const errors = validateCapsuleScript(scriptOf(CAPSULE_SCRIPT_MIN), 3);
    expect(errors).toHaveLength(3); // entries 4..6 at counts 4, 5, 6
    expect(errors[0]?.message).toContain("exceeds destructible brick count 3");
  });

  it("skips the reachability check when the grid is unknown (-1)", () => {
    expect(validateCapsuleScript(scriptOf(CAPSULE_SCRIPT_MIN), -1)).toEqual([]);
  });
});

describe("countDestructibleChars", () => {
  it("counts every cell that is neither empty nor gold", () => {
    expect(countDestructibleChars(["GG", "S.", "AB"])).toBe(3);
  });

  it("is zero for an empty grid", () => {
    expect(countDestructibleChars(["...", "..."])).toBe(0);
  });
});

describe("validateLevel", () => {
  it("accepts the reference level", () => {
    expect(validateLevel(validLevel())).toEqual([]);
  });

  it("reports the wrong row count and stops there", () => {
    const level = { ...validLevel(), grid: ["AAAAAAAAAAAAA"] };
    expect(validateLevel(level)[0]?.message).toContain("exactly 18 rows");
  });

  it("reports the wrong column count", () => {
    const grid = Array.from({ length: 18 }, () => "AAA");
    expect(validateLevel({ ...validLevel(), grid }).some((e) => e.message.includes("exactly 13 cols"))).toBe(true);
  });

  it("reports an illegal grid character", () => {
    const grid = Array.from({ length: 18 }, () => "AAAAAAAAAA*AA");
    expect(validateLevel({ ...validLevel(), grid }).some((e) => e.message.includes("invalid char"))).toBe(true);
  });

  it("reports a non-positive base speed", () => {
    expect(validateLevel({ ...validLevel(), baseBallSpeed: 0 }).some((e) => e.message.includes("baseBallSpeed"))).toBe(true);
  });

  it("surfaces capsule-script errors alongside the grid checks", () => {
    const level = { ...validLevel(), capsuleScript: scriptOf(3) };
    expect(validateLevel(level).some((e) => e.path === "capsuleScript")).toBe(true);
  });
});

describe("assertValidLevel — fail fast at level load (ticket 113)", () => {
  it("passes silently on valid data", () => {
    expect(() => { assertValidLevel(validLevel()); }).not.toThrow();
  });

  it("names the round and the rule it broke", () => {
    const level = { ...validLevel(), round: 17, capsuleScript: scriptOf(3) };
    expect(() => { assertValidLevel(level); }).toThrow(/round 17.*capsuleScript.*entries/);
  });

  it("reports every violation at once, not one per reload", () => {
    const level = { ...validLevel(), capsuleScript: scriptOf(3), baseBallSpeed: -1 };
    let message = "";
    try {
      assertValidLevel(level);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("baseBallSpeed");
    expect(message).toContain("capsuleScript");
  });
});

describe("every shipped round validates (ticket 113)", () => {
  it("all 33 rounds pass validation with zero errors", async () => {
    expect(availableRounds()).toHaveLength(33);
    for (const round of availableRounds()) {
      const errors = validateLevel(await getLevel(round));
      expect(errors, `round ${String(round)}: ${JSON.stringify(errors)}`).toEqual([]);
    }
  });

  it("loading any round never throws — validation is satisfied by the data", async () => {
    for (const round of availableRounds()) {
      await expect(getLevel(round), `round ${String(round)}`).resolves.toMatchObject({ round });
    }
  });

  it("each round's script stays inside the declared bounds", async () => {
    for (const round of availableRounds()) {
      const level = await getLevel(round);
      expect(level.capsuleScript.length, `round ${String(round)}`).toBeGreaterThanOrEqual(CAPSULE_SCRIPT_MIN);
      expect(level.capsuleScript.length, `round ${String(round)}`).toBeLessThanOrEqual(CAPSULE_SCRIPT_MAX);
      for (const entry of level.capsuleScript) {
        expect(CAPSULE_TYPES, `round ${String(round)}`).toContain(entry.capsule);
      }
    }
  });
});
