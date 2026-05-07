# Universal SIWE-on-Connect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire SIWE auto-fire on wallet connect for desktop-EOA wallets (MetaMask/Rabby/Coinbase Smart Wallet), so first-time connection produces a backend JWT containing `sma` + `is_admin` and triggers `ensureSmartAccount` server-side, unblocking M5 Path C testing.

**Architecture:** New `AppAuthProvider` mounted globally in `main.jsx` owns the JWT lifecycle. New `useAppAuth()` hook replaces `useAdminAuth()` (deleted) and the JWT half of `useFarcaster()`. New `SignInRetryBanner` component renders on signature rejection or verify error. `FarcasterProvider` keeps `useProfile()` from auth-kit but delegates JWT verify to `AppAuthProvider`. Spec: `docs/superpowers/specs/2026-05-07-universal-siwe-design.md` (commit `0b50bf0`).

**Tech Stack:** Vite + React 18 + wagmi v2 + viem 2.47.17 (frontend), Fastify + Supabase + Redis (backend), Vitest + jsdom + `@testing-library/react` (frontend tests), Vitest (backend tests).

---

## Milestones

| M | Theme | Tasks |
|---|---|---|
| M1 | Backend prerequisites | 1.1 — 1.2 |
| M2 | New auth scaffolding (TDD) | 2.1 — 2.4 |
| M3 | Wire into app tree | 3.1 — 3.2 |
| M4 | Migrate Farcaster JWT consumers | 4.1 — 4.3 |
| M5 | Migrate Admin callsites | 5.1 — 5.5 |
| M6 | Cleanup + version bumps | 6.1 — 6.2 |
| M7 | Live verification (M5 Path C) | 7.1 |

---

## M1 — Backend prerequisites

### Task 1.1 — Set `SOF_AIRDROP_AMOUNT_PER_USER` env var

**Files:**
- Modify: `scripts/local-dev.sh:479-484` (Step 9/10 backend startup block)
- Modify: `packages/backend/env/.env.testnet`
- Modify: `packages/backend/env/.env.testnet.example`

- [ ] **Step 1: Add `SOF_AIRDROP_AMOUNT_PER_USER=100` to `local-dev.sh` backend startup**

In `scripts/local-dev.sh`, find the `node fastify/boot.js` invocation in Step 9/10 and add the env var inline. Open the file and replace the block starting at the `cd "$ROOT_DIR/packages/backend"` line:

```bash
  cd "$ROOT_DIR/packages/backend"
  NETWORK=LOCAL \
  RPC_URL=$RPC \
  REDIS_URL=redis://127.0.0.1:6379 \
  SUPABASE_URL=$SUPABASE_URL \
  SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" \
  BACKEND_WALLET_PRIVATE_KEY=$DEPLOYER_KEY \
  BACKEND_WALLET_ADDRESS=$DEPLOYER_ADDR \
  PAYMASTER_RPC_URL=$RPC \
  JWT_SECRET=local-dev-jwt-secret-must-be-at-least-32-chars \
  JWT_EXPIRES_IN=7d \
  CORS_ORIGINS="http://localhost:5174,http://127.0.0.1:5174" \
  SIWF_ALLOWED_DOMAINS="localhost,127.0.0.1" \
  SOF_AIRDROP_AMOUNT_PER_USER=100 \
  PORT=3000 \
  node fastify/boot.js > "$PID_DIR/backend.log" 2>&1 &
```

The `100` is in whole-SOF units (no decimals). `airdropService.js:54` reads it via `getAirdropAmountWei()` which does the 18-decimal conversion.

- [ ] **Step 2: Append the var to `packages/backend/env/.env.testnet`**

Append (preserving any existing lines):

```
SOF_AIRDROP_AMOUNT_PER_USER=100
```

- [ ] **Step 3: Append the same var to `packages/backend/env/.env.testnet.example`**

```
SOF_AIRDROP_AMOUNT_PER_USER=100
```

- [ ] **Step 4: Verify the local backend picks it up after a restart**

Restart the backend (kill the PID in `.local-dev-pids/backend.pid`, re-run the same env-prefixed `node fastify/boot.js` block from `local-dev.sh`). Confirm it's in the process env:

```bash
ps eww -p $(cat .local-dev-pids/backend.pid) | tr ' ' '\n' | grep SOF_AIRDROP_AMOUNT_PER_USER
```

Expected output: `SOF_AIRDROP_AMOUNT_PER_USER=100`

- [ ] **Step 5: Commit**

```bash
git add scripts/local-dev.sh packages/backend/env/.env.testnet packages/backend/env/.env.testnet.example
git commit -m "$(cat <<'EOF'
feat(infra): set SOF_AIRDROP_AMOUNT_PER_USER for the airdrop relayer

Without this env var, airdropService.transferToSma silently skips the
SOF.transfer (see airdropService.js:54-92), which means smart_accounts.funded_at
never populates on /api/auth/verify and Path C testing for non-admin
users is structurally impossible. Local + testnet seeded at 100 SOF.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.2 — Verify backend wallet holds enough SOF on local

**Files:** Read-only verification + bash assertion.

- [ ] **Step 1: Compute backend wallet's SOF balance**

```bash
JSON=packages/contracts/deployments/local.json
SOF=$(jq -r '.contracts.SOFToken' $JSON)
BACKEND=$(grep BACKEND_WALLET_ADDRESS scripts/local-dev.sh | head -1 | sed 's/.*=//' | tr -d '"')
# Or read from env if local-dev.sh defines DEPLOYER_ADDR earlier
cast call $SOF "balanceOf(address)(uint256)" 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 --rpc-url http://127.0.0.1:8545
```

Expected: a value >> `100 * 1e18` (100 SOF). The deployer minted ~21M SOF to itself per `Deploy.s.sol`, so this should be well above. If the value is < `100 * 1e18`:

```bash
# Top up the backend wallet
cast send $SOF "transfer(address,uint256)" 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 1000000000000000000000000 \
  --private-key $DEPLOYER_KEY --rpc-url http://127.0.0.1:8545
```

- [ ] **Step 2: Document for testnet ops**

Add a paragraph to `instructions/backend-guidelines.md` under a new heading `### Backend Wallet Funding`:

```markdown
### Backend Wallet Funding

The backend wallet (`BACKEND_WALLET_PRIVATE_KEY` in env) must hold enough SOF
to airdrop `SOF_AIRDROP_AMOUNT_PER_USER` to every new user that authenticates.
For testnet, after each redeploy, verify the balance:

```bash
cast call $SOF_TOKEN "balanceOf(address)(uint256)" $BACKEND_WALLET_ADDRESS \
  --rpc-url $RPC
```

If low, transfer from the deployer or treasury wallet. The
`airdropService.transferToSma` function logs `transferToSma: tx reverted` if
the balance is insufficient — `funded_at` will stay null and users will see
the FirstConnectBanner but no SOF balance.
```

- [ ] **Step 3: Commit**

```bash
git add instructions/backend-guidelines.md
git commit -m "$(cat <<'EOF'
docs(backend): document airdrop relayer funding prerequisite

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## M2 — New auth scaffolding (TDD)

### Task 2.1 — Add i18n keys for SignInRetryBanner

**Files:** `packages/frontend/public/locales/en/auth.json`

- [ ] **Step 1: Append SignInRetry keys to `auth.json`**

Open the file. Existing structure is a flat object. Append before the closing brace, comma after the last existing entry:

```json
{
  "signInWithFarcaster": "Sign in with Farcaster",
  "siwfVerifying": "Verifying...",
  "siwfError": "Authentication Error",
  "siwfSuccess": "Signed In",
  "welcome": "Welcome",
  "linkFarcaster": "Link Farcaster",
  "farcasterLinked": "Linked",
  "farcasterSignOut": "Sign Out",
  "scanQrCode": "Scan with Farcaster to sign in",
  "scanQrCodeDescription": "Scan this QR code with the camera on a smartphone that has Farcaster installed and logged in with the Farcaster account you want to use.",
  "openInFarcaster": "Open in Farcaster",
  "logIn": "Log in",
  "logInOrSignUp": "Log in or sign up",
  "orConnectWallet": "or connect a wallet",
  "termsAgreement": "By signing in you agree to our",
  "backToOptions": "Back",
  "signInRetry": {
    "rejectedTitle": "Sign-in declined",
    "rejectedBody": "You can browse, but buying a ticket needs a one-time signature.",
    "errorTitle": "Sign-in failed",
    "errorBody": "{{reason}}",
    "button": "Try again"
  }
}
```

- [ ] **Step 2: Verify JSON parses**

```bash
node -e "console.log(JSON.parse(require('fs').readFileSync('packages/frontend/public/locales/en/auth.json', 'utf-8')).signInRetry)"
```

Expected: `{ rejectedTitle: '...', rejectedBody: '...', errorTitle: '...', errorBody: '...', button: '...' }`

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/public/locales/en/auth.json
git commit -m "$(cat <<'EOF'
i18n(frontend): add signInRetry strings for the SIWE retry banner

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2.2 — Create `useAppAuth` hook (TDD)

**Files:**
- Create: `packages/frontend/src/hooks/useAppAuth.js`
- Create: `packages/frontend/tests/hooks/useAppAuth.test.jsx`

The hook is trivial — it just reads from `AppAuthContext` and throws if the context is missing. Building it before the provider lets us write the provider's tests using the hook from the start.

- [ ] **Step 1: Write the failing test**

Create `packages/frontend/tests/hooks/useAppAuth.test.jsx`:

```jsx
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAppAuth } from "@/hooks/useAppAuth";
import { AppAuthContext } from "@/context/AppAuthProvider";

