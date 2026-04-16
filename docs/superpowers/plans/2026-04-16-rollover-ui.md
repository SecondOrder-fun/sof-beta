# Rollover UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build frontend components that let users claim consolation to rollover, buy tickets from rollover balance with bonus, view rollover status in portfolio, and see rollover transactions tagged distinctly.

**Architecture:** One shared hook (`useRollover`) reads escrow contract state and builds transactions. Four existing components are modified: ClaimCenterRaffles (claim toggle), BuySellWidget (rollover banner), ProfileContent (portfolio card), SOFTransactionHistory (badge). Backend gets a new event listener + API endpoint.

**Tech Stack:** React, Vitest, React Testing Library, TanStack React Query, viem, wagmi, Tailwind CSS, react-i18next

**Spec:** `docs/superpowers/specs/2026-04-16-rollover-ui-design.md`

---

## File Structure

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `packages/frontend/src/hooks/useRollover.js` | Shared hook: escrow reads + transaction mutations |
| Create | `packages/frontend/src/services/onchainRolloverEscrow.js` | Contract read helpers + call builders |
| Create | `packages/frontend/src/components/user/RolloverPortfolioCard.jsx` | Portfolio rollover balance card |
| Create | `packages/frontend/tests/hooks/useRollover.test.js` | Hook unit tests |
| Create | `packages/frontend/tests/components/RolloverPortfolioCard.test.jsx` | Portfolio card tests |
| Modify | `packages/frontend/src/config/contracts.js:63-89` | Add ROLLOVER_ESCROW address |
| Modify | `packages/frontend/src/services/onchainRaffleDistributor.js:69-82` | Update buildClaimConsolationCall for toRollover param |
| Modify | `packages/frontend/src/components/infofi/claim/ClaimCenterRaffles.jsx:42-107` | Rollover-default claim toggle |
| Modify | `packages/frontend/src/components/curve/BuySellWidget.jsx` | Rollover banner on buy tab |
| Modify | `packages/frontend/src/components/mobile/BuySellSheet.jsx` | Rollover banner on mobile buy |
| Modify | `packages/frontend/src/components/user/SOFTransactionHistory.jsx:299-321` | ROLLOVER badge type |
| Modify | `packages/frontend/src/hooks/useSOFTransactions.js` | Index RolloverSpend events |
| Modify | `packages/frontend/src/components/account/ProfileContent.jsx:119-152` | Add rollover tab/card |
| Modify | `packages/frontend/public/locales/en/raffle.json` | Rollover i18n keys |
| Modify | `packages/frontend/public/locales/en/account.json` | Portfolio rollover i18n keys |
| Create | `packages/backend/src/listeners/rolloverEventListener.js` | Index rollover events |
| Create | `packages/backend/fastify/routes/rolloverRoutes.js` | GET /api/rollover/positions |
| Modify | `packages/backend/fastify/server.js` | Register rollover listener + routes |

---

### Task 1: Contract Address Config + Service Layer

Add RolloverEscrow to the frontend contract config and create the on-chain service for reading escrow state and building transaction calls.

**Files:**
- Modify: `packages/frontend/src/config/contracts.js:63-89`
- Create: `packages/frontend/src/services/onchainRolloverEscrow.js`
- Modify: `packages/frontend/src/services/onchainRaffleDistributor.js:69-82`

- [ ] **Step 1: Add ROLLOVER_ESCROW to contracts.js**

In `packages/frontend/src/config/contracts.js`, add after the `SOF_SMART_ACCOUNT` line (line 87):

```javascript
ROLLOVER_ESCROW: s(deployment.RolloverEscrow),
```

- [ ] **Step 2: Update buildClaimConsolationCall to accept toRollover**

In `packages/frontend/src/services/onchainRaffleDistributor.js`, modify the `buildClaimConsolationCall` function (around line 69):

```javascript
export async function buildClaimConsolationCall({
  seasonId,
  toRollover = false,
  networkKey = getStoredNetworkKey(),
}) {
  const distributor = await getPrizeDistributor({ networkKey });
  return {
    to: distributor,
    data: encodeFunctionData({
      abi: RafflePrizeDistributorAbi,
      functionName: "claimConsolation",
      args: [BigInt(seasonId), toRollover],
    }),
  };
}
```

Also update the existing call site in `claimService.js` (line 34) to pass `toRollover: false` explicitly:

```javascript
case "raffle-consolation": {
  const call = await buildClaimConsolationCall({
    seasonId: params.seasonId,
    toRollover: params.toRollover ?? false,
    networkKey,
  });
  return { calls: [call], error: null };
}
```

- [ ] **Step 3: Create onchainRolloverEscrow.js**

Create `packages/frontend/src/services/onchainRolloverEscrow.js`:

