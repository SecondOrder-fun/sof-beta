// @vitest-environment node
//
// Doc-link integrity test for docs/02-architecture/paymaster-signer-rotation.md.
// A runbook that quotes file paths, function names, and env vars is only
// useful if those references survive future refactors. This pins them so a
// rename in the codebase fails CI here, prompting a doc update at the same
// time.
//
// Not a content test — wording can drift. Just structural anchors.

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../../../..");
const DOC = resolve(ROOT, "docs/02-architecture/paymaster-signer-rotation.md");

function readText(absPath) {
  return readFileSync(absPath, "utf8");
}

describe("paymaster-signer-rotation runbook", () => {
  const text = readText(DOC);

  it("exists at the expected path", () => {
    expect(existsSync(DOC)).toBe(true);
  });

  it("references files that exist in the repo", () => {
    const referenced = [
      "packages/contracts/src/paymaster/SOFPaymaster.sol",
      "packages/backend/shared/aa/bundler.js",
      "packages/backend/shared/aa/paymasterSigner.js",
      "packages/backend/fastify/routes/localBundlerRoutes.js",
      "scripts/deploy-env.sh",
      "scripts/test-aa-e2e.js",
      "scripts/verify-paymaster-signer.js",
    ];
    for (const path of referenced) {
      const abs = resolve(ROOT, path);
      expect(
        existsSync(abs),
        `runbook references ${path} but the file is missing — either restore it or update the runbook`,
      ).toBe(true);
      // And the runbook actually mentions it.
      expect(text).toContain(path);
    }
  });

  it("contract symbols quoted in the runbook still exist on SOFPaymaster", () => {
    const sol = readText(resolve(ROOT, "packages/contracts/src/paymaster/SOFPaymaster.sol"));
    // Anything quoted with backticks in the rotation procedure must still exist
    // as a function/event/state-var declaration.
    const requiredSymbols = ["setSigner", "withdrawTo", "SignerUpdated", "verifyingSigner", "getHash"];
    for (const sym of requiredSymbols) {
      expect(text).toContain(sym);
      expect(
        sol.includes(sym),
        `runbook quotes "${sym}" but SOFPaymaster.sol no longer declares it`,
      ).toBe(true);
    }
  });

  it("env vars quoted in the runbook are read by the bundler", () => {
    const bundler = readText(resolve(ROOT, "packages/backend/shared/aa/bundler.js"));
    const envVars = [
      "PAYMASTER_VALIDITY_WINDOW_SEC",
      "PAYMASTER_QUOTA_PER_HOUR",
      "PAYMASTER_MAX_CALL_GAS",
      "PAYMASTER_MAX_PRE_VERIFICATION_GAS",
      "BACKEND_WALLET_PRIVATE_KEY",
    ];
    for (const v of envVars) {
      expect(text).toContain(v);
    }
    // bundler.js reads the first four directly. BACKEND_WALLET_PRIVATE_KEY
    // is read in the route layer, but its name is documented in the bundler
    // comments so verify it stays referenced.
    expect(bundler).toContain("PAYMASTER_VALIDITY_WINDOW_SEC");
    expect(bundler).toContain("PAYMASTER_QUOTA_PER_HOUR");
    expect(bundler).toContain("PAYMASTER_MAX_CALL_GAS");
    expect(bundler).toContain("PAYMASTER_MAX_PRE_VERIFICATION_GAS");
  });

  it("verify-paymaster-signer.js exposes the CLI flags the runbook documents", () => {
    const script = readText(resolve(ROOT, "scripts/verify-paymaster-signer.js"));
    for (const flag of ["--rpc", "--paymaster", "--chain-id", "--expect-signer", "--sender"]) {
      expect(text).toContain(flag);
      expect(
        script,
        `verify-paymaster-signer.js no longer parses ${flag}`,
      ).toContain(flag);
    }
  });

  it("deploy-env.sh actually accepts the flags the runbook tells operators to pass", () => {
    const sh = readText(resolve(ROOT, "scripts/deploy-env.sh"));
    expect(sh).toContain("--network");
    expect(sh).toContain("--dry-run");
    // Make sure we did NOT re-introduce a non-existent --keys flag in the doc.
    expect(text).not.toContain("--keys");
  });
});