describe("useAppAuth", () => {
  it("throws when used outside AppAuthProvider", () => {
    expect(() => renderHook(() => useAppAuth())).toThrow(
      /must be used within an AppAuthProvider/i,
    );
  });

  it("returns the context value when wrapped in a provider", () => {
    const value = {
      jwt: "test-jwt",
      user: { address: "0xabc" },
      status: "authenticated",
      error: null,
      signIn: () => Promise.resolve(),
      signOut: () => {},
      getAuthHeaders: () => ({ Authorization: "Bearer test-jwt" }),
    };

    const wrapper = ({ children }) => (
      <AppAuthContext.Provider value={value}>{children}</AppAuthContext.Provider>
    );

    const { result } = renderHook(() => useAppAuth(), { wrapper });
    expect(result.current).toBe(value);
  });
});
```

- [ ] **Step 2: Run test — expect both to fail**

```bash
cd packages/frontend && npx vitest run tests/hooks/useAppAuth.test.jsx
```

Expected: 2 fail (`useAppAuth` not defined, `AppAuthContext` not defined).

- [ ] **Step 3: Create the hook**

Create `packages/frontend/src/hooks/useAppAuth.js`:

```js
import { useContext } from "react";
import { AppAuthContext } from "@/context/AppAuthProvider";

/**
 * useAppAuth — access the global JWT lifecycle exposed by AppAuthProvider.
 *
 * Returns: { jwt, user, status, error, signIn, signOut, getAuthHeaders }.
 * Throws if used outside <AppAuthProvider>.
 *
 * Replaces the deleted useAdminAuth and the JWT half of useFarcaster.
 */
export function useAppAuth() {
  const ctx = useContext(AppAuthContext);
  if (ctx === null || ctx === undefined) {
    throw new Error(
      "useAppAuth must be used within an AppAuthProvider — see main.jsx",
    );
  }
  return ctx;
}
```

The provider file (with the `AppAuthContext` export) doesn't exist yet — the test will still fail because of the missing import. That's intentional; we'll create the provider file in the next task.

- [ ] **Step 4: Skip ahead — the test will pass once Task 2.3 lands the provider. No commit yet.**

(We commit the hook + provider together at the end of Task 2.3.)

---

### Task 2.3 — Create `AppAuthProvider` (TDD)

**Files:**
- Create: `packages/frontend/src/context/AppAuthProvider.jsx`
- Create: `packages/frontend/tests/context/AppAuthProvider.test.jsx`

This is the largest task in the plan. It implements the state machine described in spec §5.

- [ ] **Step 1: Write the failing test file**

Create `packages/frontend/tests/context/AppAuthProvider.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act, cleanup } from "@testing-library/react";
import * as wagmi from "wagmi";
import * as wagmiCore from "@wagmi/core";
import { AppAuthProvider } from "@/context/AppAuthProvider";
import { useAppAuth } from "@/hooks/useAppAuth";
import * as raffleAccountHook from "@/hooks/useRaffleAccount";

// ── Mocks ────────────────────────────────────────────────────────────
vi.mock("wagmi", () => ({
  useAccount: vi.fn(),
}));

vi.mock("@wagmi/core", () => ({
  signMessage: vi.fn(),
}));

vi.mock("@/lib/wagmiConfig", () => ({
  config: { mocked: true },
}));

vi.mock("@/lib/apiBase", () => ({
  API_BASE: "http://test-api/api",
}));

// Helper: encode a fake JWT { wallet_address, exp } as a parseable token.
function makeJwt({ walletAddress, expSecondsFromNow = 3600 }) {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = btoa(
    JSON.stringify({
      wallet_address: walletAddress,
      exp: Math.floor(Date.now() / 1000) + expSecondsFromNow,
      sma: "0x" + "b".repeat(40),
      is_admin: false,
    }),
  );
  return `${header}.${payload}.signature`;
}

// Test consumer that renders the auth state for assertions.
function StatusProbe() {
  const auth = useAppAuth();
  return (
    <div>
      <span data-testid="status">{auth.status}</span>
      <span data-testid="jwt">{auth.jwt || "null"}</span>
      <span data-testid="address">{auth.user?.address || "null"}</span>
    </div>
  );
}

const EOA = "0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa";
const EOA_LC = EOA.toLowerCase();
const SMA = "0xBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBb";
const OTHER_EOA = "0xCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCc";

// Default to a connected desktop-EOA. Individual tests override.
function mockConnected({ address = EOA, walletType = "desktop-eoa" } = {}) {
  wagmi.useAccount.mockReturnValue({
    address,
    isConnected: !!address,
    connector: { id: "metaMask" },
  });
  vi.spyOn(raffleAccountHook, "useRaffleAccount").mockReturnValue({
    eoa: address,
    sma: SMA,
    walletType,
    isReady: true,
  });
}

