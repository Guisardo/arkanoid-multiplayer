import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

// Runs ESLint on a deliberately-violating scratch file and expects the
// seam rules to reject it. Proves the lint machinery catches cross-seam
// imports (ticket 22: verified by a deliberately-violating test case).
function lintFile(relPath: string, source: string): string[] {
  const root = process.cwd();
  const file = path.join(root, relPath);
  try {
    writeFileSync(file, source);
    try {
      execFileSync("npx", ["eslint", relPath, "--no-warn-ignored"], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        shell: process.platform === "win32",
      });
      return [];
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; status?: number };
      return ((e.stdout ?? "") + (e.stderr ?? "")).split("\n");
    }
  } finally {
    rmSync(file, { force: true });
  }
}

function expectLinterError(lines: string[], rulePrefix: string): void {
  const hit = lines.some((l) => l.includes(rulePrefix));
  if (!hit) {
    throw new Error(`expected rule ${rulePrefix} to fire; got:\n${lines.join("\n")}`);
  }
}

describe("seam enforcement (spec §2)", () => {
  it("rejects sim importing render (sim must stay headless)", () => {
    mkdirSync(path.join(process.cwd(), "src/sim"), { recursive: true });
    const lines = lintFile(
      "src/sim/_violation_probe.ts",
      `import { RENDERER_CONFIG } from "render/appShell";\nexport const x = RENDERER_CONFIG;\n`,
    );
    expectLinterError(lines, "import/no-restricted-paths");
  });

  it("rejects sim importing pixi.js", () => {
    const lines = lintFile(
      "src/sim/_violation_probe.ts",
      `import { Application } from "pixi.js";\nexport const y = Application;\n`,
    );
    expectLinterError(lines, "no-restricted-imports");
  });

  it("rejects render importing sim internals", () => {
    mkdirSync(path.join(process.cwd(), "src/render"), { recursive: true });
    const lines = lintFile(
      "src/render/_violation_probe.ts",
      `import { FIELD_W } from "sim/constants";\nexport const z = FIELD_W;\n`,
    );
    expectLinterError(lines, "import/no-restricted-paths");
  });

  it("accepts a clean cross-seam-free module", () => {
    mkdirSync(path.join(process.cwd(), "src/sim"), { recursive: true });
    const lines = lintFile("src/sim/_violation_probe.ts", `export const ok = 1;\n`);
    const errors = lines.filter((l) => l.includes("error"));
    expect(errors).toEqual([]);
  });
});
