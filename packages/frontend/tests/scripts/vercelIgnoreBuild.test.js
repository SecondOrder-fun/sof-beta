// @vitest-environment node
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";

// Vercel's Ignored Build Step contract: exit 0 SKIPS, exit 1 BUILDS. Getting it
// backwards would silently stop production deploys, so pin it.
const SCRIPT = path.resolve(__dirname, "../../scripts/vercel-ignore-build.sh");
const run = (env) =>
  spawnSync("bash", [SCRIPT], { env: { PATH: process.env.PATH, ...env }, encoding: "utf8" }).status;

const BUILD = 1;
const SKIP = 0;

describe("vercel-ignore-build.sh", () => {
  it("always builds production, marker or not", () => {
    expect(run({ VERCEL_ENV: "production", VERCEL_GIT_COMMIT_MESSAGE: "chore: tidy" })).toBe(BUILD);
  });

  it("builds a preview whose commit message carries [preview]", () => {
    expect(run({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_MESSAGE: "feat(ui): ticker layout [preview]" })).toBe(BUILD);
  });

  it("finds the marker anywhere in a multi-line message", () => {
    expect(run({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_MESSAGE: "feat: x\n\nbody text\n[preview]\n" })).toBe(BUILD);
  });

  it("skips a preview without the marker", () => {
    expect(run({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_MESSAGE: "feat(backend): trade indexer" })).toBe(SKIP);
  });

  it("skips when Vercel supplies no message at all", () => {
    expect(run({ VERCEL_ENV: "preview" })).toBe(SKIP);
  });
});