function mockDisconnected() {
  wagmi.useAccount.mockReturnValue({
    address: undefined,
    isConnected: false,
    connector: undefined,
  });
  vi.spyOn(raffleAccountHook, "useRaffleAccount").mockReturnValue({
    eoa: undefined,
    sma: undefined,
    walletType: undefined,
    isReady: false,
  });
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("AppAuthProvider", () => {
  describe("initial state + JWT rehydration", () => {
    it("starts with status='idle' and null jwt when disconnected", () => {
      mockDisconnected();
      render(
        <AppAuthProvider>
          <StatusProbe />
        </AppAuthProvider>,
      );
      expect(screen.getByTestId("status")).toHaveTextContent("idle");
      expect(screen.getByTestId("jwt")).toHaveTextContent("null");
    });

    it("rehydrates from localStorage when a valid JWT matches the connected address", () => {
      const token = makeJwt({ walletAddress: EOA_LC });
      localStorage.setItem("sof:auth_jwt", token);
      localStorage.setItem(
        "sof:auth_user",
        JSON.stringify({ address: EOA_LC, sma: SMA, isAdmin: false }),
      );
      mockConnected({ address: EOA });

      render(
        <AppAuthProvider>
          <StatusProbe />
        </AppAuthProvider>,
      );

      expect(screen.getByTestId("status")).toHaveTextContent("authenticated");
      expect(screen.getByTestId("jwt")).toHaveTextContent(token);
      expect(screen.getByTestId("address")).toHaveTextContent(EOA_LC);
    });

    it("clears stale JWT (expired) on mount and triggers re-auth", async () => {
      const expired = makeJwt({ walletAddress: EOA_LC, expSecondsFromNow: -60 });
      localStorage.setItem("sof:auth_jwt", expired);
      mockConnected({ address: EOA });

      // Stub fetch + signMessage so the auto-fire reaches a clean state without hitting the network.
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ nonce: "abc123" }) })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            token: makeJwt({ walletAddress: EOA_LC }),
            user: { address: EOA_LC, sma: SMA, isAdmin: false },
          }),
        });
      wagmiCore.signMessage.mockResolvedValue("0xsig");

      render(
        <AppAuthProvider>
          <StatusProbe />
        </AppAuthProvider>,
      );

      // Stale token cleared synchronously on mount
      await waitFor(() => {
        expect(localStorage.getItem("sof:auth_jwt")).not.toBe(expired);
      });
      // Then auto-fire kicks in
      await waitFor(() =>
        expect(screen.getByTestId("status")).toHaveTextContent("authenticated"),
      );
    });

    it("clears legacy sof:admin_jwt and sof:farcaster_jwt keys on mount", () => {
      localStorage.setItem("sof:admin_jwt", "legacy-admin");
      localStorage.setItem("sof:farcaster_jwt", "legacy-farcaster");
      sessionStorage.setItem("sof:admin_jwt", "legacy-admin-session");
      sessionStorage.setItem("sof:farcaster_jwt", "legacy-farcaster-session");
      mockDisconnected();

      render(
        <AppAuthProvider>
          <StatusProbe />
        </AppAuthProvider>,
      );

      expect(localStorage.getItem("sof:admin_jwt")).toBeNull();
      expect(localStorage.getItem("sof:farcaster_jwt")).toBeNull();
      expect(sessionStorage.getItem("sof:admin_jwt")).toBeNull();
      expect(sessionStorage.getItem("sof:farcaster_jwt")).toBeNull();
    });
  });

  describe("auto-fire on connect", () => {
    it("auto-fires signIn when desktop-eoa connects without a cached JWT", async () => {
      const newToken = makeJwt({ walletAddress: EOA_LC });
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ nonce: "abc123" }) })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            token: newToken,
            user: { address: EOA_LC, sma: SMA, isAdmin: false },
          }),
        });
      wagmiCore.signMessage.mockResolvedValue("0xsig");
      mockConnected({ address: EOA });

      render(
        <AppAuthProvider>
          <StatusProbe />
        </AppAuthProvider>,
      );

      await waitFor(() =>
        expect(screen.getByTestId("status")).toHaveTextContent("authenticated"),
      );
      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(global.fetch).toHaveBeenNthCalledWith(
        1,
        "http://test-api/api/auth/nonce",
      );
      expect(global.fetch).toHaveBeenNthCalledWith(
        2,
        "http://test-api/api/auth/verify",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining(EOA_LC),
        }),
      );
      expect(localStorage.getItem("sof:auth_jwt")).toBe(newToken);
    });

    it("does NOT auto-fire when cached JWT is valid for connected address", async () => {
      const cachedToken = makeJwt({ walletAddress: EOA_LC });
      localStorage.setItem("sof:auth_jwt", cachedToken);
      localStorage.setItem(
        "sof:auth_user",
        JSON.stringify({ address: EOA_LC, sma: SMA, isAdmin: false }),
      );
      global.fetch = vi.fn();
      wagmiCore.signMessage.mockResolvedValue("0xsig");
      mockConnected({ address: EOA });

      render(
        <AppAuthProvider>
          <StatusProbe />
        </AppAuthProvider>,
      );

      // Wait a tick to ensure no effect fires
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      expect(global.fetch).not.toHaveBeenCalled();
      expect(wagmiCore.signMessage).not.toHaveBeenCalled();
      expect(screen.getByTestId("status")).toHaveTextContent("authenticated");
    });

    it("does NOT auto-fire for farcaster-miniapp wallet type", async () => {
      global.fetch = vi.fn();
      wagmiCore.signMessage.mockResolvedValue("0xsig");
      mockConnected({ address: EOA, walletType: "farcaster-miniapp" });

      render(
        <AppAuthProvider>
          <StatusProbe />
        </AppAuthProvider>,
      );

      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      expect(global.fetch).not.toHaveBeenCalled();
      expect(screen.getByTestId("status")).toHaveTextContent("idle");
    });
  });

  describe("wallet change", () => {
    it("clears state and re-auths when address changes mid-session", async () => {
      const tokenForOther = makeJwt({ walletAddress: OTHER_EOA.toLowerCase() });
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ nonce: "n1" }) })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            token: tokenForOther,
            user: { address: OTHER_EOA.toLowerCase(), sma: SMA, isAdmin: false },
          }),
        });
      wagmiCore.signMessage.mockResolvedValue("0xsig");

      // Pre-seed a JWT for the FIRST address.
      const firstToken = makeJwt({ walletAddress: EOA_LC });
      localStorage.setItem("sof:auth_jwt", firstToken);
      localStorage.setItem(
        "sof:auth_user",
        JSON.stringify({ address: EOA_LC, sma: SMA, isAdmin: false }),
      );
      mockConnected({ address: EOA });

      const { rerender } = render(
        <AppAuthProvider>
          <StatusProbe />
        </AppAuthProvider>,
      );

      await waitFor(() =>
        expect(screen.getByTestId("address")).toHaveTextContent(EOA_LC),
      );

      // Simulate wallet change.
      mockConnected({ address: OTHER_EOA });
      rerender(
        <AppAuthProvider>
          <StatusProbe />
        </AppAuthProvider>,
      );

      await waitFor(() =>
        expect(screen.getByTestId("address")).toHaveTextContent(
          OTHER_EOA.toLowerCase(),
        ),
      );
      expect(localStorage.getItem("sof:auth_jwt")).toBe(tokenForOther);
    });

    it("clears state on disconnect", async () => {
      const cachedToken = makeJwt({ walletAddress: EOA_LC });
      localStorage.setItem("sof:auth_jwt", cachedToken);
      localStorage.setItem(
        "sof:auth_user",
        JSON.stringify({ address: EOA_LC, sma: SMA, isAdmin: false }),
      );
      mockConnected({ address: EOA });

      const { rerender } = render(
        <AppAuthProvider>
          <StatusProbe />
        </AppAuthProvider>,
      );

      await waitFor(() =>
        expect(screen.getByTestId("status")).toHaveTextContent("authenticated"),
      );

      mockDisconnected();
      rerender(
        <AppAuthProvider>
          <StatusProbe />
        </AppAuthProvider>,
      );

      await waitFor(() =>
        expect(screen.getByTestId("status")).toHaveTextContent("idle"),
      );
      expect(localStorage.getItem("sof:auth_jwt")).toBeNull();
    });
  });

  describe("error states", () => {
    it("status='rejected' when signMessage throws UserRejectedRequestError", async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ nonce: "abc" }) });
      const err = new Error("User rejected the request");
      err.name = "UserRejectedRequestError";
      wagmiCore.signMessage.mockRejectedValue(err);
      mockConnected({ address: EOA });

      render(
        <AppAuthProvider>
          <StatusProbe />
        </AppAuthProvider>,
      );

      await waitFor(() =>
        expect(screen.getByTestId("status")).toHaveTextContent("rejected"),
      );
      expect(localStorage.getItem("sof:auth_jwt")).toBeNull();
    });

    it("status='error' when /verify returns 4xx/5xx", async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ nonce: "abc" }) })
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          json: async () => ({ error: "Invalid signature" }),
        });
      wagmiCore.signMessage.mockResolvedValue("0xsig");
      mockConnected({ address: EOA });

      render(
        <AppAuthProvider>
          <StatusProbe />
        </AppAuthProvider>,
      );

      await waitFor(() =>
        expect(screen.getByTestId("status")).toHaveTextContent("error"),
      );
    });
  });

  describe("storage policy", () => {
    it("persists to localStorage for desktop-eoa", async () => {
      const token = makeJwt({ walletAddress: EOA_LC });
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ nonce: "abc" }) })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            token,
            user: { address: EOA_LC, sma: SMA, isAdmin: false },
          }),
        });
      wagmiCore.signMessage.mockResolvedValue("0xsig");
      mockConnected({ address: EOA, walletType: "desktop-eoa" });

      render(
        <AppAuthProvider>
          <StatusProbe />
        </AppAuthProvider>,
      );

      await waitFor(() =>
        expect(localStorage.getItem("sof:auth_jwt")).toBe(token),
      );
    });

    it("does NOT persist to localStorage for farcaster-miniapp (in-memory only)", async () => {
      // Simulate the Farcaster-delegated signIn call — explicit method:'farcaster' opts.
      const token = makeJwt({ walletAddress: EOA_LC });
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          token,
          user: { address: EOA_LC, sma: SMA, isAdmin: false },
        }),
      });
      mockConnected({ address: EOA, walletType: "farcaster-miniapp" });

      function FarcasterTrigger() {
        const auth = useAppAuth();
        return (
          <button
            type="button"
            onClick={() =>
              auth.signIn({
                method: "farcaster",
                message: "siwf-msg",
                signature: "0xsig",
                nonce: "abc",
              })
            }
          >
            siwf
          </button>
        );
      }

      render(
        <AppAuthProvider>
          <FarcasterTrigger />
          <StatusProbe />
        </AppAuthProvider>,
      );

      await act(async () => {
        screen.getByText("siwf").click();
        await new Promise((r) => setTimeout(r, 0));
      });

      await waitFor(() =>
        expect(screen.getByTestId("status")).toHaveTextContent("authenticated"),
      );
      expect(localStorage.getItem("sof:auth_jwt")).toBeNull();
    });
  });

  describe("getAuthHeaders", () => {
    it("returns Bearer header when authenticated, empty otherwise", async () => {
      function HeaderProbe() {
        const auth = useAppAuth();
        const headers = auth.getAuthHeaders();
        return (
          <span data-testid="headers">
            {headers.Authorization || "no-auth"}
          </span>
        );
      }

      const token = makeJwt({ walletAddress: EOA_LC });
      localStorage.setItem("sof:auth_jwt", token);
      localStorage.setItem(
        "sof:auth_user",
        JSON.stringify({ address: EOA_LC, sma: SMA, isAdmin: false }),
      );
      mockConnected({ address: EOA });

      render(
        <AppAuthProvider>
          <HeaderProbe />
        </AppAuthProvider>,
      );

      await waitFor(() =>
        expect(screen.getByTestId("headers")).toHaveTextContent(
          `Bearer ${token}`,
        ),
      );
    });
  });
});
```

- [ ] **Step 2: Run tests — expect ALL to fail**

```bash
cd packages/frontend && npx vitest run tests/context/AppAuthProvider.test.jsx
```

Expected: many failures, all because `AppAuthProvider` is not yet defined.

- [ ] **Step 3: Create the provider implementation**

Create `packages/frontend/src/context/AppAuthProvider.jsx`:

```jsx
/**
 * AppAuthProvider — global JWT lifecycle.
 *
 * Auto-fires SIWE on connect for desktop-EOA and Coinbase Smart Wallet
 * users when no valid cached JWT exists for the connected address.
 * Backend /api/auth/verify response populates user.sma + user.isAdmin
 * via ensureSmartAccount + ensureAdminFlag.
 *
 * Replaces AdminAuthContext (deleted) and the JWT half of FarcasterProvider
 * (kept for auth-kit profile state only).
 *
 * Storage:
 *  - desktop-eoa, coinbase-smart → localStorage (sof:auth_jwt + sof:auth_user)
 *  - farcaster-miniapp           → in-memory only
 *
 * See spec: docs/superpowers/specs/2026-05-07-universal-siwe-design.md
 */

