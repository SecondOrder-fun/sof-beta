/*
  @vitest-environment jsdom
*/

import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const LAUNCHPAD = "0x1000000000000000000000000000000000000001";
const POOL_MANAGER = "0x2000000000000000000000000000000000000002";
const CURRENT_PLACER = "0x3000000000000000000000000000000000000003";
const OLD_PLACER = "0x4000000000000000000000000000000000000004";
const ZERO = "0x0000000000000000000000000000000000000000";

const OLD_TOKEN = "0xaaaa00000000000000000000000000000000aaaa";
const NEW_TOKEN = "0xbbbb00000000000000000000000000000000bbbb";
const FOREIGN_TOKEN = "0xcccc00000000000000000000000000000000cccc";

const PLACER_OF = { [OLD_TOKEN]: OLD_PLACER, [NEW_TOKEN]: CURRENT_PLACER, [FOREIGN_TOKEN]: ZERO };

const placementReads = [];
const multicall = vi.fn(async ({ contracts }) =>
  contracts.map((c) => {
    if (c.functionName === "placerOf") return { status: "success", result: PLACER_OF[c.args[0]] };
    if (c.functionName === "extsload") return { status: "success", result: ["0x01", "0x02"] };
    if (c.functionName === "getPlacement") {
      placementReads.push({ placer: c.address, token: c.args[0] });
      return { status: "success", result: { placer: c.address } };
    }
    return { status: "failure" };
  }),
);

vi.mock("wagmi", () => ({ usePublicClient: () => ({ multicall }) }));
vi.mock("@/lib/wagmi", () => ({ getStoredNetworkKey: () => "TESTNET" }));
vi.mock("@/config/contracts", () => ({
  getContractAddresses: () => ({
    TOKEN_LAUNCHPAD: LAUNCHPAD,
    POOL_MANAGER,
    LIQUIDITY_PLACER: CURRENT_PLACER,
  }),
}));
vi.mock("@/utils/abis", () => ({ UniV4LiquidityPlacerAbi: [], PoolManagerAbi: [], TokenLaunchpadAbi: [] }));
vi.mock("@/lib/v4PoolMath", () => ({
  poolStateSlot: () => "0xs",
  poolLiquiditySlot: () => "0xl",
  // Echo which placer the placement came from, so the test can see the routing.
  deriveMarketState: ({ placement }) => ({ placer: placement.placer }),
}));

import { useLaunchMarkets } from "@/hooks/useLaunchMarkets";

function wrapper({ children }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe("useLaunchMarkets", () => {
  it("reads each launch through the placer that placed it, not the current one", async () => {
    const launches = [OLD_TOKEN, NEW_TOKEN, FOREIGN_TOKEN].map((token) => ({ token, placementId: "0x1234" }));
    const { result } = renderHook(() => useLaunchMarkets(launches), { wrapper });

    await waitFor(() => expect(Object.keys(result.current.markets)).toHaveLength(2));

    expect(result.current.markets[OLD_TOKEN].placer).toBe(OLD_PLACER);
    expect(result.current.markets[NEW_TOKEN].placer).toBe(CURRENT_PLACER);
    // A token the launchpad does not know has no placer and is not looked up anywhere.
    expect(result.current.markets[FOREIGN_TOKEN]).toBeUndefined();
    expect(placementReads.map((r) => r.token)).not.toContain(FOREIGN_TOKEN);
    expect(result.current.isAvailable).toBe(true);
  });
});
