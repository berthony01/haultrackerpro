// Phase 1R-D2-B4-R3 — PGlite full-suite reliability contract.
//
// Static proof that the active Vitest config serializes test files (so
// concurrent in-process PGlite/Postgres-WASM startups cannot contend), and
// that this stabilization was achieved WITHOUT inflating timeouts, adding
// retries, or altering worker pools / package.json.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = process.cwd();

function readRepoFile(relative: string): string {
  return fs.readFileSync(path.join(ROOT, relative), "utf8");
}

const VITEST_CONFIG = readRepoFile("vitest.config.ts");
const PACKAGE_JSON_RAW = readRepoFile("package.json");

describe("Phase 1R-D2-B4-R3 — active Vitest config reliability contract", () => {
  it("vitest.config.ts imports defineConfig from vitest/config", () => {
    expect(VITEST_CONFIG).toMatch(
      /import\s*\{\s*defineConfig\s*\}\s*from\s*["']vitest\/config["']/,
    );
  });

  it("declares fileParallelism: false inside the test block", () => {
    expect(VITEST_CONFIG).toMatch(/fileParallelism\s*:\s*false/);

    const testBlockStart = VITEST_CONFIG.indexOf("test:");
    expect(testBlockStart).toBeGreaterThan(-1);
    const fileParallelismIndex = VITEST_CONFIG.search(/fileParallelism\s*:\s*false/);
    expect(fileParallelismIndex).toBeGreaterThan(testBlockStart);
  });

  it("does not inflate timeouts, add retries, or pin worker counts", () => {
    for (const forbidden of [
      "hookTimeout",
      "testTimeout",
      "teardownTimeout",
      "retry",
      "maxWorkers",
      "minWorkers",
    ]) {
      expect(
        VITEST_CONFIG.includes(forbidden),
        `vitest.config.ts must not contain ${forbidden}`,
      ).toBe(false);
    }
  });

  it("package.json test script and vitest devDependency are unchanged", () => {
    const pkg = JSON.parse(PACKAGE_JSON_RAW) as {
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(pkg.scripts?.test).toBe("vitest run");
    expect(pkg.devDependencies?.vitest).toBeTruthy();
  });
});
