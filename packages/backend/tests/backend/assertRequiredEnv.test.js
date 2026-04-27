import { describe, it, expect } from "vitest";
import { assertRequiredEnv } from "../../shared/assertRequiredEnv.js";

// Anvil deployer key/address — public test fixtures from foundry's default
// mnemonic. Used to verify the cross-check passes when key/address match.
const ANVIL_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const ANVIL_ADDR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

function validLocalEnv() {
  return {
    SUPABASE_URL: "http://127.0.0.1:54321",
    SUPABASE_SERVICE_ROLE_KEY: "x".repeat(40),
    RPC_URL: "http://127.0.0.1:8545",
    BACKEND_WALLET_PRIVATE_KEY: ANVIL_KEY,
    BACKEND_WALLET_ADDRESS: ANVIL_ADDR,
    JWT_SECRET: "y".repeat(32),
    JWT_EXPIRES_IN: "7d",
    NETWORK: "LOCAL",
    // PAYMASTER_RPC_URL is now required on every network (the backend's
    // PaymasterService initializes lazily on first airdrop relay; without
    // this it 500s with "PAYMASTER_RPC_URL not configured"). On LOCAL it
    // just points at Anvil's RPC.
    PAYMASTER_RPC_URL: "http://127.0.0.1:8545",
  };
}

function validTestnetEnv() {
  return {
    ...validLocalEnv(),
    NETWORK: "TESTNET",
    PAYMASTER_RPC_URL: "https://api.pimlico.io/v2/84532/rpc?apikey=stub",
    PIMLICO_API_KEY: "pim_live_aaaaaaaaaa",
  };
}

describe("assertRequiredEnv", () => {
  it("passes with a valid LOCAL env", () => {
    expect(() => assertRequiredEnv(validLocalEnv())).not.toThrow();
  });

  it("passes with a valid TESTNET env", () => {
    expect(() => assertRequiredEnv(validTestnetEnv())).not.toThrow();
  });

  it("defaults NETWORK to LOCAL when missing", () => {
    const env = validLocalEnv();
    delete env.NETWORK;
    assertRequiredEnv(env);
    expect(env.NETWORK).toBe("LOCAL");
  });

  it("rejects an unknown NETWORK", () => {
    const env = validLocalEnv();
    env.NETWORK = "STAGING";
    expect(() => assertRequiredEnv(env)).toThrow(/NETWORK.*must be one of/);
  });

  it("trims surrounding whitespace in place", () => {
    const env = validLocalEnv();
    env.SUPABASE_URL = "  http://127.0.0.1:54321  \n";
    env.JWT_SECRET = "\t" + "y".repeat(32) + "\n";
    assertRequiredEnv(env);
    expect(env.SUPABASE_URL).toBe("http://127.0.0.1:54321");
    expect(env.JWT_SECRET).toBe("y".repeat(32));
  });

  it("collects ALL violations into a single error message", () => {
    const env = validLocalEnv();
    delete env.SUPABASE_URL;
    delete env.RPC_URL;
    env.JWT_SECRET = "tooshort";
    let caught;
    try {
      assertRequiredEnv(env);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(caught.message).toMatch(/SUPABASE_URL/);
    expect(caught.message).toMatch(/RPC_URL/);
    expect(caught.message).toMatch(/JWT_SECRET/);
  });

  it("rejects a malformed BACKEND_WALLET_PRIVATE_KEY", () => {
    const env = validLocalEnv();
    env.BACKEND_WALLET_PRIVATE_KEY = "not-a-key";
    expect(() => assertRequiredEnv(env)).toThrow(
      /BACKEND_WALLET_PRIVATE_KEY/,
    );
  });

  it("rejects a malformed BACKEND_WALLET_ADDRESS", () => {
    const env = validLocalEnv();
    env.BACKEND_WALLET_ADDRESS = "0xnope";
    expect(() => assertRequiredEnv(env)).toThrow(/BACKEND_WALLET_ADDRESS/);
  });

  it("rejects a key/address pair that does not match", () => {
    const env = validLocalEnv();
    // Anvil[1] address paired with Anvil[0] key
    env.BACKEND_WALLET_ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
    expect(() => assertRequiredEnv(env)).toThrow(/does not match/);
  });

  it("rejects JWT_SECRET shorter than 32 chars", () => {
    const env = validLocalEnv();
    env.JWT_SECRET = "y".repeat(16);
    expect(() => assertRequiredEnv(env)).toThrow(/JWT_SECRET/);
  });

  it("rejects missing JWT_EXPIRES_IN", () => {
    const env = validLocalEnv();
    delete env.JWT_EXPIRES_IN;
    expect(() => assertRequiredEnv(env)).toThrow(/JWT_EXPIRES_IN.*missing/);
  });

  it("rejects malformed JWT_EXPIRES_IN", () => {
    const env = validLocalEnv();
    env.JWT_EXPIRES_IN = "forever";
    expect(() => assertRequiredEnv(env)).toThrow(/JWT_EXPIRES_IN/);
  });

  it("accepts JWT_EXPIRES_IN as zeit duration or raw seconds", () => {
    for (const v of ["7d", "12h", "30m", "3600", "1y"]) {
      const env = validLocalEnv();
      env.JWT_EXPIRES_IN = v;
      expect(() => assertRequiredEnv(env), `value=${v}`).not.toThrow();
    }
  });

  it("rejects zero-duration JWT_EXPIRES_IN", () => {
    for (const v of ["0", "0d", "0h", "0m"]) {
      const env = validLocalEnv();
      env.JWT_EXPIRES_IN = v;
      expect(() => assertRequiredEnv(env), `value=${v}`).toThrow(
        /JWT_EXPIRES_IN/,
      );
    }
  });

  it("requires CORS_ORIGINS when NODE_ENV=production", () => {
    const env = { ...validLocalEnv(), NODE_ENV: "production" };
    delete env.CORS_ORIGINS;
    expect(() => assertRequiredEnv(env)).toThrow(/CORS_ORIGINS/);
  });

  it("does NOT require CORS_ORIGINS in dev", () => {
    const env = validLocalEnv();
    delete env.CORS_ORIGINS;
    expect(() => assertRequiredEnv(env)).not.toThrow();
  });

  it("rejects a non-URL SUPABASE_URL", () => {
    const env = validLocalEnv();
    env.SUPABASE_URL = "not-a-url";
    expect(() => assertRequiredEnv(env)).toThrow(/SUPABASE_URL.*valid URL/);
  });

  it("requires PAYMASTER_RPC_URL on every network (LOCAL included)", () => {
    const env = validLocalEnv();
    delete env.PAYMASTER_RPC_URL;
    expect(() => assertRequiredEnv(env)).toThrow(/PAYMASTER_RPC_URL/);
  });

  it("rejects a non-URL PAYMASTER_RPC_URL", () => {
    const env = validLocalEnv();
    env.PAYMASTER_RPC_URL = "not-a-url";
    expect(() => assertRequiredEnv(env)).toThrow(/PAYMASTER_RPC_URL.*valid URL/);
  });

  it("requires PIMLICO_API_KEY when NETWORK=MAINNET", () => {
    const env = validTestnetEnv();
    env.NETWORK = "MAINNET";
    delete env.PIMLICO_API_KEY;
    expect(() => assertRequiredEnv(env)).toThrow(/PIMLICO_API_KEY/);
  });

  it("does NOT require PIMLICO_API_KEY on LOCAL (still feature-gated)", () => {
    const env = validLocalEnv();
    delete env.PIMLICO_API_KEY;
    expect(() => assertRequiredEnv(env)).not.toThrow();
  });
});