```javascript
import { encodeFunctionData } from "viem";
import { RolloverEscrowABI } from "@sof/contracts";
import { getContractAddresses } from "@/config/contracts";
import { getStoredNetworkKey } from "@/lib/wagmi";

export function getRolloverEscrowAddress(networkKey = getStoredNetworkKey()) {
  return getContractAddresses(networkKey).ROLLOVER_ESCROW;
}

export async function readUserPosition({ publicClient, seasonId, address, networkKey }) {
  const escrow = getRolloverEscrowAddress(networkKey);
  if (!escrow) return null;

  const [deposited, spent, refunded] = await publicClient.readContract({
    address: escrow,
    abi: RolloverEscrowABI,
    functionName: "getUserPosition",
    args: [BigInt(seasonId), address],
  });

  return { deposited, spent, refunded };
}

export async function readCohortState({ publicClient, seasonId, networkKey }) {
  const escrow = getRolloverEscrowAddress(networkKey);
  if (!escrow) return null;

  const [phase, nextSeasonId, bonusBps, totalDeposited, totalSpent, totalBonusPaid, openedAt, isExpired] =
    await publicClient.readContract({
      address: escrow,
      abi: RolloverEscrowABI,
      functionName: "getCohortState",
      args: [BigInt(seasonId)],
    });

  const phaseNames = ["none", "open", "active", "closed", "expired"];

  return {
    phase: isExpired ? "expired" : phaseNames[Number(phase)] || "none",
    nextSeasonId,
    bonusBps,
    totalDeposited,
    totalSpent,
    totalBonusPaid,
    openedAt,
  };
}

export async function readAvailableBalance({ publicClient, seasonId, address, networkKey }) {
  const escrow = getRolloverEscrowAddress(networkKey);
  if (!escrow) return 0n;

  return publicClient.readContract({
    address: escrow,
    abi: RolloverEscrowABI,
    functionName: "getAvailableBalance",
    args: [BigInt(seasonId), address],
  });
}

export async function readBonusAmount({ publicClient, seasonId, amount, networkKey }) {
  const escrow = getRolloverEscrowAddress(networkKey);
  if (!escrow) return 0n;

  return publicClient.readContract({
    address: escrow,
    abi: RolloverEscrowABI,
    functionName: "getBonusAmount",
    args: [BigInt(seasonId), amount],
  });
}

export function buildSpendFromRolloverCall({ seasonId, sofAmount, ticketAmount, maxSof, networkKey }) {
  const escrow = getRolloverEscrowAddress(networkKey);
  return {
    to: escrow,
    data: encodeFunctionData({
      abi: RolloverEscrowABI,
      functionName: "spendFromRollover",
      args: [BigInt(seasonId), sofAmount, ticketAmount, maxSof],
    }),
  };
}

export function buildRefundCall({ seasonId, networkKey }) {
  const escrow = getRolloverEscrowAddress(networkKey);
  return {
    to: escrow,
    data: encodeFunctionData({
      abi: RolloverEscrowABI,
      functionName: "refund",
      args: [BigInt(seasonId)],
    }),
  };
}
```

- [ ] **Step 4: Run build to verify imports**

Run: `cd packages/frontend && npm run build 2>&1 | head -20`
Expected: No import errors for RolloverEscrowABI or ROLLOVER_ESCROW.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/config/contracts.js packages/frontend/src/services/onchainRolloverEscrow.js packages/frontend/src/services/onchainRaffleDistributor.js packages/frontend/src/services/claimService.js
git commit -m "feat(frontend): add RolloverEscrow service layer and contract config"
```

---

### Task 2: useRollover Hook

The shared hook that all UI components consume.

**Files:**
- Create: `packages/frontend/src/hooks/useRollover.js`
- Create: `packages/frontend/tests/hooks/useRollover.test.js`

- [ ] **Step 1: Write the test file**

Create `packages/frontend/tests/hooks/useRollover.test.js`:

```javascript
/*
  @vitest-environment jsdom
*/
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// Mock wagmi
vi.mock("wagmi", () => ({
  useAccount: () => ({
    address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    isConnected: true,
  }),
  usePublicClient: () => mockPublicClient,
}));

// Mock i18n
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key) => key, i18n: { language: "en" } }),
}));

// Mock smart transactions
vi.mock("@/hooks/useSmartTransactions", () => ({
  useSmartTransactions: () => ({
    executeBatch: vi.fn().mockResolvedValue("0xbatch123"),
  }),
}));

// Mock config
vi.mock("@/config/contracts", () => ({
  getContractAddresses: () => ({
    ROLLOVER_ESCROW: "0xEscrow",
    PRIZE_DISTRIBUTOR: "0xDistributor",
  }),
}));

vi.mock("@/lib/wagmi", () => ({
  getStoredNetworkKey: () => "LOCAL",
}));

// Mock publicClient
const mockPublicClient = {
  readContract: vi.fn(),
};

// Import after mocks
import { useRollover } from "@/hooks/useRollover";

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }) => React.createElement(QueryClientProvider, { client: qc }, children);
}