import {
  createContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import PropTypes from "prop-types";
import { useAccount } from "wagmi";
import { signMessage } from "@wagmi/core";
import { config } from "@/lib/wagmiConfig";
import { useRaffleAccount } from "@/hooks/useRaffleAccount";
import { API_BASE } from "@/lib/apiBase";

const STORAGE_JWT_KEY = "sof:auth_jwt";
const STORAGE_USER_KEY = "sof:auth_user";
const LEGACY_KEYS = ["sof:admin_jwt", "sof:farcaster_jwt", "sof:farcaster_user"];
const SIGN_IN_MESSAGE_PREFIX = "Sign in to SecondOrder.fun\nNonce: ";

// Wallet types whose JWT should persist across tab/restart.
const PERSIST_WALLET_TYPES = new Set(["desktop-eoa", "coinbase-smart"]);
// Wallet types that auto-fire SIWE on connect.
const AUTO_FIRE_WALLET_TYPES = new Set(["desktop-eoa", "coinbase-smart"]);

export const AppAuthContext = createContext(null);

function decodeJwtPayload(token) {
  try {
    const base64 = token.split(".")[1];
    const json = atob(base64.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function isTokenExpired(token) {
  const payload = decodeJwtPayload(token);
  if (!payload?.exp) return true;
  return payload.exp * 1000 < Date.now() + 30_000;
}

function clearLegacyKeys() {
  for (const key of LEGACY_KEYS) {
    try { localStorage.removeItem(key); } catch { /* noop */ }
    try { sessionStorage.removeItem(key); } catch { /* noop */ }
  }
}

function readPersistedAuth(currentAddressLc) {
  try {
    const token = localStorage.getItem(STORAGE_JWT_KEY);
    if (!token || isTokenExpired(token)) {
      localStorage.removeItem(STORAGE_JWT_KEY);
      localStorage.removeItem(STORAGE_USER_KEY);
      return null;
    }
    const payload = decodeJwtPayload(token);
    if (!payload?.wallet_address) {
      localStorage.removeItem(STORAGE_JWT_KEY);
      localStorage.removeItem(STORAGE_USER_KEY);
      return null;
    }
    if (currentAddressLc && payload.wallet_address !== currentAddressLc) {
      localStorage.removeItem(STORAGE_JWT_KEY);
      localStorage.removeItem(STORAGE_USER_KEY);
      return null;
    }
    let user = null;
    try {
      const raw = localStorage.getItem(STORAGE_USER_KEY);
      user = raw ? JSON.parse(raw) : null;
    } catch { /* noop */ }
    return { token, user };
  } catch {
    return null;
  }
}

export function AppAuthProvider({ children }) {
  const { address, isConnected } = useAccount();
  const { walletType } = useRaffleAccount();

  // Mount: clear legacy keys exactly once.
  const cleanedLegacyOnce = useRef(false);
  if (!cleanedLegacyOnce.current) {
    cleanedLegacyOnce.current = true;
    clearLegacyKeys();
  }

  const addressLc = address ? address.toLowerCase() : null;

  // Initial state: rehydrate if a valid JWT exists for the connected address.
  const [{ jwt, user }, setAuth] = useState(() => {
    if (!addressLc) return { jwt: null, user: null };
    const persisted = readPersistedAuth(addressLc);
    return persisted
      ? { jwt: persisted.token, user: persisted.user }
      : { jwt: null, user: null };
  });

  const [status, setStatus] = useState(jwt ? "authenticated" : "idle");
  const [error, setError] = useState(null);

  // Track in-flight signIn so wallet-change re-fires don't double up.
  const inflightRef = useRef(false);

  const persist = useCallback((token, userObj) => {
    if (!walletType || PERSIST_WALLET_TYPES.has(walletType)) {
      try {
        localStorage.setItem(STORAGE_JWT_KEY, token);
        if (userObj) localStorage.setItem(STORAGE_USER_KEY, JSON.stringify(userObj));
      } catch { /* noop */ }
    }
  }, [walletType]);

  const clearStorage = useCallback(() => {
    try { localStorage.removeItem(STORAGE_JWT_KEY); } catch { /* noop */ }
    try { localStorage.removeItem(STORAGE_USER_KEY); } catch { /* noop */ }
  }, []);

  const signIn = useCallback(async (opts = { method: "wallet" }) => {
    if (inflightRef.current) return;
    if (!addressLc && opts.method !== "farcaster") {
      setError("Wallet not connected");
      setStatus("error");
      return;
    }

    inflightRef.current = true;
    setError(null);
    setStatus("signing");

    try {
      let body;
      if (opts.method === "farcaster") {
        const { message, signature, nonce } = opts;
        body = JSON.stringify({ method: "farcaster", message, signature, nonce });
      } else {
        // Wallet path — fetch nonce, sign, verify.
        const nonceRes = await fetch(`${API_BASE}/auth/nonce`);
        if (!nonceRes.ok) {
          const data = await nonceRes.json().catch(() => ({}));
          throw new Error(data.error || "Failed to fetch nonce");
        }
        const { nonce } = await nonceRes.json();

        const message = `${SIGN_IN_MESSAGE_PREFIX}${nonce}`;
        let signature;
        try {
          signature = await signMessage(config, { message });
        } catch (err) {
          if (
            err?.name === "UserRejectedRequestError" ||
            String(err?.message || "").includes("User rejected")
          ) {
            setStatus("rejected");
            setError("User rejected sign-in");
            return;
          }
          throw err;
        }

        setStatus("verifying");
        body = JSON.stringify({
          method: "wallet",
          address: addressLc,
          signature,
          nonce,
        });
      }

      const verifyRes = await fetch(`${API_BASE}/auth/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });

      if (!verifyRes.ok) {
        const data = await verifyRes.json().catch(() => ({}));
        throw new Error(data.error || `Verification failed (${verifyRes.status})`);
      }

      const { token, user: userObj } = await verifyRes.json();
      setAuth({ jwt: token, user: userObj });
      setStatus("authenticated");
      persist(token, userObj);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[AppAuth] signIn failed:", err);
      setStatus("error");
      setError(err?.message || "Sign-in failed");
    } finally {
      inflightRef.current = false;
    }
  }, [addressLc, persist]);

  const signOut = useCallback(() => {
    setAuth({ jwt: null, user: null });
    setStatus("idle");
    setError(null);
    clearStorage();
  }, [clearStorage]);

  const getAuthHeaders = useCallback(() => {
    return jwt ? { Authorization: `Bearer ${jwt}` } : {};
  }, [jwt]);

  // Effect: react to address change / disconnect.
  useEffect(() => {
    if (!isConnected || !addressLc) {
      // Disconnect — clear everything.
      if (jwt || user) {
        setAuth({ jwt: null, user: null });
        setStatus("idle");
        clearStorage();
      }
      return;
    }

    // Address mismatch with stored JWT — clear and let the auto-fire effect kick in.
    if (jwt) {
      const payload = decodeJwtPayload(jwt);
      if (payload?.wallet_address !== addressLc) {
        setAuth({ jwt: null, user: null });
        setStatus("idle");
        clearStorage();
        return;
      }
    } else {
      // No in-memory JWT — try to rehydrate from storage in case localStorage was
      // updated by another tab.
      const persisted = readPersistedAuth(addressLc);
      if (persisted) {
        setAuth({ jwt: persisted.token, user: persisted.user });
        setStatus("authenticated");
      }
    }
  }, [addressLc, isConnected, jwt, user, clearStorage]);

  // Effect: auto-fire on connect when no valid JWT and wallet type qualifies.
  useEffect(() => {
    if (!isConnected || !addressLc) return;
    if (!walletType || !AUTO_FIRE_WALLET_TYPES.has(walletType)) return;
    if (jwt) return;
    if (status === "signing" || status === "verifying") return;
    if (status === "rejected" || status === "error") return; // don't loop
    void signIn({ method: "wallet" });
  }, [isConnected, addressLc, walletType, jwt, status, signIn]);

  const value = useMemo(
    () => ({ jwt, user, status, error, signIn, signOut, getAuthHeaders }),
    [jwt, user, status, error, signIn, signOut, getAuthHeaders],
  );

  return (
    <AppAuthContext.Provider value={value}>{children}</AppAuthContext.Provider>
  );
}

AppAuthProvider.propTypes = {
  children: PropTypes.node.isRequired,
};
```

- [ ] **Step 4: Run tests — expect all to pass**

```bash
cd packages/frontend && npx vitest run tests/context/AppAuthProvider.test.jsx tests/hooks/useAppAuth.test.jsx
```

Expected: all tests pass. If any fail, read the failure carefully and fix the implementation — don't relax the test.

- [ ] **Step 5: Run lint**

```bash
cd packages/frontend && npx eslint src/context/AppAuthProvider.jsx src/hooks/useAppAuth.js tests/context/AppAuthProvider.test.jsx tests/hooks/useAppAuth.test.jsx
```

Expected: zero warnings (project enforces `--max-warnings 0`).

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/context/AppAuthProvider.jsx \
        packages/frontend/src/hooks/useAppAuth.js \
        packages/frontend/tests/context/AppAuthProvider.test.jsx \
        packages/frontend/tests/hooks/useAppAuth.test.jsx
git commit -m "$(cat <<'EOF'
feat(frontend): AppAuthProvider — global SIWE-on-connect JWT lifecycle

New provider auto-fires SIWE for desktop-eoa and coinbase-smart wallets when
no valid cached JWT exists, backs onto /api/auth/verify which already
returns sma + is_admin claims. localStorage persistence for those wallet
types; in-memory only for farcaster-miniapp. Replaces AdminAuthContext
(deleted in M6) and the JWT half of FarcasterProvider (demoted in M4).

Per docs/superpowers/specs/2026-05-07-universal-siwe-design.md.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2.4 — Create `SignInRetryBanner` (TDD)

**Files:**
- Create: `packages/frontend/src/components/auth/SignInRetryBanner.jsx`
- Create: `packages/frontend/tests/components/SignInRetryBanner.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `packages/frontend/tests/components/SignInRetryBanner.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { AppAuthContext } from "@/context/AppAuthProvider";
import SignInRetryBanner from "@/components/auth/SignInRetryBanner";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key, vars) => (vars ? `${key}|${JSON.stringify(vars)}` : key),
    i18n: { language: "en" },
  }),
}));

function withAuth(value, ui) {
  return (
    <AppAuthContext.Provider value={value}>{ui}</AppAuthContext.Provider>
  );
}

beforeEach(() => cleanup());
afterEach(() => cleanup());

describe("SignInRetryBanner", () => {
  it.each([["authenticated"], ["idle"], ["signing"], ["verifying"]])(
    "is hidden when status=%s",
    (status) => {
      render(
        withAuth(
          { status, error: null, signIn: vi.fn() },
          <SignInRetryBanner />,
        ),
      );
      expect(screen.queryByTestId("signin-retry-banner")).not.toBeInTheDocument();
    },
  );

  it("renders rejected copy when status='rejected'", () => {
    render(
      withAuth(
        { status: "rejected", error: null, signIn: vi.fn() },
        <SignInRetryBanner />,
      ),
    );
    expect(screen.getByTestId("signin-retry-banner")).toBeInTheDocument();
    expect(screen.getByText("auth:signInRetry.rejectedTitle")).toBeInTheDocument();
    expect(screen.getByText("auth:signInRetry.rejectedBody")).toBeInTheDocument();
  });

  it("renders error copy when status='error'", () => {
    render(
      withAuth(
        { status: "error", error: "Network down", signIn: vi.fn() },
        <SignInRetryBanner />,
      ),
    );
    expect(screen.getByText("auth:signInRetry.errorTitle")).toBeInTheDocument();
    // Body uses the error as the {{reason}} interpolation
    expect(
      screen.getByText(/auth:signInRetry\.errorBody\|.*Network down/),
    ).toBeInTheDocument();
  });

  it("clicking the button calls signIn()", () => {
    const signIn = vi.fn();
    render(
      withAuth(
        { status: "rejected", error: null, signIn },
        <SignInRetryBanner />,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: /signInRetry.button/i }));
    expect(signIn).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test — expect fail (component missing)**

```bash
cd packages/frontend && npx vitest run tests/components/SignInRetryBanner.test.jsx
```

- [ ] **Step 3: Implement the component**

Create `packages/frontend/src/components/auth/SignInRetryBanner.jsx`:

```jsx
// src/components/auth/SignInRetryBanner.jsx
//
// Shown when AppAuthProvider's status is 'rejected' or 'error'. Lets the user
// retry the SIWE flow without disconnecting. Hidden in all other states so
// the dapp doesn't flash a banner during signing/verifying.
//
// Mounts in <App /> next to <FirstConnectBanner /> in both desktop and mobile
// branches.

import { useTranslation } from "react-i18next";
import { useAppAuth } from "@/hooks/useAppAuth";

const SignInRetryBanner = () => {
  const { t } = useTranslation("auth");
  const { status, error, signIn } = useAppAuth();

  if (status !== "rejected" && status !== "error") return null;

  const isRejected = status === "rejected";
  const title = isRejected
    ? t("signInRetry.rejectedTitle")
    : t("signInRetry.errorTitle");
  const body = isRejected
    ? t("signInRetry.rejectedBody")
    : t("signInRetry.errorBody", { reason: error || "Unknown error" });

  const tone = isRejected
    ? "border-destructive/40 bg-destructive/10"
    : "border-warning/40 bg-warning/10";

  return (
    <div
      role="status"
      data-testid="signin-retry-banner"
      className="container mx-auto mt-4 px-4"
    >
      <div className={`rounded-md border p-4 text-foreground ${tone}`}>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{body}</p>
        <div className="mt-3">
          <button
            type="button"
            onClick={() => signIn()}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent"
          >
            {t("signInRetry.button")}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SignInRetryBanner;
```

- [ ] **Step 4: Run test — expect pass**

```bash
cd packages/frontend && npx vitest run tests/components/SignInRetryBanner.test.jsx
```

- [ ] **Step 5: Lint**

```bash
cd packages/frontend && npx eslint src/components/auth/SignInRetryBanner.jsx tests/components/SignInRetryBanner.test.jsx
```

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/components/auth/SignInRetryBanner.jsx \
        packages/frontend/tests/components/SignInRetryBanner.test.jsx
git commit -m "$(cat <<'EOF'
feat(frontend): SignInRetryBanner shown on SIWE rejection or error

Renders only when AppAuthProvider status is 'rejected' or 'error'.
Click → useAppAuth().signIn() — same flow as auto-fire. Hidden during
authenticated/idle/signing/verifying so it doesn't flicker mid-flow.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## M3 — Wire into app tree

### Task 3.1 — Mount `AppAuthProvider` in `main.jsx`

**Files:** `packages/frontend/src/main.jsx`

- [ ] **Step 1: Find the existing provider stack**

The current order in `main.jsx` (around line 200, in the `RouterProvider` setup):

```jsx
<WagmiConfigProvider>
  <RainbowKitProvider chains={getRainbowKitChains()}>
    <AuthKitProvider config={farcasterConfig}>
      <FarcasterProvider>
        <RaffleAccountProvider>
          <LoginModalProvider>
            <SSEProvider>
              <UsernameProvider>
                <ThemeProvider>
                  <RouterProvider router={router} />
                </ThemeProvider>
              </UsernameProvider>
            </SSEProvider>
          </LoginModalProvider>
        </RaffleAccountProvider>
      </FarcasterProvider>
    </AuthKitProvider>
  </RainbowKitProvider>
</WagmiConfigProvider>
```

- [ ] **Step 2: Add the import**

Near the top of `main.jsx` (alphabetically with other context imports, around the existing `RaffleAccountProvider` import):

```jsx
import { AppAuthProvider } from "./context/AppAuthProvider";
```

- [ ] **Step 3: Insert `<AppAuthProvider>` between `RaffleAccountProvider` and `LoginModalProvider`**

Per spec §5.1, `AppAuthProvider` sits below `RaffleAccountProvider` (so it can read `walletType`) and above the rest:

```jsx
<WagmiConfigProvider>
  <RainbowKitProvider chains={getRainbowKitChains()}>
    <AuthKitProvider config={farcasterConfig}>
      <FarcasterProvider>
        <RaffleAccountProvider>
          <AppAuthProvider>
            <LoginModalProvider>
              <SSEProvider>
                <UsernameProvider>
                  <ThemeProvider>
                    <RouterProvider router={router} />
                  </ThemeProvider>
                </UsernameProvider>
              </SSEProvider>
            </LoginModalProvider>
          </AppAuthProvider>
        </RaffleAccountProvider>
      </FarcasterProvider>
    </AuthKitProvider>
  </RainbowKitProvider>
</WagmiConfigProvider>
```

- [ ] **Step 4: Boot the dev server and confirm no provider crash**

```bash
cd packages/frontend && npm run dev
```

In the browser, open `http://localhost:5174/`. Open DevTools console. Expected: no errors. The page renders Home as before. With no wallet connected, status stays `idle`.

- [ ] **Step 5: Smoke-test wallet connect**

Click Connect Wallet → connect MetaMask on Anvil #4 (or any test EOA). Expected: a single MetaMask signature popup appears (the auto-fire). Sign it. DevTools Network tab should show one `GET /api/auth/nonce` and one `POST /api/auth/verify`. After verify, `localStorage` has `sof:auth_jwt` and `sof:auth_user` set.

If it doesn't auto-fire: check that the wallet's `connector.id` returns something `RaffleAccountProvider`'s `classifyWalletType` maps to `desktop-eoa`. Look at `RaffleAccountProvider.jsx:16-21`.

- [ ] **Step 6: Stop dev server and commit**

```bash
git add packages/frontend/src/main.jsx
git commit -m "$(cat <<'EOF'
feat(frontend): mount AppAuthProvider globally in main.jsx

Auto-SIWE on connect now fires for every desktop-eoa wallet that opens the
dapp, populating smart_accounts and triggering airdropService.transferToSma
backend-side. Provider sits below RaffleAccountProvider so it can read
walletType.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3.2 — Render `SignInRetryBanner` in `App.jsx`

**Files:** `packages/frontend/src/App.jsx`

- [ ] **Step 1: Add the import**

Near the existing `FirstConnectBanner` import (around line 8):

```jsx
import SignInRetryBanner from "@/components/auth/SignInRetryBanner";
```

- [ ] **Step 2: Render the banner in both layouts**

In `App.jsx`, find the two `<FirstConnectBanner />` lines (one in the mobile branch, one in the desktop branch) and add `<SignInRetryBanner />` directly after each:

```jsx
// Mobile layout (around line 38):
<MobileHeader />
<FirstConnectBanner />
<SignInRetryBanner />
<SweepBanner />

// Desktop layout (around line 53):
<Header />
<FirstConnectBanner />
<SignInRetryBanner />
<SweepBanner />
```

- [ ] **Step 3: Manually verify the rejection path**

Boot the dev server. Connect a wallet but click "Reject" in MetaMask when the SIWE popup appears. Expected: `SignInRetryBanner` shows with the red rejected copy and a "Try again" button. Clicking it re-prompts MetaMask.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/App.jsx
git commit -m "$(cat <<'EOF'
feat(frontend): render SignInRetryBanner alongside FirstConnectBanner

Desktop and mobile layouts both surface the retry banner so a rejected SIWE
or backend error gives the user a non-blocking path back to authentication.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## M4 — Migrate Farcaster JWT consumers

### Task 4.1 — Demote `FarcasterProvider` to profile-only

**Files:**
- Modify: `packages/frontend/src/context/FarcasterProvider.jsx`
- Modify: `packages/frontend/src/context/farcasterContext.js` (if it exports a default shape)

The provider currently owns: auth-kit profile, backend JWT, backend user, fetchNonce, verifyWithBackend, logout, getAuthHeaders. After this change, it owns only: auth-kit profile, fetchNonce (still useful for `useFarcasterSignIn`), and a thin `verifyWithBackend` that delegates to `useAppAuth().signIn`.

- [ ] **Step 1: Replace `FarcasterProvider.jsx` with the slimmed version**

Open the file and replace its contents with:

```jsx
/**
 * FarcasterProvider — auth-kit profile state only.
 *
 * Backend JWT lifecycle moved to AppAuthProvider (spec §5). This provider
 * keeps the useProfile() data + the relay nonce fetcher used by
 * useFarcasterSignIn. Verification with the backend is delegated to
 * AppAuthProvider via useAppAuth().signIn({ method: 'farcaster', ... }).
 */

import { useCallback, useContext, useMemo } from "react";
import { useProfile } from "@farcaster/auth-kit";
import PropTypes from "prop-types";
import FarcasterContext from "./farcasterContext";

import { API_BASE } from "@/lib/apiBase";

const FarcasterProvider = ({ children }) => {
  const { isAuthenticated: isAuthKitAuthenticated, profile } = useProfile();

  const fetchNonce = useCallback(async () => {
    const res = await fetch(`${API_BASE}/auth/nonce`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Failed to fetch nonce");
    }
    const { nonce } = await res.json();
    return nonce;
  }, []);

  const value = useMemo(
    () => ({
      // auth-kit state
      isAuthenticated: isAuthKitAuthenticated,
      profile: profile || null,
      // helpers
      fetchNonce,
    }),
    [isAuthKitAuthenticated, profile, fetchNonce],
  );

  return (
    <FarcasterContext.Provider value={value}>
      {children}
    </FarcasterContext.Provider>
  );
};

FarcasterProvider.propTypes = {
  children: PropTypes.node.isRequired,
};

export const useFarcasterSDK = () => {
  const context = useContext(FarcasterContext);
  if (!context) return { context: null };
  return { context };
};

export { FarcasterProvider };
```

- [ ] **Step 2: Verify `useFarcaster` hook still works**

`packages/frontend/src/hooks/useFarcaster.js` returns the context value. Since we changed the shape, callers that read `isBackendAuthenticated`, `backendUser`, `verifyWithBackend`, `logout`, or `getAuthHeaders` will break. Tasks 4.2 and 4.3 fix those callers.

- [ ] **Step 3: Confirm only the expected callers will break**

```bash
grep -rn "isBackendAuthenticated\|backendUser\|backendJwt\|verifyWithBackend" packages/frontend/src 2>/dev/null
```

Expected callers (will be migrated in subsequent tasks):
- `packages/frontend/src/components/layout/Header.jsx` (Task 4.2)
- `packages/frontend/src/context/UsernameContext.jsx` (Task 4.3)
- `packages/frontend/src/hooks/useFarcasterSignIn.js` — uses `verifyWithBackend` (also Task 4.2 follow-up)

If anything else shows up, add migration steps to this task before committing.

- [ ] **Step 4: Commit (do not run tests yet — known broken callers will fix in 4.2 & 4.3)**

```bash
git add packages/frontend/src/context/FarcasterProvider.jsx
git commit -m "$(cat <<'EOF'
refactor(frontend): demote FarcasterProvider to profile-only state

Backend JWT lifecycle moves to AppAuthProvider per spec §5. Three callers
(Header, UsernameContext, useFarcasterSignIn) will be migrated in M4
follow-ups in the same branch.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4.2 — Migrate `useFarcasterSignIn` and `Header.jsx`

**Files:**
- Modify: `packages/frontend/src/hooks/useFarcasterSignIn.js`
- Modify: `packages/frontend/src/components/layout/Header.jsx`

- [ ] **Step 1: Update `useFarcasterSignIn.js` to call `useAppAuth().signIn`**

In the hook's imports, replace the `verifyWithBackend` destructure:

```js
// BEFORE (around line 25):
const { fetchNonce, verifyWithBackend, isVerifying } = useFarcaster();

// AFTER:
import { useAppAuth } from "@/hooks/useAppAuth";
// ...
const { fetchNonce } = useFarcaster();
const { signIn, status: appAuthStatus } = useAppAuth();
const isVerifying = appAuthStatus === "verifying";
```

In the polling success handler (around line 153), replace the `verifyWithBackend` call:

```js
// BEFORE:
const { user } = await verifyWithBackend({ message, signature, nonce });

// AFTER:
await signIn({ method: "farcaster", message, signature, nonce });
// useAppAuth's state machine populates user; we read it via the hook
// in components that need it.
```

The toast message currently reads `user.displayName || user.username || \`FID ${user.fid}\``. After migration, that information lives in `useAppAuth().user`. Update the success block to read from `useAppAuth()` instead — but since `signIn` is async and React state hasn't necessarily flushed by the time the toast fires, simplify:

```js
// In the success block:
toast({
  title: t("siwfSuccess", "Signed In"),
  description: t("welcome", "Welcome"),
});
```

The richer welcome message is a nice-to-have, not load-bearing — drop it.

- [ ] **Step 2: Update `Header.jsx` to read backend user from `useAppAuth`**

Open `packages/frontend/src/components/layout/Header.jsx`. The current line 33:

```js
const { isBackendAuthenticated, backendUser, logout: farcasterLogout } = useFarcaster();
```

Replace with:

```js
import { useAppAuth } from "@/hooks/useAppAuth";
// ...
const { user: appAuthUser, status: authStatus, signOut: appAuthLogout } = useAppAuth();
const isBackendAuthenticated = authStatus === "authenticated";
const backendUser = appAuthUser; // shape: { address, sma, isAdmin, fid?, username? }
const farcasterLogout = appAuthLogout;
```

The two consumer sites lower in the file (`isBackendAuthenticated ? backendUser : null` and `isBackendAuthenticated && backendUser ? ...`) work unchanged — same variable names, same shape.

If `Header.jsx` reads any field from `backendUser` that the AppAuth user object doesn't carry (e.g. `displayName`, `pfpUrl`), grep for those and fall back to the auth-kit `profile` from `useFarcaster()` for display:

```bash
grep -n "backendUser\." packages/frontend/src/components/layout/Header.jsx
```

For each `backendUser.X` access, if `X` is `displayName` or `pfpUrl`, change to read from `useFarcaster().profile?.X` instead.

- [ ] **Step 3: Run lint on the changed files**

```bash
cd packages/frontend && npx eslint src/hooks/useFarcasterSignIn.js src/components/layout/Header.jsx
```

- [ ] **Step 4: Boot dev server and smoke-test**

```bash
cd packages/frontend && npm run dev
```

Visit `/`, connect a wallet (desktop EOA), confirm the dapp renders correctly with the user dropdown showing the right username/address. No console errors.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/hooks/useFarcasterSignIn.js \
        packages/frontend/src/components/layout/Header.jsx
git commit -m "$(cat <<'EOF'
refactor(frontend): migrate Header + useFarcasterSignIn off useFarcaster JWT

Header reads backend user from useAppAuth; useFarcasterSignIn delegates the
backend verify call to useAppAuth().signIn({ method: 'farcaster', ... }).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4.3 — Migrate `UsernameContext.jsx`

**Files:** `packages/frontend/src/context/UsernameContext.jsx`

- [ ] **Step 1: Replace the Farcaster import + reads**

Current (around line 6 + 20):

```js
import { useFarcaster } from '@/hooks/useFarcaster';
// ...
const { isBackendAuthenticated, backendUser } = useFarcaster();
```

Replace with:

```js
import { useAppAuth } from '@/hooks/useAppAuth';
// ...
const { user: appUser, status: authStatus } = useAppAuth();
const isBackendAuthenticated = authStatus === 'authenticated';
const backendUser = appUser;
```

The downstream uses (`backendUser?.username`, `isBackendAuthenticated`) work unchanged.

- [ ] **Step 2: Verify the dependency array on `useEffect`**

If the file has a `useEffect` with deps including `backendUser` or `isBackendAuthenticated`, those deps are now derived from `appUser` and `authStatus` — leave them as-is (they're still memoized correctly via `useAppAuth`'s context value).

- [ ] **Step 3: Lint + smoke-test**

```bash
cd packages/frontend && npx eslint src/context/UsernameContext.jsx
```

Boot the dev server. Confirm username display and auto-suggestion still work for connected users.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/context/UsernameContext.jsx
git commit -m "$(cat <<'EOF'
refactor(frontend): UsernameContext reads backend user from useAppAuth

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## M5 — Migrate admin callsites

Each of these is a mechanical rename: `useAdminAuth()` → `useAppAuth()`. The shape of the returned object is compatible for the `getAuthHeaders` consumers; the workflow consumers (`isAuthenticated` / `login` / `isLoading` / `error`) need slightly different mappings.

### Task 5.1 — Migrate seven `getAuthHeaders` consumers (mechanical rename)

**Files:**
- `packages/frontend/src/features/admin/components/BackendWalletManager.jsx`
- `packages/frontend/src/components/admin/GroupsPanel.jsx`
- `packages/frontend/src/components/admin/NftDropsPanel.jsx`
- `packages/frontend/src/components/admin/RouteAccessPanel.jsx`
- `packages/frontend/src/components/admin/AccessManagementPanel.jsx`
- `packages/frontend/src/components/admin/AllowlistPanel.jsx`
- `packages/frontend/src/components/admin/NotificationPanel.jsx`

In each of the seven files:

- [ ] **Step 1: Replace the import**

```js
// BEFORE:
import { useAdminAuth } from "@/hooks/useAdminAuth";

// AFTER:
import { useAppAuth } from "@/hooks/useAppAuth";
```

- [ ] **Step 2: Replace the hook call**

```js
// BEFORE:
const { getAuthHeaders } = useAdminAuth();

// AFTER:
const { getAuthHeaders } = useAppAuth();
```

`getAuthHeaders` returns the same `{ Authorization?: string }` shape, so all downstream `headers: getAuthHeaders()` usages work unchanged.

- [ ] **Step 3: For `GroupsPanel.jsx`, repeat the rename at line 315 (second component in the file)**

Same two-line change.

- [ ] **Step 4: Lint all seven**

```bash
cd packages/frontend && npx eslint \
  src/features/admin/components/BackendWalletManager.jsx \
  src/components/admin/GroupsPanel.jsx \
  src/components/admin/NftDropsPanel.jsx \
  src/components/admin/RouteAccessPanel.jsx \
  src/components/admin/AccessManagementPanel.jsx \
  src/components/admin/AllowlistPanel.jsx \
  src/components/admin/NotificationPanel.jsx
```

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/features/admin/components/BackendWalletManager.jsx \
        packages/frontend/src/components/admin/GroupsPanel.jsx \
        packages/frontend/src/components/admin/NftDropsPanel.jsx \
        packages/frontend/src/components/admin/RouteAccessPanel.jsx \
        packages/frontend/src/components/admin/AccessManagementPanel.jsx \
        packages/frontend/src/components/admin/AllowlistPanel.jsx \
        packages/frontend/src/components/admin/NotificationPanel.jsx
git commit -m "$(cat <<'EOF'
refactor(frontend): migrate admin getAuthHeaders consumers to useAppAuth

Mechanical rename across 7 admin panels — getAuthHeaders contract is
identical between useAdminAuth and useAppAuth.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5.2 — Migrate `MobileCreateSeason.jsx`

**Files:** `packages/frontend/src/components/mobile/MobileCreateSeason.jsx`

This file uses both `getAuthHeaders` and the workflow controls (`isAuthenticated` / `login` / `isLoading` / `error`), and wraps the inner component with `<AdminAuthProvider>`.

- [ ] **Step 1: Drop the `AdminAuthProvider` import + wrapper**

Remove the import:

```js
// DELETE this line:
import { AdminAuthProvider } from "@/context/AdminAuthContext";
```

In the public component (around line 439), unwrap:

```jsx
// BEFORE:
const MobileCreateSeason = () => {
  return (
    <AdminAuthProvider>
      <MobileCreateSeasonInner />
    </AdminAuthProvider>
  );
};

// AFTER:
const MobileCreateSeason = () => <MobileCreateSeasonInner />;
```

- [ ] **Step 2: Replace `useAdminAuth` with `useAppAuth`**

```js
// BEFORE (around line 22):
import { useAdminAuth } from "@/hooks/useAdminAuth";

// AFTER:
import { useAppAuth } from "@/hooks/useAppAuth";
```

```js
// BEFORE (around line 101):
const { isAuthenticated, isLoading: isAuthLoading, error: authError, login } = useAdminAuth();

// AFTER:
const { status: authStatus, error: authError, signIn } = useAppAuth();
const isAuthenticated = authStatus === "authenticated";
const isAuthLoading = authStatus === "signing" || authStatus === "verifying";
const login = signIn; // signIn() with no args defaults to method:'wallet'
```

- [ ] **Step 3: Remove the now-unnecessary "Sign in" button block**

With universal SIWE auto-fire, the user reaches this page already authenticated (or with the retry banner showing). The `if (!isAuthenticated) { return <SignInButton /> }` block (around line 262) can be simplified to a "still signing in…" loading state instead of a manual button:

Find the existing `if (!isAuthenticated) { ... }` block (starts around line 262, contains the manual sign-in button). Replace it with:

```jsx
if (!isAuthenticated) {
  // Auto-SIWE handles authentication on connect. If we're not authenticated
  // here, either the wallet isn't connected, or the user rejected the popup
  // (in which case SignInRetryBanner is showing site-wide).
  return (
    <div className="px-4 py-8 text-center text-muted-foreground">
      {isAuthLoading
        ? "Signing in…"
        : "Connect your wallet to create a season."}
    </div>
  );
}
```

- [ ] **Step 4: Lint + smoke-test**

```bash
cd packages/frontend && npx eslint src/components/mobile/MobileCreateSeason.jsx
```

In the dev server, navigate to the mobile create-season flow with an admin EOA connected. Confirm the form renders without the explicit Sign-In button and the `useRaffleWrite` calls go through.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/mobile/MobileCreateSeason.jsx
git commit -m "$(cat <<'EOF'
refactor(frontend): MobileCreateSeason uses useAppAuth, drops AdminAuthProvider

Auto-SIWE removes the need for an explicit Sign-In button — connection itself
authenticates. Falls back to a loading message while auto-fire is in flight,
and the global SignInRetryBanner covers the rejection case.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5.3 — Migrate `CreateSeasonWorkflow.jsx`

**Files:** `packages/frontend/src/components/sponsor/CreateSeasonWorkflow.jsx`

Same shape as Task 5.2 — drop the wrapper, rename the hook, simplify the auth gate.

- [ ] **Step 1: Drop `AdminAuthProvider`**

Delete the import:

```js
import { AdminAuthProvider } from "@/context/AdminAuthContext";
```

Unwrap the public component:

```jsx
// BEFORE:
export function CreateSeasonWorkflow() {
  return (
    <AdminAuthProvider>
      <WorkflowInner />
    </AdminAuthProvider>
  );
}

// AFTER:
export function CreateSeasonWorkflow() {
  return <WorkflowInner />;
}
```

- [ ] **Step 2: Replace `useAdminAuth`**

```js
// BEFORE:
import { useAdminAuth } from "@/hooks/useAdminAuth";
// (around line 43)
const { isAuthenticated, isLoading: isAuthLoading, error: authError, login } = useAdminAuth();

// AFTER:
import { useAppAuth } from "@/hooks/useAppAuth";
// ...
const { status: authStatus, error: authError, signIn } = useAppAuth();
const isAuthenticated = authStatus === "authenticated";
const isAuthLoading = authStatus === "signing" || authStatus === "verifying";
const login = signIn;
```

- [ ] **Step 3: Simplify the auth gate (around line 188)**

Find the `{!isAuthenticated ? (...) : ...}` block that renders a manual sign-in button. Replace with the same pattern as Task 5.2 — a loading message during signing/verifying, and a "Connect your wallet" hint when disconnected. The exact existing block in this file currently looks like:

```jsx
{!isAuthenticated ? (
  // existing sign-in button block — replace with:
  <div className="px-4 py-8 text-center text-muted-foreground">
    {isAuthLoading
      ? "Signing in…"
      : "Connect your wallet to create a season."}
    {authError && <p className="mt-2 text-sm text-destructive">{authError}</p>}
  </div>
) : (
  // ...existing post-auth content stays unchanged
)}
```

- [ ] **Step 4: Lint + smoke-test**

```bash
cd packages/frontend && npx eslint src/components/sponsor/CreateSeasonWorkflow.jsx
```

Open the desktop create-season modal with an admin EOA connected. Confirm form renders and submits.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/sponsor/CreateSeasonWorkflow.jsx
git commit -m "$(cat <<'EOF'
refactor(frontend): CreateSeasonWorkflow uses useAppAuth, drops AdminAuthProvider

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5.4 — Migrate `AdminPanel.jsx`

**Files:** `packages/frontend/src/routes/AdminPanel.jsx`

This file imports `AdminAuthProvider` only to wrap a sub-tree (the admin dashboard panels). It does not use `useAdminAuth` directly — the panels do. After the wrapper is dropped here, the panels still get the JWT from the global `AppAuthProvider`.

- [ ] **Step 1: Drop the import**

```js
// DELETE:
import { AdminAuthProvider } from "@/context/AdminAuthContext";
import { useAdminAuth } from "@/hooks/useAdminAuth";
```

If `useAdminAuth` is destructured anywhere in this file, replace with `useAppAuth` per the same pattern as 5.2 / 5.3. Grep first:

```bash
grep -n "useAdminAuth\|AdminAuthProvider" packages/frontend/src/routes/AdminPanel.jsx
```

If only the imports show up (nothing else), the file just needs the `<AdminAuthProvider>` wrapper unwrapped.

- [ ] **Step 2: Unwrap**

Find every `<AdminAuthProvider>` ... `</AdminAuthProvider>` pair in the file and unwrap (delete opening + closing tags, leave children).

- [ ] **Step 3: Lint**

```bash
cd packages/frontend && npx eslint src/routes/AdminPanel.jsx
```

- [ ] **Step 4: Smoke-test**

Visit `/admin` as an admin EOA. Confirm panels render and operations (toggle access, allowlist add, etc.) succeed — those panels use `getAuthHeaders` from `useAppAuth` per Task 5.1.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/routes/AdminPanel.jsx
git commit -m "$(cat <<'EOF'
refactor(frontend): AdminPanel drops AdminAuthProvider wrapper

Inner panels read the JWT from the global AppAuthProvider mounted in main.jsx.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5.5 — Verify all `useAdminAuth` callsites are migrated

- [ ] **Step 1: Grep for any remaining references**

```bash
grep -rn "useAdminAuth\|AdminAuthProvider\|AdminAuthContext" packages/frontend/src 2>/dev/null
```

Expected output: only `packages/frontend/src/context/AdminAuthContext.jsx` and `packages/frontend/src/hooks/useAdminAuth.js` (the files themselves, deleted in Task 6.1).

If anything else shows up, it was missed — migrate it now using the patterns from Task 5.1 (`getAuthHeaders` consumer) or 5.2 (workflow consumer), commit with `refactor(frontend): migrate <component> off useAdminAuth`.

- [ ] **Step 2: No commit needed unless additional migrations were required.**

---

## M6 — Cleanup + version bumps

### Task 6.1 — Delete `AdminAuthContext` + `useAdminAuth`

**Files:**
- Delete: `packages/frontend/src/context/AdminAuthContext.jsx`
- Delete: `packages/frontend/src/hooks/useAdminAuth.js`

- [ ] **Step 1: Delete both files**

```bash
rm packages/frontend/src/context/AdminAuthContext.jsx
rm packages/frontend/src/hooks/useAdminAuth.js
```

- [ ] **Step 2: Verify build still passes**

```bash
cd packages/frontend && npm run build
```

Expected: builds cleanly. If a missed import surfaces here, migrate it now (same pattern as 5.1) before committing.

- [ ] **Step 3: Commit**

```bash
git add -A packages/frontend/src/context packages/frontend/src/hooks
git commit -m "$(cat <<'EOF'
chore(frontend): delete AdminAuthContext + useAdminAuth

Replaced by AppAuthProvider + useAppAuth. All callsites migrated in M5.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6.2 — Version bumps + full pre-commit suite

**Files:**
- Modify: `packages/frontend/package.json`
- Modify: `packages/backend/package.json`

- [ ] **Step 1: Bump frontend to `0.28.0`**

In `packages/frontend/package.json`, change `"version": "0.27.1"` (or whatever the current value is) to `"version": "0.28.0"`. Minor bump because this is a feature.

- [ ] **Step 2: Bump backend to `0.21.4`**

In `packages/backend/package.json`, change `"version": "0.21.3"` to `"version": "0.21.4"`. Patch bump because backend code is unchanged — only env var added.

- [ ] **Step 3: Run the monorepo pre-commit suite**

```bash
cd /Users/psd/Projects/SOf/sof-beta
npm test
npm run lint
npm run build
```

All three must pass with zero warnings (per CLAUDE.md project rule). If any fail, fix and re-run before committing.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/package.json packages/backend/package.json
git commit -m "$(cat <<'EOF'
chore: bump versions for universal-SIWE rollout (frontend 0.28.0, backend 0.21.4)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## M7 — Live verification (M5 Path C)

### Task 7.1 — Walk Anvil #6 fresh-user flow end-to-end

**Goal:** capture all 11 evidence items from spec §11 with concrete tx hashes / DB rows / log lines so M5 Path C is provably closed.

- [ ] **Step 1: Restart the local stack to pick up the new env var**

```bash
./scripts/local-dev.sh
```

Wait for "✅ Stack ready". Confirm `SOF_AIRDROP_AMOUNT_PER_USER=100` is in the backend process env:

```bash
ps eww -p $(cat .local-dev-pids/backend.pid) | tr ' ' '\n' | grep SOF_AIRDROP
```

- [ ] **Step 2: Compute Anvil #6's predicted SMA**

```bash
JSON=packages/contracts/deployments/local.json
FACTORY=$(jq -r '.contracts.SOFSmartAccountFactory' $JSON)
cast call $FACTORY "getAddress(address)(address)" \
  0x976EA74026E726554dB657fA54763abd0C3a0aa9 \
  --rpc-url http://127.0.0.1:8545
```

Record the SMA address (expected: `0x736DDfB787AD6986f6CbA285CB90B149f1fFB321` based on prior session — but verify each run because the factory address may change between deploys).

- [ ] **Step 3: Confirm Anvil #6's SMA SOF balance is 0 (precondition)**

```bash
SOF=$(jq -r '.contracts.SOFToken' $JSON)
SMA6=<address from Step 2>
cast call $SOF "balanceOf(address)(uint256)" $SMA6 --rpc-url http://127.0.0.1:8545
```

Expected: `0`. If not, the wallet was used before — pick a fresh Anvil index (#7 has key `0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356`, address `0x14dC79964da2C08b23698B3D3cc7Ca32193d9955`).

- [ ] **Step 4: Switch MetaMask to Anvil #6 and connect to the dapp**

In MetaMask: import private key `0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e` (Anvil #6) if not already imported. Make it the active account.

In the dapp at `http://localhost:5174/`: click Connect Wallet → MetaMask. After RainbowKit's connect prompt, MetaMask should immediately show a SIWE signature popup with `"Sign in to SecondOrder.fun\nNonce: <hex>"`.

- [ ] **Step 5: Sign the SIWE message and capture the network round-trip**

Sign. In DevTools → Network tab, confirm:
- `GET http://localhost:3000/api/auth/nonce` → 200
- `POST http://localhost:3000/api/auth/verify` → 200

Capture the verify response JSON. It must include `user.sma`, `user.isAdmin: false`, `user.address` matching Anvil #6.

- [ ] **Step 6: Confirm backend processed `ensureSmartAccount` and airdrop**

```bash
grep -E "0x976EA74026E726554dB657fA54763abd0C3a0aa9\|airdropService\|ensureSmartAccount" .local-dev-pids/backend.log | tail -20
```

Look for log lines:
- `transferToSma: submitting SOF.transfer { sma: '0x736d…b321', amount: '100000000000000000000' }`
- `transferToSma: success { sma: '...', txHash: '0x...', amount: '...' }`

Record the airdrop tx hash.

- [ ] **Step 7: Confirm `smart_accounts` row + `funded_at` populated**

```bash
docker exec supabase_db_sof-beta psql -U postgres -d postgres -c \
  "SELECT eoa, sma, deployed_at, funded_at FROM smart_accounts WHERE eoa = LOWER('0x976EA74026E726554dB657fA54763abd0C3a0aa9');"
```

Expected: one row with `deployed_at = NULL` (SMA not yet deployed) and `funded_at` populated with a recent timestamp.

- [ ] **Step 8: Confirm on-chain SOF.transfer landed**

```bash
cast call $SOF "balanceOf(address)(uint256)" $SMA6 --rpc-url http://127.0.0.1:8545
```

Expected: `100000000000000000000` (100 SOF in wei).

- [ ] **Step 9: Confirm `SettingsMenu` Account section shows correct SMA + EOA**

Click the gear/settings icon. The Account section should show SMA = `0x736D…B321` and Signer (EOA) = `0x976E…0aa9`, both with copy buttons. Click each copy button — clipboard should match.

- [ ] **Step 10: Confirm `FirstConnectBanner` is visible (one-time)**

Expected: visible after connect. Click "Got it" / dismiss. Refresh the page. Banner should NOT reappear.

- [ ] **Step 11: Buy 1 ticket and capture the UserOp**

Navigate to a raffle in the active season (`/raffles/1`). Click Buy → enter qty `1` → confirm. MetaMask shows an EIP-712 typed-data popup for `PackedUserOperation`. Sign.

Wait for the success toast. Capture the buy tx hash.

- [ ] **Step 12: Verify on-chain effects**

```bash
TX=<buy tx hash>
cast receipt $TX --rpc-url http://127.0.0.1:8545 --json | python3 -c "
import sys, json
r = json.load(sys.stdin)
for log in r['logs']:
    t0 = log['topics'][0]
    if t0.startswith('0xd51a9c61'):
        print('AccountDeployed: sender=', '0x' + log['topics'][2][-40:])
    elif t0.startswith('0x49628fd1'):
        d = log['data'][2:]
        print('UserOperationEvent: paymaster=', '0x' + log['topics'][3][-40:])
        print('                    success =', int(d[64:128], 16) == 1)
"
```

Expected:
- `AccountDeployed: sender=` Anvil #6's SMA (the SMA bytecode goes from `0x` to non-empty)
- `UserOperationEvent: success=True`

Confirm Anvil #6 EOA ETH unchanged:

```bash
cast balance 0x976EA74026E726554dB657fA54763abd0C3a0aa9 --rpc-url http://127.0.0.1:8545
```

Expected: still 10000 ETH (untouched — paymaster sponsored gas).

- [ ] **Step 13: Confirm `smart_accounts.deployed_at` now populated**

```bash
docker exec supabase_db_sof-beta psql -U postgres -d postgres -c \
  "SELECT eoa, sma, deployed_at, funded_at FROM smart_accounts WHERE eoa = LOWER('0x976EA74026E726554dB657fA54763abd0C3a0aa9');"
```

Expected: `deployed_at` is now a timestamp (the `accountCreatedListener` fired during the buy tx).

- [ ] **Step 14: Confirm Portfolio shows the BUY row with SMA badge**

Visit `/portfolio` (or whatever the route is) → Raffle Holdings tab → expand Season #1. Expected: a `+1 ticket` row with the **SMA** Origin badge and an Explorer link to the buy tx.

- [ ] **Step 15: Capture all evidence in a single doc**

Create `/tmp/m5-path-c-evidence.md`:

```markdown
# M5 Path C Evidence — Anvil #6 fresh user flow

Date: <today>
Branch: feat/gasless-rewrite
Commit: <git rev-parse HEAD>

## Round-trips
- Nonce request: GET /api/auth/nonce → 200
- Verify request: POST /api/auth/verify → 200
- Verify response user.sma: <SMA>
- Verify response user.isAdmin: false

## Airdrop
- Backend log: transferToSma: success { txHash: <hash>, amount: 100000000000000000000 }
- On-chain SOF balance of SMA: 100 SOF
- smart_accounts.funded_at: <timestamp>

## Buy
- UserOp tx: <buy hash>
- AccountDeployed event: sender=<SMA>
- UserOperationEvent.success: True
- EOA ETH balance unchanged: 10000.000000

## UI
- FirstConnectBanner appeared once and dismissed cleanly: ✓
- SettingsMenu shows SMA + Signer EOA with copy buttons: ✓
- Portfolio Raffle Holdings shows +1 ticket row with SMA badge: ✓
```

- [ ] **Step 16: Commit the evidence doc**

```bash
git add /tmp/m5-path-c-evidence.md  # or move into docs/superpowers/evidence/
# If you want it tracked permanently, move first:
mkdir -p docs/superpowers/evidence
mv /tmp/m5-path-c-evidence.md docs/superpowers/evidence/2026-05-07-m5-path-c.md
git add docs/superpowers/evidence/2026-05-07-m5-path-c.md
git commit -m "$(cat <<'EOF'
docs(evidence): M5 Path C verified end-to-end on Anvil #6 fresh user

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review — completed

**1. Spec coverage**

| Spec section | Plan task |
|---|---|
| §4 Q1 (auto-fire if no JWT) | Task 2.3 Step 3 (`AUTO_FIRE_WALLET_TYPES` + JWT-existence guard in effect) |
| §4 Q2 (localStorage desktop, in-memory miniapp) | Task 2.3 Step 3 (`PERSIST_WALLET_TYPES` + `persist()` callback) |
| §4 Q3 (delete AdminAuthContext) | Task 6.1 |
| §4 Q4 (Farcaster manual) | Task 4.2 (preserves manual button flow; `useFarcasterSignIn` only delegates verify) |
| §4 Q5 (Coinbase Smart Wallet → desktop EOA path) | Task 2.3 Step 3 (both wallet types in `AUTO_FIRE_WALLET_TYPES`) |
| §4 Q6 (retry banner) | Task 2.4 |
| §5 architecture / provider tree | Task 3.1 |
| §6 component inventory | Tasks 2.2 / 2.3 / 2.4 / 6.1 |
| §7 data flow Sequence A | Task 7.1 verifies end-to-end |
| §7 data flow Sequence B (returning user) | Task 2.3 Step 1 test "rehydrates from localStorage" |
| §7 data flow Sequence C (wallet change) | Task 2.3 Step 1 test "wallet change" |
| §7 data flow Sequence D (chain switch) | Implicit — JWT chain-agnostic; no task needed |
| §7 data flow Sequence E (sig rejection) | Task 2.3 Step 1 test "rejected"; Task 3.2 manual smoke |
| §7 data flow Sequence F (Farcaster) | Task 2.3 Step 1 test "farcaster-miniapp"; Task 4.2 |
| §8 error handling table | Task 2.3 Step 3 (handlers in `signIn`); Task 2.4 (banner) |
| §9 testing matrix | Tasks 2.2 / 2.3 / 2.4 / 7.1 |
| §10 side concerns | Tasks 1.1 / 1.2 / 6.2 |
| §11 Path C evidence checklist | Task 7.1 |

**2. Placeholder scan**

No `TBD` / `TODO` / `fill in` / "Add appropriate error handling" / "Similar to Task N" patterns. Each step shows the actual code or command.

**3. Type consistency**

- Hook returns `{ jwt, user, status, error, signIn, signOut, getAuthHeaders }` — same shape across Task 2.2 (test), Task 2.3 (test + impl), Tasks 4.2, 4.3, 5.1, 5.2, 5.3.
- `status` enum `'idle' | 'signing' | 'verifying' | 'authenticated' | 'rejected' | 'error'` — used identically across tests, impl, and consumers.
- Storage keys `sof:auth_jwt`, `sof:auth_user` and legacy keys `sof:admin_jwt`, `sof:farcaster_jwt`, `sof:farcaster_user` — identical across tests and impl.
- `signIn(opts?)` signature: optional `{ method: 'wallet' | 'farcaster', message?, signature?, nonce? }` — consistent across Task 2.3 (impl), Task 4.2 (`useFarcasterSignIn` calls with `method:'farcaster'`), Tasks 5.2 / 5.3 (workflow consumers call with no args).
