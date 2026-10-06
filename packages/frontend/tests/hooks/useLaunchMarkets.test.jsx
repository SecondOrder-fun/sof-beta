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

const USDC_TOKEN = "0xdddd00000000000000000000000000000000dddd";
const ODD_TOKEN = "0x0000eeee000000000000000000000000000eeee0";
// Listed for TESTNET in config/launchQuoteTokens.js — no read needed.
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
// Not listed: its symbol and decimals are read from the token.
const ODD_QUOTE = "0xffff00000000000000000000000000000000ffff";

const PLACER_OF = {
  [OLD_TOKEN]: OLD_PLACER,
  [NEW_TOKEN]: CURRENT_PLACER,
  [FOREIGN_TOKEN]: ZERO,
  [USDC_TOKEN]: CURRENT_PLACER,
  [ODD_TOKEN]: CURRENT_PLACER,
};
// ETH launches: quote (address 0) is currency0. USDC sorts below its token here
// (currency0); the odd quote sorts above its token, which makes the TOKEN currency0.
const KEY_OF = {
  [USDC_TOKEN]: { key: { currency0: USDC, currency1: USDC_TOKEN }, tokenIsCurrency0: false },
  [ODD_TOKEN]: { key: { currency0: ODD_TOKEN, currency1: ODD_QUOTE }, tokenIsCurrency0: true },
};

const BANDS = [
  { tickLower: 196200, tickUpper: 207200, liquidity: 3n },
  { tickLower: -887200, tickUpper: 196200, liquidity: 4n },
];

const placementReads = [];
const tokenReads = [];
/** Whether a getPlacement call decodes with the current ABI, which ends in liquidityPreset. */
const withPreset = (abi) => abi[0].outputs[0].components.some((c) => c.name === "liquidityPreset");
const multicall = vi.fn(async ({ contracts }) =>
  contracts.map((c) => {
    if (c.functionName === "placerOf") return { status: "success", result: PLACER_OF[c.args[0]] };
    if (c.functionName === "extsload") return { status: "success", result: ["0x01", "0x02"] };
    if (c.functionName === "getPlacement") {
      placementReads.push({ placer: c.address, token: c.args[0], withPreset: withPreset(c.abi) });
      const k = KEY_OF[c.args[0]] ?? { key: { currency0: ZERO, currency1: c.args[0] }, tokenIsCurrency0: false };
      // The old placer predates liquidity presets: its struct has no liquidityPreset, so
      // it only decodes without one.
      if (c.address === OLD_PLACER) {
        return withPreset(c.abi) ? { status: "failure" } : { status: "success", result: { placer: c.address, ...k } };
      }
      return { status: "success", result: { placer: c.address, ...k, liquidityPreset: 1 } };
    }
    // The old placer predates the snipe tax and the bands too.
    if (c.functionName === "snipeTaxOf") {
      return c.address === OLD_PLACER ? { status: "failure" } : { status: "success", result: [8000, 30, 1_700_000_000] };
    }
    if (c.functionName === "bandsOf") {
      return c.address === OLD_PLACER ? { status: "failure" } : { status: "success", result: BANDS };
    }
    if (c.functionName === "symbol" || c.functionName === "decimals") {
      tokenReads.push(c.address);
      return { status: "success", result: c.functionName === "symbol" ? "ODD" : 8 };
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
vi.mock("@/utils/abis", () => ({
  UniV4LiquidityPlacerAbi: [
    {
      type: "function",
      name: "getPlacement",
      outputs: [{ type: "tuple", components: [{ name: "tickLower" }, { name: "tradeFee" }, { name: "liquidityPreset" }] }],
    },
  ],
  PoolManagerAbi: [],
  TokenLaunchpadAbi: [],
  ERC20Abi: [],
}));
vi.mock("@/lib/v4PoolMath", () => ({
  poolStateSlot: () => "0xs",
  poolLiquiditySlot: () => "0xl",
  // Echo which placer the placement came from, so the test can see the routing.
  deriveMarketState: ({ placement, bands, quote, snipeTax }) => ({
    placer: placement.placer,
    liquidityPreset: placement.liquidityPreset,
    bands,
    quote,
    snipeTax,
  }),
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

  it("reads each launch's snipe-tax schedule from its placer; one from before it has none", async () => {
    const launches = [OLD_TOKEN, NEW_TOKEN].map((token) => ({ token, placementId: "0x1234" }));
    const { result } = renderHook(() => useLaunchMarkets(launches), { wrapper });

    await waitFor(() => expect(Object.keys(result.current.markets)).toHaveLength(2));

    expect(result.current.markets[NEW_TOKEN].snipeTax).toEqual([8000, 30, 1_700_000_000]);
    expect(result.current.markets[OLD_TOKEN].snipeTax).toBeNull();
    expect(result.current.markets[OLD_TOKEN].placer).toBe(OLD_PLACER);
  });

  it("reads each launch's bands with its placement; a placer from before presets is read as Classic", async () => {
    placementReads.length = 0;
    const launches = [OLD_TOKEN, NEW_TOKEN].map((token) => ({ token, placementId: "0x1234" }));
    const { result } = renderHook(() => useLaunchMarkets(launches), { wrapper });

    await waitFor(() => expect(Object.keys(result.current.markets)).toHaveLength(2));

    expect(result.current.markets[NEW_TOKEN].bands).toEqual(BANDS);
    expect(result.current.markets[NEW_TOKEN].liquidityPreset).toBe(1);
    // No bandsOf: one position, the placement's — the Classic ladder.
    expect(result.current.markets[OLD_TOKEN].bands).toBeNull();
    expect(result.current.markets[OLD_TOKEN].liquidityPreset).toBe(0);
    expect(result.current.markets[OLD_TOKEN].placer).toBe(OLD_PLACER);
    // Only the old placer's placement is read again, without the preset field.
    const retried = placementReads.filter((r) => !r.withPreset);
    expect(retried).toEqual([{ placer: OLD_PLACER, token: OLD_TOKEN, withPreset: false }]);
  });

  it("carries each launch's quote: ETH, a listed ERC-20 without a read, and an unlisted one read from the token", async () => {
    const launches = [NEW_TOKEN, USDC_TOKEN, ODD_TOKEN].map((token) => ({ token, placementId: "0x1234" }));
    const { result } = renderHook(() => useLaunchMarkets(launches), { wrapper });

    await waitFor(() => expect(Object.keys(result.current.markets)).toHaveLength(3));

    expect(result.current.markets[NEW_TOKEN].quote).toMatchObject({ address: ZERO, symbol: "ETH", decimals: 18 });
    expect(result.current.markets[USDC_TOKEN].quote).toMatchObject({ address: USDC, symbol: "USDC", decimals: 6 });
    // Token is currency0, so the quote is currency1.
    expect(result.current.markets[ODD_TOKEN].quote).toEqual({ address: ODD_QUOTE, symbol: "ODD", decimals: 8 });
    expect([...new Set(tokenReads)]).toEqual([ODD_QUOTE]);
  });
});