describe("useRollover", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns rollover state when user has a position", async () => {
    // getUserPosition returns (deposited, spent, refunded)
    mockPublicClient.readContract
      .mockResolvedValueOnce([175000000000000000000n, 0n, false]) // getUserPosition
      .mockResolvedValueOnce([2, 2n, 600, 175000000000000000000n, 0n, 0n, 1713300000n, false]) // getCohortState
      .mockResolvedValueOnce(175000000000000000000n); // getAvailableBalance

    const { result } = renderHook(() => useRollover(1), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.rolloverDeposited).toBe(175000000000000000000n);
    expect(result.current.rolloverBalance).toBe(175000000000000000000n);
    expect(result.current.cohortPhase).toBe("active");
    expect(result.current.bonusBps).toBe(600);
    expect(result.current.isRolloverAvailable).toBe(true);
  });

  it("returns unavailable when no position exists", async () => {
    mockPublicClient.readContract
      .mockResolvedValueOnce([0n, 0n, false]) // getUserPosition
      .mockResolvedValueOnce([0, 0n, 0, 0n, 0n, 0n, 0n, false]) // getCohortState
      .mockResolvedValueOnce(0n); // getAvailableBalance

    const { result } = renderHook(() => useRollover(1), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isRolloverAvailable).toBe(false);
    expect(result.current.rolloverBalance).toBe(0n);
  });

  it("computes bonusAmount correctly", async () => {
    mockPublicClient.readContract
      .mockResolvedValueOnce([100000000000000000000n, 0n, false])
      .mockResolvedValueOnce([2, 2n, 600, 100000000000000000000n, 0n, 0n, 1713300000n, false])
      .mockResolvedValueOnce(100000000000000000000n);

    const { result } = renderHook(() => useRollover(1), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // 100 SOF * 600 / 10000 = 6 SOF
    const bonus = result.current.bonusAmount(100000000000000000000n);
    expect(bonus).toBe(6000000000000000000n);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/frontend && npx vitest run tests/hooks/useRollover.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Create useRollover hook**

Create `packages/frontend/src/hooks/useRollover.js`:

```javascript
import { useCallback } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useSmartTransactions } from "./useSmartTransactions";
import { getStoredNetworkKey } from "@/lib/wagmi";
import { getContractAddresses } from "@/config/contracts";
import {
  readUserPosition,
  readCohortState,
  readAvailableBalance,
  buildSpendFromRolloverCall,
  buildRefundCall,
} from "@/services/onchainRolloverEscrow";
import { buildClaimConsolationCall } from "@/services/onchainRaffleDistributor";
import { useToast } from "@/hooks/use-toast";

export function useRollover(seasonId) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { executeBatch } = useSmartTransactions();
  const qc = useQueryClient();
  const { t } = useTranslation(["raffle", "common"]);
  const { toast } = useToast();
  const netKey = getStoredNetworkKey();
  const contracts = getContractAddresses(netKey);

  // --- Read state ---
  const queryKey = ["rollover", address, seasonId, netKey];

  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!address || !publicClient || !seasonId) return null;

      const [position, cohort, available] = await Promise.all([
        readUserPosition({ publicClient, seasonId, address, networkKey: netKey }),
        readCohortState({ publicClient, seasonId, networkKey: netKey }),
        readAvailableBalance({ publicClient, seasonId, address, networkKey: netKey }),
      ]);

      return { position, cohort, available };
    },
    enabled: Boolean(address && publicClient && seasonId && contracts.ROLLOVER_ESCROW),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  // --- Computed ---
  const position = data?.position;
  const cohort = data?.cohort;

  const rolloverDeposited = position?.deposited ?? 0n;
  const rolloverSpent = position?.spent ?? 0n;
  const isRefunded = position?.refunded ?? false;
  const rolloverBalance = data?.available ?? 0n;

  const cohortPhase = cohort?.phase ?? "none";
  const bonusBps = cohort?.bonusBps ?? 0;
  const nextSeasonId = cohort?.nextSeasonId ?? 0n;

  const isRolloverAvailable = rolloverBalance > 0n && cohortPhase === "active";
  const hasClaimableRollover = cohortPhase === "open";
  const bonusPercent = `${Number(bonusBps) / 100}%`;

  const bonusAmount = useCallback(
    (sofAmount) => (sofAmount * BigInt(bonusBps)) / 10000n,
    [bonusBps]
  );

  // --- Mutations ---
  const claimToRollover = useMutation({
    mutationFn: async ({ seasonId: sid }) => {
      const call = await buildClaimConsolationCall({
        seasonId: sid,
        toRollover: true,
        networkKey: netKey,
      });
      return executeBatch([call]);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["raffle_claims"] });
      qc.invalidateQueries({ queryKey: ["sofBalance"] });
      qc.invalidateQueries({ queryKey });
      toast({ title: t("raffle:rolloverSuccess", { defaultValue: "Rollover confirmed" }) });
    },
    onError: (err) => {
      toast({ title: t("common:error"), description: err.message, variant: "destructive" });
    },
  });

  const spendFromRollover = useMutation({
    mutationFn: async ({ seasonId: sid, sofAmount, ticketAmount, maxSof }) => {
      const call = buildSpendFromRolloverCall({
        seasonId: sid,
        sofAmount,
        ticketAmount,
        maxSof,
        networkKey: netKey,
      });
      return executeBatch([call]);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      qc.invalidateQueries({ queryKey: ["sofBalance"] });
      qc.invalidateQueries({ queryKey: ["sofTransactions"] });
    },
    onError: (err) => {
      toast({ title: t("common:error"), description: err.message, variant: "destructive" });
    },
  });

  const refundRollover = useMutation({
    mutationFn: async ({ seasonId: sid }) => {
      const call = buildRefundCall({ seasonId: sid, networkKey: netKey });
      return executeBatch([call]);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      qc.invalidateQueries({ queryKey: ["sofBalance"] });
      toast({ title: t("raffle:refundSuccess", { defaultValue: "Refund confirmed" }) });
    },
    onError: (err) => {
      toast({ title: t("common:error"), description: err.message, variant: "destructive" });
    },
  });

  return {
    // State
    rolloverBalance,
    rolloverDeposited,
    rolloverSpent,
    isRefunded,
    cohortPhase,
    bonusBps,
    nextSeasonId,

    // Computed
    bonusAmount,
    isRolloverAvailable,
    hasClaimableRollover,
    bonusPercent,

    // Mutations
    claimToRollover,
    spendFromRollover,
    refundRollover,

    // Loading
    isLoading,
    error,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/frontend && npx vitest run tests/hooks/useRollover.test.js`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/hooks/useRollover.js packages/frontend/tests/hooks/useRollover.test.js
git commit -m "feat(frontend): add useRollover hook with escrow reads and mutations"
```

---

### Task 3: i18n Keys

Add all rollover translation keys before the UI components need them.

**Files:**
- Modify: `packages/frontend/public/locales/en/raffle.json`
- Modify: `packages/frontend/public/locales/en/account.json`

- [ ] **Step 1: Add raffle rollover keys**

In `packages/frontend/public/locales/en/raffle.json`, add:

```json
"rolloverToNextSeason": "Rollover to Next Season",
"earnBonusPercent": "Earn +{{percent}}% bonus",
"rolloverAmount": "Rollover {{amount}} SOF",
"claimToWalletInstead": "Claim to wallet instead",
"rolloverAvailable": "Rollover Available",
"rolloverFromSeason": "{{amount}} SOF from Season {{season}}",
"bonusLabel": "+{{percent}}% bonus",
"adjust": "Adjust",
"useOfRollover": "Use {{used}} of {{total}} SOF from rollover",
"fromRollover": "From rollover",
"fromWallet": "From wallet",
"bonusPercent": "Bonus ({{percent}}%)",
"totalTicketValue": "Total ticket value",
"rolloverSuccess": "Rollover confirmed",
"refundSuccess": "Refund confirmed",
"rolloverBuy": "Rollover Buy"
```

- [ ] **Step 2: Add account rollover keys**

In `packages/frontend/public/locales/en/account.json`, add:

```json
"rolloverBalance": "Rollover Balance",
"fromSeason": "From Season {{season}}",
"rolloverBonusRate": "+{{percent}}% bonus",
"buyTicketsInSeason": "Buy Tickets in Season {{season}} →",
"refundToWallet": "Refund to Wallet",
"rolloverPending": "Pending",
"rolloverReady": "Ready",
"rolloverClosed": "Closed",
"rolloverExpired": "Expired"
```

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/public/locales/en/raffle.json packages/frontend/public/locales/en/account.json
git commit -m "feat(frontend): add rollover i18n keys"
```

---

### Task 4: Claim Toggle (ClaimCenterRaffles)

Modify the consolation claim card to default to rollover when available.

**Files:**
- Modify: `packages/frontend/src/components/infofi/claim/ClaimCenterRaffles.jsx:42-107`

- [ ] **Step 1: Write the test**

Create `packages/frontend/tests/components/ClaimCenterRaffles.rollover.test.jsx`:

```javascript
/*
  @vitest-environment jsdom
*/
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key, opts) => opts?.defaultValue || key, i18n: { language: "en" } }),
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: "0x1234", isConnected: true }),
  usePublicClient: () => ({}),
}));

const mockClaimToRollover = { mutate: vi.fn(), isPending: false };
const mockClaimConsolation = { mutate: vi.fn(), isPending: false };

vi.mock("@/hooks/useRollover", () => ({
  useRollover: () => ({
    hasClaimableRollover: true,
    bonusPercent: "6%",
    bonusBps: 600,
    bonusAmount: (amt) => (amt * 600n) / 10000n,
    claimToRollover: mockClaimToRollover,
    isLoading: false,
  }),
}));

vi.mock("@/hooks/useClaims", () => ({
  useClaims: () => ({
    claimRaffleConsolation: mockClaimConsolation,
    claimRaffleGrand: { mutate: vi.fn() },
    pendingClaims: new Set(),
    successfulClaims: new Set(),
    getClaimKey: (type, params) => `${type}-${params.seasonId}`,
  }),
}));

vi.mock("@/config/contracts", () => ({ getContractAddresses: () => ({}) }));
vi.mock("@/lib/wagmi", () => ({ getStoredNetworkKey: () => "LOCAL" }));
vi.mock("@/hooks/useSmartTransactions", () => ({
  useSmartTransactions: () => ({ executeBatch: vi.fn() }),
}));

import ClaimCenterRaffles from "@/components/infofi/claim/ClaimCenterRaffles";

function wrap(ui) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, ui);
}

describe("ClaimCenterRaffles rollover", () => {
  const mockData = [
    {
      seasonId: 1n,
      type: "consolation",
      amount: 175000000000000000000n,
      isGrand: false,
    },
  ];

  it("shows rollover as primary action when cohort is open", () => {
    render(
      wrap(
        React.createElement(ClaimCenterRaffles, {
          raffleClaimsData: mockData,
        })
      )
    );

    expect(screen.getByText(/raffle:rolloverAmount/)).toBeTruthy();
    expect(screen.getByText(/raffle:claimToWalletInstead/)).toBeTruthy();
  });

  it("calls claimToRollover when rollover button clicked", () => {
    render(
      wrap(
        React.createElement(ClaimCenterRaffles, {
          raffleClaimsData: mockData,
        })
      )
    );

    const rolloverBtn = screen.getByText(/raffle:rolloverAmount/);
    fireEvent.click(rolloverBtn);
    expect(mockClaimToRollover.mutate).toHaveBeenCalledWith({ seasonId: 1n });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/frontend && npx vitest run tests/components/ClaimCenterRaffles.rollover.test.jsx`
Expected: FAIL — rollover elements not rendered.

- [ ] **Step 3: Modify ClaimCenterRaffles.jsx**

In `packages/frontend/src/components/infofi/claim/ClaimCenterRaffles.jsx`:

Add imports at top:
```javascript
import { useRollover } from "@/hooks/useRollover";
import { formatUnits } from "viem";
```

Replace the consolation claim card rendering (approximately lines 80-104). For each non-grand claim row, when `hasClaimableRollover` is true, render the rollover-default layout:

```jsx
{!row.isGrand && hasClaimableRollover ? (
  <div className="mt-2 space-y-2">
    {/* Rollover highlight box */}
    <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-emerald-500 font-semibold text-sm">
            {t("raffle:rolloverToNextSeason")}
          </div>
          <div className="text-muted-foreground text-xs">
            {t("raffle:earnBonusPercent", { percent: Number(bonusBps) / 100 })}
          </div>
        </div>
        <div className="text-emerald-500 text-sm font-bold">
          +{formatUnits(bonusAmount(row.amount ?? 0n), 18)} SOF
        </div>
      </div>
    </div>
    {/* Primary rollover button */}
    <Button
      onClick={() => claimToRollover.mutate({ seasonId: row.seasonId })}
      disabled={isThisPending}
      className="w-full bg-emerald-600 hover:bg-emerald-700"
    >
      {isThisPending
        ? t("transactions:claimInProgress", { defaultValue: "Claim in Progress..." })
        : t("raffle:rolloverAmount", { amount: formatUnits(row.amount ?? 0n, 18) })}
    </Button>
    {/* Secondary wallet link */}
    <div className="text-center">
      <button
        onClick={() => claimRaffleConsolation.mutate({ seasonId: row.seasonId })}
        className="text-muted-foreground text-sm underline hover:text-foreground"
        disabled={isThisPending}
      >
        {t("raffle:claimToWalletInstead")}
      </button>
    </div>
  </div>
) : (
  /* Existing non-rollover claim button */
  <Button
    onClick={() => {
      if (row.isGrand) {
        claimRaffleGrand.mutate({ seasonId: row.seasonId });
      } else {
        claimRaffleConsolation.mutate({ seasonId: row.seasonId });
      }
    }}
    disabled={isThisPending}
    className="w-full"
  >
    {isThisPending
      ? t("transactions:claimInProgress", { defaultValue: "Claim in Progress..." })
      : t("raffle:claimPrize")}
  </Button>
)}
```

The `useRollover` hook is called at the component level with the first consolation claim's seasonId. Extract `hasClaimableRollover`, `bonusBps`, `bonusAmount`, and `claimToRollover` from it.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/frontend && npx vitest run tests/components/ClaimCenterRaffles.rollover.test.jsx`
Expected: PASS.

- [ ] **Step 5: Run full frontend test suite**

Run: `cd packages/frontend && npm test`
Expected: All tests pass (existing + new).

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/components/infofi/claim/ClaimCenterRaffles.jsx packages/frontend/tests/components/ClaimCenterRaffles.rollover.test.jsx
git commit -m "feat(frontend): add rollover-default claim toggle to ClaimCenterRaffles"
```

---

### Task 5: Buy Widget Rollover Banner

Add the rollover banner with toggle, auto-deplete, and adjust option to the buy tab.

**Files:**
- Modify: `packages/frontend/src/components/curve/BuySellWidget.jsx`
- Modify: `packages/frontend/src/components/mobile/BuySellSheet.jsx`

- [ ] **Step 1: Create RolloverBanner sub-component**

Create `packages/frontend/src/components/curve/RolloverBanner.jsx`:

```jsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { formatUnits, parseUnits } from "viem";
import { Switch } from "@/components/ui/switch";

export default function RolloverBanner({
  rolloverBalance,
  bonusBps,
  bonusAmount,
  sourceSeasonId,
  estimatedCost,
  enabled,
  onEnabledChange,
  rolloverAmount,
  onRolloverAmountChange,
}) {
  const { t } = useTranslation(["raffle"]);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const bonusPercent = Number(bonusBps) / 100;
  const balanceFormatted = formatUnits(rolloverBalance, 18);
  const rolloverFormatted = formatUnits(rolloverAmount, 18);
  const bonusFormatted = formatUnits(bonusAmount(rolloverAmount), 18);

  return (
    <div
      className={`rounded-lg border p-3 mb-3 transition-colors ${
        enabled
          ? "bg-emerald-500/10 border-emerald-500/25"
          : "bg-muted/30 border-border"
      }`}
    >
      <div className="flex items-center justify-between">
        <div>
          <div className={`font-semibold text-sm ${enabled ? "text-emerald-500" : "text-muted-foreground"}`}>
            {t("raffle:rolloverAvailable")}
          </div>
          <div className="text-muted-foreground text-xs">
            {t("raffle:rolloverFromSeason", {
              amount: balanceFormatted,
              season: String(sourceSeasonId),
            })}{" "}
            · {t("raffle:bonusLabel", { percent: bonusPercent })}
          </div>
        </div>
        <Switch checked={enabled} onCheckedChange={onEnabledChange} />
      </div>

      {enabled && (
        <div className="mt-2">
          {!adjustOpen ? (
            <button
              onClick={() => setAdjustOpen(true)}
              className="text-xs text-muted-foreground underline hover:text-foreground"
            >
              {t("raffle:adjust")}
            </button>
          ) : (
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs text-muted-foreground">{t("raffle:adjust")}:</span>
              <input
                type="number"
                value={rolloverFormatted}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === "" || isNaN(Number(val))) return;
                  const parsed = parseUnits(val, 18);
                  const clamped = parsed > rolloverBalance ? rolloverBalance : parsed;
                  onRolloverAmountChange(clamped);
                }}
                className="w-24 bg-background border border-border rounded px-2 py-1 text-sm"
                min="0"
                max={balanceFormatted}
              />
              <span className="text-xs text-muted-foreground">
                of {balanceFormatted} SOF
              </span>
            </div>
          )}
        </div>
      )}

      {enabled && (
        <div className="mt-2 space-y-1 text-xs">
          <div className="flex justify-between text-muted-foreground">
            <span>{t("raffle:fromRollover")}</span>
            <span>{rolloverFormatted} SOF</span>
          </div>
          <div className="flex justify-between text-emerald-500">
            <span>{t("raffle:bonusPercent", { percent: bonusPercent })}</span>
            <span>+{bonusFormatted} SOF</span>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Integrate RolloverBanner into BuySellWidget.jsx**

In `packages/frontend/src/components/curve/BuySellWidget.jsx`:

Add imports:
```javascript
import { useRollover } from "@/hooks/useRollover";
import RolloverBanner from "./RolloverBanner";
```

Add state (near existing state declarations):
```javascript
const [rolloverEnabled, setRolloverEnabled] = useState(true);
const [rolloverAmountOverride, setRolloverAmountOverride] = useState(null);
```

Get rollover data (near existing hooks):
```javascript
const {
  rolloverBalance,
  bonusBps,
  bonusAmount,
  isRolloverAvailable,
  spendFromRollover,
  cohortPhase,
} = useRollover(seasonId);
```

Compute the rollover amount to use:
```javascript
const rolloverAmount = rolloverAmountOverride ?? (
  isRolloverAvailable && rolloverEnabled
    ? (rolloverBalance < estBuyWithFees ? rolloverBalance : estBuyWithFees)
    : 0n
);
```

Render the banner at the top of the buy tab content (before the amount input):
```jsx
{activeTab === "buy" && isRolloverAvailable && (
  <RolloverBanner
    rolloverBalance={rolloverBalance}
    bonusBps={bonusBps}
    bonusAmount={bonusAmount}
    sourceSeasonId={seasonId}
    estimatedCost={estBuyWithFees}
    enabled={rolloverEnabled}
    onEnabledChange={setRolloverEnabled}
    rolloverAmount={rolloverAmount}
    onRolloverAmountChange={setRolloverAmountOverride}
  />
)}
```

Modify the buy handler to route through rollover when enabled. The existing `executeBuy` needs to be wrapped to handle mixed funding — if `rolloverEnabled && rolloverAmount > 0n`, build a batch with `spendFromRollover` first, then a normal `buyTokens` for the wallet remainder if needed. This logic lives in the `useTransactionHandlers` or directly in the buy button's onClick.

- [ ] **Step 3: Apply same banner to BuySellSheet.jsx (mobile)**

In `packages/frontend/src/components/mobile/BuySellSheet.jsx`, add the same `RolloverBanner` import and rendering above the `BuyForm` component inside the sheet. Same hook usage, same state.

- [ ] **Step 4: Run build to verify no errors**

Run: `cd packages/frontend && npm run build 2>&1 | head -20`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/curve/RolloverBanner.jsx packages/frontend/src/components/curve/BuySellWidget.jsx packages/frontend/src/components/mobile/BuySellSheet.jsx
git commit -m "feat(frontend): add rollover banner to buy widget (desktop + mobile)"
```

---

### Task 6: Transaction History Badge

Add ROLLOVER_BUY type and badge to the transaction history.

**Files:**
- Modify: `packages/frontend/src/components/user/SOFTransactionHistory.jsx:299-321`
- Modify: `packages/frontend/src/hooks/useSOFTransactions.js`

- [ ] **Step 1: Add ROLLOVER types to useSOFTransactions.js**

In `packages/frontend/src/hooks/useSOFTransactions.js`, add a new section to fetch `RolloverSpend` events from the escrow contract. After the existing prize claim event fetching section (around line 327), add:

```javascript
// Fetch RolloverSpend events
const escrowAddress = contracts.ROLLOVER_ESCROW;
if (escrowAddress) {
  const rolloverLogs = await queryLogsInChunks(publicClient, {
    address: escrowAddress,
    event: {
      type: "event",
      name: "RolloverSpend",
      inputs: [
        { type: "address", name: "user", indexed: true },
        { type: "uint256", name: "seasonId", indexed: true },
        { type: "uint256", name: "nextSeasonId", indexed: true },
        { type: "uint256", name: "baseAmount" },
        { type: "uint256", name: "bonusAmount" },
      ],
    },
    args: { user: address },
    fromBlock,
    toBlock,
  });

  for (const log of rolloverLogs) {
    transactions.push({
      type: "ROLLOVER_BUY",
      direction: "OUT",
      amount: log.args.baseAmount + log.args.bonusAmount,
      bonusAmount: log.args.bonusAmount,
      seasonId: Number(log.args.nextSeasonId),
      sourceSeasonId: Number(log.args.seasonId),
      blockNumber: log.blockNumber,
      transactionHash: log.transactionHash,
    });
  }
}
```

- [ ] **Step 2: Add ROLLOVER_BUY badge to SOFTransactionHistory.jsx**

In `packages/frontend/src/components/user/SOFTransactionHistory.jsx`, add to the `typeMap` object (around line 300):

```javascript
ROLLOVER_BUY: { label: t("raffle:rolloverBuy", { defaultValue: "Rollover" }), variant: "default" },
ROLLOVER_DEPOSIT: { label: t("raffle:rolloverDeposit", { defaultValue: "Rollover In" }), variant: "default" },
ROLLOVER_REFUND: { label: t("raffle:rolloverRefund", { defaultValue: "Rollover Out" }), variant: "secondary" },
```

Style the ROLLOVER_BUY badge with green color — add a CSS class or inline style override for this specific variant. If the Badge component supports a `className` prop:

```javascript
const config = typeMap[tx.type] || { label: tx.type, variant: "outline" };
const isRollover = tx.type?.startsWith("ROLLOVER");
return (
  <Badge
    variant={config.variant}
    className={isRollover ? "bg-emerald-600 text-white" : undefined}
  >
    {config.label}
  </Badge>
);
```

- [ ] **Step 3: Run build**

Run: `cd packages/frontend && npm run build 2>&1 | head -20`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/hooks/useSOFTransactions.js packages/frontend/src/components/user/SOFTransactionHistory.jsx
git commit -m "feat(frontend): add ROLLOVER badge to transaction history"
```

---

### Task 7: Portfolio Rollover Card

New card component in the profile portfolio section.

**Files:**
- Create: `packages/frontend/src/components/user/RolloverPortfolioCard.jsx`
- Create: `packages/frontend/tests/components/RolloverPortfolioCard.test.jsx`
- Modify: `packages/frontend/src/components/account/ProfileContent.jsx:119-152`

- [ ] **Step 1: Write the test**

Create `packages/frontend/tests/components/RolloverPortfolioCard.test.jsx`:

```javascript
/*
  @vitest-environment jsdom
*/
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key, opts) => opts?.defaultValue || key, i18n: { language: "en" } }),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children, to }) => React.createElement("a", { href: to }, children),
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: "0x1234", isConnected: true }),
  usePublicClient: () => ({}),
}));

vi.mock("@/hooks/useRollover", () => ({
  useRollover: () => ({
    rolloverBalance: 175000000000000000000n,
    cohortPhase: "active",
    bonusBps: 600,
    bonusPercent: "6%",
    nextSeasonId: 2n,
    refundRollover: { mutate: vi.fn(), isPending: false },
    isLoading: false,
  }),
}));

vi.mock("@/config/contracts", () => ({ getContractAddresses: () => ({}) }));
vi.mock("@/lib/wagmi", () => ({ getStoredNetworkKey: () => "LOCAL" }));
vi.mock("@/hooks/useSmartTransactions", () => ({
  useSmartTransactions: () => ({ executeBatch: vi.fn() }),
}));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import RolloverPortfolioCard from "@/components/user/RolloverPortfolioCard";

function wrap(ui) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, ui);
}

describe("RolloverPortfolioCard", () => {
  it("renders balance and phase badge", () => {
    render(wrap(React.createElement(RolloverPortfolioCard, { seasonId: 1 })));

    expect(screen.getByText("Rollover Balance")).toBeTruthy();
    expect(screen.getByText(/175/)).toBeTruthy();
    expect(screen.getByText("Ready")).toBeTruthy();
  });

  it("shows buy link when phase is active", () => {
    render(wrap(React.createElement(RolloverPortfolioCard, { seasonId: 1 })));

    expect(screen.getByText(/Buy Tickets/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/frontend && npx vitest run tests/components/RolloverPortfolioCard.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create RolloverPortfolioCard.jsx**

Create `packages/frontend/src/components/user/RolloverPortfolioCard.jsx`:

```jsx
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { formatUnits } from "viem";
import { useRollover } from "@/hooks/useRollover";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const PHASE_BADGES = {
  open: { label: "rolloverPending", variant: "secondary", className: "" },
  active: { label: "rolloverReady", variant: "default", className: "bg-emerald-600" },
  closed: { label: "rolloverClosed", variant: "outline", className: "" },
  expired: { label: "rolloverExpired", variant: "destructive", className: "" },
};

export default function RolloverPortfolioCard({ seasonId }) {
  const { t } = useTranslation(["account", "raffle"]);
  const {
    rolloverBalance,
    cohortPhase,
    bonusPercent,
    nextSeasonId,
    refundRollover,
    isLoading,
  } = useRollover(seasonId);

  if (isLoading || rolloverBalance === 0n || cohortPhase === "none") return null;

  const badge = PHASE_BADGES[cohortPhase] || PHASE_BADGES.closed;
  const balanceFormatted = formatUnits(rolloverBalance, 18);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">{t("account:rolloverBalance")}</CardTitle>
          <Badge variant={badge.variant} className={badge.className}>
            {t(`account:${badge.label}`)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <div className="text-2xl font-bold">{balanceFormatted} SOF</div>
          <div className="text-xs text-muted-foreground">
            {t("account:fromSeason", { season: String(seasonId) })} ·{" "}
            {t("account:rolloverBonusRate", { percent: bonusPercent })}
          </div>
        </div>

        {cohortPhase === "active" && nextSeasonId > 0n && (
          <Link
            to={`/raffles/${String(nextSeasonId)}`}
            className="text-sm text-emerald-500 hover:text-emerald-400 underline"
          >
            {t("account:buyTicketsInSeason", { season: String(nextSeasonId) })}
          </Link>
        )}

        {rolloverBalance > 0n && (cohortPhase === "active" || cohortPhase === "closed" || cohortPhase === "expired") && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => refundRollover.mutate({ seasonId })}
            disabled={refundRollover.isPending}
          >
            {refundRollover.isPending ? "..." : t("account:refundToWallet")}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Add to ProfileContent.jsx**

In `packages/frontend/src/components/account/ProfileContent.jsx`, add the rollover card. Import it:

```javascript
import RolloverPortfolioCard from "@/components/user/RolloverPortfolioCard";
```

Add a rollover section before or after the existing tabs (around line 119). Since we don't know which seasons have rollover positions yet (that's the backend endpoint from Task 8), for now render it conditionally if we know a seasonId. A simple approach: add it as a new tab or render it above the tabs:

```jsx
{/* Rollover positions — rendered above tabs when available */}
<RolloverPortfolioCard seasonId={latestCompletedSeasonId} />
```

The `latestCompletedSeasonId` can come from the existing raffle claims query or be passed as a prop. For the initial implementation, the portfolio card queries the backend endpoint (Task 8) to discover which seasons have rollover positions, then renders a card for each.

- [ ] **Step 5: Run tests**

Run: `cd packages/frontend && npx vitest run tests/components/RolloverPortfolioCard.test.jsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/components/user/RolloverPortfolioCard.jsx packages/frontend/tests/components/RolloverPortfolioCard.test.jsx packages/frontend/src/components/account/ProfileContent.jsx
git commit -m "feat(frontend): add RolloverPortfolioCard to user profile"
```

---

### Task 8: Backend Event Listener + API Endpoint

Index rollover events and expose positions API.

**Files:**
- Create: `packages/backend/src/listeners/rolloverEventListener.js`
- Create: `packages/backend/fastify/routes/rolloverRoutes.js`
- Modify: `packages/backend/fastify/server.js`

- [ ] **Step 1: Create rollover event listener**

Create `packages/backend/src/listeners/rolloverEventListener.js`:

```javascript
import { parseAbiItem } from "viem";
import { RolloverEscrowABI } from "@sof/contracts";
import { getDeployment } from "@sof/contracts/deployments";
import { supabase } from "../../shared/supabaseClient.js";

const ROLLOVER_DEPOSIT_EVENT = parseAbiItem(
  "event RolloverDeposit(address indexed user, uint256 indexed seasonId, uint256 amount)"
);
const ROLLOVER_SPEND_EVENT = parseAbiItem(
  "event RolloverSpend(address indexed user, uint256 indexed seasonId, uint256 indexed nextSeasonId, uint256 baseAmount, uint256 bonusAmount)"
);
const ROLLOVER_REFUND_EVENT = parseAbiItem(
  "event RolloverRefund(address indexed user, uint256 indexed seasonId, uint256 amount)"
);

export function startRolloverEventListener(publicClient, network, fastify) {
  const deployment = getDeployment(network);
  const escrowAddress = deployment.RolloverEscrow;

  if (!escrowAddress) {
    fastify.log.warn("RolloverEscrow not deployed — skipping rollover listener");
    return;
  }

  // Watch RolloverDeposit
  publicClient.watchEvent({
    address: escrowAddress,
    event: ROLLOVER_DEPOSIT_EVENT,
    onLogs: async (logs) => {
      for (const log of logs) {
        const { user, seasonId, amount } = log.args;
        await supabase.from("raffle_transactions").upsert({
          season_id: Number(seasonId),
          player_address: user.toLowerCase(),
          source: "LISTENER",
          type: "ROLLOVER_DEPOSIT",
          amount: amount.toString(),
          tx_hash: log.transactionHash,
          block_number: Number(log.blockNumber),
        }, { onConflict: "tx_hash,type" });

        fastify.log.info(`RolloverDeposit: ${user} deposited ${amount} for season ${seasonId}`);
      }
    },
  });

  // Watch RolloverSpend
  publicClient.watchEvent({
    address: escrowAddress,
    event: ROLLOVER_SPEND_EVENT,
    onLogs: async (logs) => {
      for (const log of logs) {
        const { user, seasonId, nextSeasonId, baseAmount, bonusAmount } = log.args;
        await supabase.from("raffle_transactions").upsert({
          season_id: Number(nextSeasonId),
          player_address: user.toLowerCase(),
          source: "LISTENER",
          type: "ROLLOVER_BUY",
          amount: (baseAmount + bonusAmount).toString(),
          bonus_amount: bonusAmount.toString(),
          source_season_id: Number(seasonId),
          tx_hash: log.transactionHash,
          block_number: Number(log.blockNumber),
        }, { onConflict: "tx_hash,type" });

        fastify.log.info(`RolloverSpend: ${user} spent ${baseAmount} (+${bonusAmount} bonus) in season ${nextSeasonId}`);
      }
    },
  });

  // Watch RolloverRefund
  publicClient.watchEvent({
    address: escrowAddress,
    event: ROLLOVER_REFUND_EVENT,
    onLogs: async (logs) => {
      for (const log of logs) {
        const { user, seasonId, amount } = log.args;
        await supabase.from("raffle_transactions").upsert({
          season_id: Number(seasonId),
          player_address: user.toLowerCase(),
          source: "LISTENER",
          type: "ROLLOVER_REFUND",
          amount: amount.toString(),
          tx_hash: log.transactionHash,
          block_number: Number(log.blockNumber),
        }, { onConflict: "tx_hash,type" });

        fastify.log.info(`RolloverRefund: ${user} refunded ${amount} from season ${seasonId}`);
      }
    },
  });

  fastify.log.info(`Rollover event listener started for ${escrowAddress}`);
}
```

- [ ] **Step 2: Create rollover routes**

Create `packages/backend/fastify/routes/rolloverRoutes.js`:

```javascript
import { supabase } from "../../shared/supabaseClient.js";

export default async function rolloverRoutes(fastify) {
  fastify.get("/api/rollover/positions", async (request, reply) => {
    const { wallet } = request.query;

    if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
      return reply.code(400).send({ error: "Invalid wallet address" });
    }

    const { data, error } = await supabase
      .from("raffle_transactions")
      .select("season_id, amount, created_at")
      .eq("player_address", wallet.toLowerCase())
      .eq("type", "ROLLOVER_DEPOSIT")
      .order("created_at", { ascending: false });

    if (error) {
      fastify.log.error("Error fetching rollover positions:", error);
      return reply.code(500).send({ error: "Internal server error" });
    }

    return reply.send({
      positions: (data || []).map((row) => ({
        seasonId: row.season_id,
        deposited: row.amount,
        depositedAt: row.created_at,
      })),
    });
  });
}
```

- [ ] **Step 3: Register listener and routes in server.js**

In `packages/backend/fastify/server.js`:

Add import:
```javascript
import { startRolloverEventListener } from "../src/listeners/rolloverEventListener.js";
```

Add route registration (near existing route registrations):
```javascript
import rolloverRoutes from "./routes/rolloverRoutes.js";
// ...
fastify.register(rolloverRoutes);
```

Add listener start (near existing listener starts):
```javascript
startRolloverEventListener(publicClient, NETWORK, fastify);
```

- [ ] **Step 4: Verify backend starts**

Run: `cd packages/backend && npm run dev` (briefly, then Ctrl+C)
Expected: No import errors, "Rollover event listener started" or "RolloverEscrow not deployed" log message.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/listeners/rolloverEventListener.js packages/backend/fastify/routes/rolloverRoutes.js packages/backend/fastify/server.js
git commit -m "feat(backend): add rollover event listener and positions API endpoint"
```

---

### Task 9: Version Bump + Final Build

**Files:**
- Modify: `packages/frontend/package.json`
- Modify: `packages/backend/package.json`

- [ ] **Step 1: Run full frontend test suite**

Run: `cd packages/frontend && npm test`
Expected: All tests pass.

- [ ] **Step 2: Run frontend build**

Run: `cd packages/frontend && npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Run frontend lint**

Run: `cd packages/frontend && npm run lint`
Expected: No new warnings.

- [ ] **Step 4: Bump versions**

In `packages/frontend/package.json`: bump minor version (new feature).
In `packages/backend/package.json`: bump minor version (new listener + route).

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/package.json packages/backend/package.json
git commit -m "chore: bump frontend and backend versions for rollover UI"
```
