import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// Ticket 38: the long-lived Metered secret must never ship client-side.
// Client bundles are built from src/ only (Vite entry graph); workers/ is
// server code. This guard fails if any src/ file references the secret key
// name, a secretKey= URL, or imports anything from workers/.

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (entry.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("TURN secret key isolation (ticket 38)", () => {
  it("no src/ file references the Metered secret key or secret-key URLs", () => {
    const srcRoot = path.resolve(process.cwd(), "src");
    const offenders: string[] = [];
    for (const file of listTsFiles(srcRoot)) {
      const content = readFileSync(file, "utf8");
      if (content.includes("METERED_SECRET_KEY")) offenders.push(`${file}: METERED_SECRET_KEY`);
      if (content.includes("secretKey=")) offenders.push(`${file}: secretKey=`);
    }
    expect(offenders).toEqual([]);
  });

  it("no src/ file imports from workers/ (server code stays server-side)", () => {
    const srcRoot = path.resolve(process.cwd(), "src");
    const offenders: string[] = [];
    for (const file of listTsFiles(srcRoot)) {
      const content = readFileSync(file, "utf8");
      if (/from\s+"[^"]*workers\//.test(content)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("the secret key name appears only under workers/turn (server) and tests", () => {
    const root = process.cwd();
    const offenders: string[] = [];
    for (const dir of ["src", "e2e", "public"]) {
      const full = path.join(root, dir);
      let files: string[] = [];
      try {
        files = listTsFiles(full);
        if (dir === "public") {
          // public/ ships verbatim — check every file, not just .ts
          files.push(...readdirSync(full).map((f) => path.join(full, f)));
        }
      } catch {
        continue; // directory may not exist
      }
      for (const file of files) {
        let content: string;
        try {
          content = readFileSync(file, "utf8");
        } catch {
          continue;
        }
        if (content.includes("METERED_SECRET_KEY")) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
