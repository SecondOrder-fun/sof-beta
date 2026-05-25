// tests/services/mountStatus.test.js
// @vitest-environment node

import { describe, it, expect, beforeEach } from "vitest";
import {
  recordMount,
  getMountStatus,
  getMountFailures,
  _resetMountStatus,
} from "../../shared/mountStatus.js";

describe("mountStatus registry", () => {
  beforeEach(() => {
    _resetMountStatus();
  });

  it("records a successful mount and reports zero failures", () => {
    recordMount("/api/health", { ok: true });
    expect(getMountFailures()).toEqual([]);

    const all = getMountStatus();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      prefix: "/api/health",
      ok: true,
      critical: false,
    });
    expect(all[0].at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("records a failure with the error message and surfaces it via getMountFailures", () => {
    recordMount("/api/paymaster/sof", {
      ok: false,
      critical: true,
      error: "RPC_URL is required",
    });

    const failures = getMountFailures();
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      prefix: "/api/paymaster/sof",
      critical: true,
      error: "RPC_URL is required",
    });
  });

  it("defaults critical=false when omitted, and supplies a fallback error string when ok=false but no error provided", () => {
    recordMount("/api/admin", { ok: false });
    const f = getMountFailures();
    expect(f[0].critical).toBe(false);
    expect(f[0].error).toBe("Unknown mount error");
  });

  it("re-recording the same prefix overwrites the previous entry (e.g. retry after fix)", () => {
    recordMount("/api/airdrop", { ok: false, error: "boom" });
    expect(getMountFailures()).toHaveLength(1);

    recordMount("/api/airdrop", { ok: true });
    expect(getMountFailures()).toEqual([]);
    expect(getMountStatus()).toHaveLength(1);
  });

  it("distinguishes critical vs non-critical failures in the failure list", () => {
    recordMount("/api/auth", {
      ok: false,
      critical: true,
      error: "JWT_SECRET unset",
    });
    recordMount("/api/admin", { ok: false, error: "diagnostic route bug" });

    const failures = getMountFailures();
    const criticalOnes = failures.filter((f) => f.critical);
    const nonCriticalOnes = failures.filter((f) => !f.critical);

    expect(criticalOnes).toHaveLength(1);
    expect(criticalOnes[0].prefix).toBe("/api/auth");
    expect(nonCriticalOnes).toHaveLength(1);
    expect(nonCriticalOnes[0].prefix).toBe("/api/admin");
  });

  it("getMountStatus preserves insertion order so the boot log matches the response", () => {
    recordMount("/api/health", { ok: true });
    recordMount("/api/auth", { ok: true, critical: true });
    recordMount("/api/admin", { ok: false, error: "x" });

    const all = getMountStatus();
    expect(all.map((s) => s.prefix)).toEqual([
      "/api/health",
      "/api/auth",
      "/api/admin",
    ]);
  });

  it("_resetMountStatus wipes the registry (test hook)", () => {
    recordMount("/x", { ok: false, error: "e" });
    expect(getMountStatus()).toHaveLength(1);
    _resetMountStatus();
    expect(getMountStatus()).toEqual([]);
    expect(getMountFailures()).toEqual([]);
  });
});
